import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import Twitter from 'next-auth/providers/twitter';
import Apple from 'next-auth/providers/apple';
import { prisma } from './prisma';
import { generateUniqueHandle, isHandleAvailable } from './handles';
import { isAdminEmail } from './admin-emails';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  adapter: PrismaAdapter(prisma),
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? [
          GitHub({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    ...(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET
      ? [
          Twitter({
            clientId: process.env.TWITTER_CLIENT_ID,
            clientSecret: process.env.TWITTER_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    ...(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET
      ? [
          Apple({
            clientId: process.env.APPLE_CLIENT_ID,
            clientSecret: process.env.APPLE_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/auth/login',
    newUser: '/onboarding',
  },
  events: {
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
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = token.role ?? 'USER';
        session.user.bannedAt = token.bannedAt ?? null;
        session.user.suspendedUntil = token.suspendedUntil ?? null;
      }
      return session;
    },
    async jwt({ token, user, trigger }) {
      if (user) {
        token.sub = user.id;
      }

      // On sign-in or session update, fetch role from DB
      if ((user || trigger === 'update') && token.sub) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { email: true, role: true, handle: true, name: true, bannedAt: true, suspendedUntil: true },
        });

        if (dbUser) {
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
              const preferredHandles: Record<string, string> = {
                'andres2912@gmail.com': 'andres',
              };
              const preferred = dbUser.email
                ? preferredHandles[dbUser.email.toLowerCase()]
                : undefined;
              const handle =
                preferred && (await isHandleAvailable(preferred)).available
                  ? preferred
                  : await generateUniqueHandle(dbUser.name);
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

      return token;
    },
  },
});
