import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import Twitter from 'next-auth/providers/twitter';
import Apple from 'next-auth/providers/apple';
import Resend from 'next-auth/providers/resend';
import Credentials from 'next-auth/providers/credentials';
import { prisma } from './prisma';
import { generateUniqueHandle } from './handles';
import { isAdminEmail } from './admin-emails';
import { bootstrapFirstUserAsOwner } from './owner-bootstrap';
import { getOptionalEmailProviderConfig, sendEmail } from './email';
import { buildMagicLinkEmail } from './email-templates';
import { isOpenSignup } from './site-config';
import { isLocalAuthEnabled } from './local-auth';
import { verifyPassword } from './password';
import { credentialsAuthSchema } from './validations';
import { checkRateLimit } from './redis';

const emailProviderConfig = getOptionalEmailProviderConfig();

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  basePath: '/api/v1/auth',
  secret: process.env.AUTH_SECRET,
  adapter: PrismaAdapter(prisma),
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,

          }),
        ]
      : []),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? [
          GitHub({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,

          }),
        ]
      : []),
    ...(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET
      ? [
          Twitter({
            clientId: process.env.TWITTER_CLIENT_ID,
            clientSecret: process.env.TWITTER_CLIENT_SECRET,

          }),
        ]
      : []),
    ...(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET
      ? [
          Apple({
            clientId: process.env.APPLE_CLIENT_ID,
            clientSecret: process.env.APPLE_CLIENT_SECRET,

          }),
        ]
      : []),
    ...(emailProviderConfig
      ? [
          Resend({
            apiKey: emailProviderConfig.apiKey,
            from: emailProviderConfig.from,
            async sendVerificationRequest({ identifier: to, url }) {
              const { subject, html } = buildMagicLinkEmail(url);
              await sendEmail({ to, subject, html });
            },
          }),
        ]
      : []),
    // Local profile sign-in (self-hosted). Always present, but authorize refuses
    // unless localAuth is enabled, so it is inert on OAuth-only instances.
    Credentials({
      id: 'credentials',
      name: 'Profile',
      credentials: { userId: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsAuthSchema.safeParse(raw);
        if (!parsed.success) return null;
        if (!(await isLocalAuthEnabled())) return null;

        const { userId, password } = parsed.data;

        // Rate-limit by user id to slow password guessing.
        const allowed = await checkRateLimit(`creds:${userId}`, 10, 300);
        if (!allowed) return null;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.passwordHash) return null;
        if (user.bannedAt) return null;
        if (user.suspendedUntil && user.suspendedUntil > new Date()) return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, name: user.name, email: user.email, image: user.image };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/auth/login',
    newUser: '/welcome',
  },
  events: {
    async createUser({ user }) {
      // First-user-becomes-owner: a fresh self-host's first account is promoted
      // to household owner (ADMIN). No-op on hosted installs (ADMIN_EMAILS set)
      // and once an owner already exists.
      if (user.id) {
        await bootstrapFirstUserAsOwner(user.id);
      }

      if (user.email) {
        const entry = await prisma.waitlist.findUnique({
          where: { email: user.email },
          select: { twitterHandle: true },
        });

        // Pre-associate Twitter handle from waitlist (if not taken)
        if (entry?.twitterHandle) {
          const taken = await prisma.user.findUnique({
            where: { twitterHandle: entry.twitterHandle },
            select: { id: true },
          });
          if (!taken) {
            await prisma.user.update({
              where: { id: user.id! },
              data: { twitterHandle: entry.twitterHandle },
            });
          }
        }

        // Mark waitlist conversion
        await prisma.waitlist.updateMany({
          where: { email: user.email },
          data: { signedUpAt: new Date() },
        });

        // Welcome email
        if (user.name) {
          const { buildWelcomeEmail } = await import('./email-templates');
          const { sendEmail } = await import('./email');
          const { subject, html } = buildWelcomeEmail(user.name);
          await sendEmail({ to: user.email, subject, html });
        }
      }
    },
    async linkAccount({ user, account, profile }) {
      if (account.provider === 'twitter' && user.id) {
        const twitterHandle =
          ((profile as Record<string, unknown>)?.username as string | undefined) ??
          ((profile as Record<string, unknown>)?.screen_name as string | undefined);

        await prisma.user.update({
          where: { id: user.id },
          data: {
            twitterEnabled: true,
            ...(twitterHandle ? { twitterHandle } : {}),
          },
        });
      }
    },
  },
  callbacks: {
    async signIn({ user, profile }) {
      // Account linking (e.g. Twitter connect) — user already exists in DB
      if (user?.id) {
        const existing = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true } });
        if (existing) return true;
      }

      const email = profile?.email ?? user?.email;
      if (!email) return '/auth/waitlisted?reason=no-email';

      // Existing users can always sign in
      const existingUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existingUser) return true;

      // Admins bypass waitlist
      if (isAdminEmail(email)) return true;

      // New user — check waitlist (bypassed when openSignup is enabled)
      if (!await isOpenSignup()) {
        const entry = await prisma.waitlist.findUnique({ where: { email } });
        if (!entry) {
          // Auto-add to waitlist so they don't have to sign up separately
          await prisma.waitlist.create({
            data: { email, source: 'oauth-signin' },
          }).catch(() => {}); // ignore if duplicate race
          return '/auth/waitlisted?reason=not-on-list';
        }
        if (entry.status !== 'APPROVED') return '/auth/waitlisted?reason=pending';
      }
      return true;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        if (token.impersonateUserId) {
          session.user.id = token.impersonateUserId;
          session.user.name = token.impersonateName ?? null;
          session.user.email = token.impersonateEmail ?? '';
          session.user.image = token.impersonateImage ?? null;
          session.user.role = token.role ?? 'ADMIN';
          session.user.isImpersonating = true;
          session.user.impersonatedRole = token.impersonateRole;
          session.user.originalUser = {
            id: token.originalUserId!,
            name: token.originalUserName ?? null,
            image: token.originalUserImage ?? null,
          };
        } else {
          session.user.id = token.sub;
          session.user.role = token.role ?? 'USER';
        }
        session.user.bannedAt = token.bannedAt ?? null;
        session.user.suspendedUntil = token.suspendedUntil ?? null;
      }
      return session;
    },
    async jwt({ token, user, account, trigger, session }) {
      if (user) {
        token.sub = user.id;
      }

      // Handle impersonation triggers from session.update()
      if (trigger === 'update' && session) {
        const updateData = session as { impersonateUserId?: string; stopImpersonating?: boolean };

        if (updateData.impersonateUserId && token.role === 'ADMIN') {
          const target = await prisma.user.findUnique({
            where: { id: updateData.impersonateUserId },
            select: { id: true, name: true, email: true, image: true, role: true },
          });
          if (target) {
            if (!token.impersonateUserId) {
              token.originalUserId = token.sub;
              token.originalUserName = token.name as string | null;
              token.originalUserImage = token.picture as string | null;
            }
            token.impersonateUserId = target.id;
            token.impersonateName = target.name;
            token.impersonateEmail = target.email;
            token.impersonateImage = target.image;
            token.impersonateRole = target.role;
          }
          return token;
        }

        if (updateData.stopImpersonating && token.impersonateUserId) {
          delete token.impersonateUserId;
          delete token.impersonateName;
          delete token.impersonateEmail;
          delete token.impersonateImage;
          delete token.impersonateRole;
          delete token.originalUserId;
          delete token.originalUserName;
          delete token.originalUserImage;
        }
      }

      // On sign-in or session update, fetch role from DB
      if ((user || trigger === 'update') && token.sub) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { email: true, role: true, handle: true, name: true, bannedAt: true, suspendedUntil: true, tokenVersion: true },
        });

        if (dbUser) {
          // Mark local (Credentials) sessions and snapshot the token version so it
          // can be invalidated when the member is removed or the password reset.
          if (account?.provider === 'credentials') token.local = true;
          token.tokenVersion = dbUser.tokenVersion;

          // Auto-assign ADMIN role if email is in admin list
          if (dbUser.email && isAdminEmail(dbUser.email) && dbUser.role !== 'ADMIN') {
            await prisma.user.update({
              where: { id: token.sub },
              data: { role: 'ADMIN' },
            });
            token.role = 'ADMIN';
          } else {
            token.role = dbUser.role;
          }

          // Propagate ban/suspend state to JWT
          token.bannedAt = dbUser.bannedAt?.toISOString() ?? null;
          token.suspendedUntil = dbUser.suspendedUntil?.toISOString() ?? null;

          // Auto-generate handle if missing
          if (!dbUser.handle) {
            try {
              const handle = await generateUniqueHandle(
                dbUser.email ? dbUser.email.split('@')[0] : dbUser.name
              );
              await prisma.user.update({
                where: { id: token.sub },
                data: { handle },
              });
            } catch {
              // Non-fatal — handle will be generated on next sign-in
            }
          }
        }
      }

      // On every request for a local (Credentials) session, verify the token
      // version. A mismatch (member removed, password reset) clears the subject,
      // so the session callback yields a logged-out session.
      if (token.local && token.sub && !user) {
        const current = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { tokenVersion: true },
        });
        if (!current || current.tokenVersion !== token.tokenVersion) {
          delete token.sub;
        }
      }

      return token;
    },
  },
});
