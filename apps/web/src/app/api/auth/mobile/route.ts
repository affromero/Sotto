import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/redis';
import { generateApiKey } from '@/lib/api-keys';
import { generateUniqueHandle } from '@/lib/handles';
import { isAdminEmail } from '@/lib/admin-emails';
import { isOpenSignup } from '@/lib/site-config';

import { errorResponse } from '@/lib/api-response';
// --- JWKS for Apple + Google JWT verification ---

const appleJWKS = createRemoteJWKSet(
  new URL('https://appleid.apple.com/auth/keys'),
);

const googleJWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

// --- Types ---

interface OAuthProfile {
  providerUserId: string;
  email?: string;
  name?: string;
  image?: string;
}

// --- Schemas ---

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  handle: true,
  image: true,
  role: true,
} as const;

const devLoginSchema = z.object({
  email: z.string().email(),
});

const oauthIdTokenSchema = z.object({
  provider: z.enum(['apple', 'google']),
  idToken: z.string().min(1),
  userName: z.string().optional(),
});

const oauthCodeSchema = z.object({
  provider: z.enum(['google', 'github']),
  code: z.string().min(1),
  codeVerifier: z.string().optional(),
  redirectUri: z.string().min(1),
});

const oauthLoginSchema = z.union([oauthIdTokenSchema, oauthCodeSchema]);

// --- Route handler ---

export async function POST(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1';
  const { allowed } = await checkRateLimit(`auth:mobile:${ip}`, 10, 15 * 60);
  if (!allowed) {
    return errorResponse('Too many attempts', 429);
  }

  const body = await request.json();

  if (process.env.NODE_ENV === 'development') {
    return handleDevLogin(body);
  }

  return handleOAuthLogin(body);
}

// --- Token + response helper ---

async function issueTokenAndRespond(user: {
  id: string;
  name: string | null;
  email: string | null;
  handle: string | null;
  image: string | null;
  role: string;
}) {
  const { key, hash, prefix } = generateApiKey();

  await prisma.apiKey.create({
    data: {
      userId: user.id,
      name: 'Mobile App',
      keyHash: hash,
      keyPrefix: prefix,
    },
  });

  return NextResponse.json({
    token: key,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      handle: user.handle,
      image: user.image,
      role: user.role,
    },
  });
}

// --- Dev login (development only) ---

async function handleDevLogin(body: unknown) {
  const parsed = devLoginSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Valid email is required', 400);
  }

  const { email } = parsed.data;

  let user = await prisma.user.findUnique({
    where: { email },
    select: USER_SELECT,
  });

  if (!user) {
    const handle = await generateUniqueHandle(email.split('@')[0]);
    user = await prisma.user.create({
      data: {
        email,
        handle,
        emailVerified: new Date(),
        role: isAdminEmail(email) ? 'ADMIN' : 'USER',
      },
      select: USER_SELECT,
    });
  }

  return issueTokenAndRespond(user);
}

// --- OAuth login (production) ---

async function handleOAuthLogin(body: unknown) {
  const parsed = oauthLoginSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('provider and idToken or code are required', 400);
  }

  const { provider } = parsed.data;
  let profile: OAuthProfile | null;
  let userName: string | undefined;

  if ('idToken' in parsed.data) {
    profile = await verifyOAuthToken(provider, parsed.data.idToken);
    userName = parsed.data.userName;
  } else {
    const { code, codeVerifier, redirectUri } = parsed.data;
    if (provider === 'google') {
      profile = await exchangeGoogleCode(code, codeVerifier, redirectUri);
    } else {
      profile = await exchangeGithubCode(code, redirectUri);
    }
  }

  if (!profile) {
    return errorResponse('Invalid or expired token', 401);
  }

  // Step 1: Check for existing Account
  const account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId: profile.providerUserId,
      },
    },
    include: {
      user: { select: USER_SELECT },
    },
  });

  if (account) {
    return issueTokenAndRespond(account.user);
  }

  // Step 2: No Account — try to link to existing User by email
  const email = profile.email;
  if (!email) {
    return NextResponse.json(
      {
        error:
          'This provider did not share an email address. Please sign in with Apple, Google, or GitHub instead.',
      },
      { status: 400 },
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: USER_SELECT,
  });

  if (existingUser) {
    await prisma.account.create({
      data: {
        userId: existingUser.id,
        type: 'oauth',
        provider,
        providerAccountId: profile.providerUserId,
      },
    });
    return issueTokenAndRespond(existingUser);
  }

  // Step 3: No Account, no User — create both (full mobile sign-up)

  // Admins bypass waitlist; when openSignup is on, everyone can sign up
  if (!isAdminEmail(email) && !await isOpenSignup()) {
    const waitlistEntry = await prisma.waitlist.findUnique({ where: { email } });
    if (!waitlistEntry || waitlistEntry.status !== 'APPROVED') {
      return errorResponse('Your email is not on the approved waitlist. Sign up from the configured web app first.', 403);
    }
  }

  const name = userName || profile.name || null;
  const handle = await generateUniqueHandle(email.split('@')[0]);

  try {
    const newUser = await prisma.user.create({
      data: {
        email,
        name,
        handle,
        image: profile.image,
        emailVerified: new Date(),
        role: isAdminEmail(email) ? 'ADMIN' : 'USER',
        accounts: {
          create: {
            type: 'oauth',
            provider,
            providerAccountId: profile.providerUserId,
          },
        },
      },
      select: USER_SELECT,
    });

    // Mark waitlist conversion + pre-associate twitter handle
    const waitlistEntry = await prisma.waitlist.findUnique({
      where: { email },
      select: { twitterHandle: true },
    });
    if (waitlistEntry?.twitterHandle) {
      const taken = await prisma.user.findUnique({
        where: { twitterHandle: waitlistEntry.twitterHandle },
        select: { id: true },
      });
      if (!taken) {
        await prisma.user.update({
          where: { id: newUser.id },
          data: { twitterHandle: waitlistEntry.twitterHandle },
        });
      }
    }
    await prisma.waitlist.updateMany({
      where: { email },
      data: { signedUpAt: new Date() },
    });

    return issueTokenAndRespond(newUser);
  } catch (err: unknown) {
    // Race condition: another request created the user first (P2002 = unique constraint)
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      const raceUser = await prisma.user.findUnique({
        where: { email },
        select: USER_SELECT,
      });
      if (raceUser) {
        await prisma.account.create({
          data: {
            userId: raceUser.id,
            type: 'oauth',
            provider,
            providerAccountId: profile.providerUserId,
          },
        });
        return issueTokenAndRespond(raceUser);
      }
    }
    throw err;
  }
}

// --- Code exchange functions ---

async function exchangeGoogleCode(
  code: string,
  codeVerifier: string | undefined,
  redirectUri: string,
): Promise<OAuthProfile | null> {
  try {
    // Use iOS client ID for mobile code exchange (native apps are public clients)
    const clientId =
      process.env.GOOGLE_IOS_CLIENT_ID ??
      process.env.GOOGLE_CLIENT_ID ??
      '';
    const isNativeClient = !!process.env.GOOGLE_IOS_CLIENT_ID;

    const params = new URLSearchParams({
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    // Native iOS apps are public clients — omit client_secret
    if (!isNativeClient) {
      params.set('client_secret', process.env.GOOGLE_CLIENT_SECRET ?? '');
    }

    if (codeVerifier) {
      params.set('code_verifier', codeVerifier);
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!response.ok) return null;

    const tokenData = await response.json();

    // Extract profile from id_token JWT if available
    if (typeof tokenData.id_token === 'string') {
      const profile = await verifyGoogleToken(tokenData.id_token);
      if (profile) return profile;
    }

    // Fallback: fetch profile from userinfo endpoint using access token
    if (typeof tokenData.access_token === 'string') {
      return fetchGoogleUserInfo(tokenData.access_token);
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchGoogleUserInfo(
  accessToken: string,
): Promise<OAuthProfile | null> {
  try {
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return null;

    const info = await response.json();
    if (typeof info.sub !== 'string') return null;

    return {
      providerUserId: info.sub,
      email: typeof info.email === 'string' ? info.email : undefined,
      name: typeof info.name === 'string' ? info.name : undefined,
      image: typeof info.picture === 'string' ? info.picture : undefined,
    };
  } catch {
    return null;
  }
}

async function exchangeGithubCode(
  code: string,
  redirectUri: string,
): Promise<OAuthProfile | null> {
  try {
    const response = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID ?? '',
          client_secret: process.env.GITHUB_CLIENT_SECRET ?? '',
          code,
          redirect_uri: redirectUri,
        }),
      },
    );
    if (!response.ok) return null;

    const tokenData = await response.json();
    if (typeof tokenData.access_token !== 'string') return null;

    return verifyGithubToken(tokenData.access_token);
  } catch {
    return null;
  }
}

// --- Token verification functions ---

async function verifyOAuthToken(
  provider: string,
  idToken: string,
): Promise<OAuthProfile | null> {
  switch (provider) {
    case 'apple':
      return verifyAppleToken(idToken);
    case 'google':
      return verifyGoogleToken(idToken);
    case 'github':
      return verifyGithubToken(idToken);
    default:
      return null;
  }
}

const APPLE_BUNDLE_ID = 'fm.sotto.app';

async function verifyAppleToken(
  idToken: string,
): Promise<OAuthProfile | null> {
  try {
    // Accept both the Services ID (web) and the bundle ID (native iOS)
    const audiences = [APPLE_BUNDLE_ID, process.env.APPLE_CLIENT_ID].filter(
      Boolean,
    ) as string[];

    const { payload } = await jwtVerify(idToken, appleJWKS, {
      issuer: 'https://appleid.apple.com',
      audience: audiences,
    });

    if (typeof payload.sub !== 'string') return null;

    return {
      providerUserId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  } catch {
    return null;
  }
}

async function verifyGoogleToken(
  idToken: string,
): Promise<OAuthProfile | null> {
  try {
    // Accept both web and iOS client IDs as valid audiences
    const audiences = [
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_IOS_CLIENT_ID,
    ].filter(Boolean) as string[];

    const { payload } = await jwtVerify(idToken, googleJWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: audiences,
    });

    if (typeof payload.sub !== 'string') return null;

    return {
      providerUserId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      image:
        typeof payload.picture === 'string' ? payload.picture : undefined,
    };
  } catch {
    return null;
  }
}

async function verifyGithubToken(
  accessToken: string,
): Promise<OAuthProfile | null> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;

    const user = await response.json();
    if (typeof user.id !== 'number') return null;

    let email: string | undefined =
      typeof user.email === 'string' ? user.email : undefined;

    // Fall back to /user/emails if public email is not set
    if (!email) {
      try {
        const emailRes = await fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (emailRes.ok) {
          const emails = await emailRes.json();
          const primary = emails.find(
            (e: { primary: boolean; verified: boolean; email: string }) =>
              e.primary && e.verified,
          );
          if (primary) email = primary.email;
        }
      } catch {
        // Non-fatal — proceed without email
      }
    }

    return {
      providerUserId: String(user.id),
      email,
      name: typeof user.name === 'string' ? user.name : undefined,
      image:
        typeof user.avatar_url === 'string' ? user.avatar_url : undefined,
    };
  } catch {
    return null;
  }
}
