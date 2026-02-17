import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';
import { generateApiKey } from '@/lib/api-keys';

const appleJWKS = createRemoteJWKSet(
  new URL('https://appleid.apple.com/auth/keys'),
);

const devLoginSchema = z.object({
  email: z.string().email(),
});

const oauthIdTokenSchema = z.object({
  provider: z.enum(['apple', 'twitter']),
  idToken: z.string().min(1),
});

const oauthCodeSchema = z.object({
  provider: z.enum(['google', 'github']),
  code: z.string().min(1),
  codeVerifier: z.string().optional(),
  redirectUri: z.string().min(1),
});

const oauthLoginSchema = z.union([oauthIdTokenSchema, oauthCodeSchema]);

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (process.env.NODE_ENV === 'development') {
    return handleDevLogin(body);
  }

  return handleOAuthLogin(body);
}

async function handleDevLogin(body: unknown) {
  const parsed = devLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Valid email is required' },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, name: true, email: true, handle: true, image: true, role: true },
  });

  if (!user) {
    return NextResponse.json(
      { error: 'No account found with this email. Sign up on sotto.fm first.' },
      { status: 404 },
    );
  }

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

async function handleOAuthLogin(body: unknown) {
  const parsed = oauthLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'provider and idToken or code are required' },
      { status: 400 },
    );
  }

  const { provider } = parsed.data;
  let providerUserId: string | null;

  if ('idToken' in parsed.data) {
    providerUserId = await verifyOAuthToken(provider, parsed.data.idToken);
  } else {
    const { code, codeVerifier, redirectUri } = parsed.data;
    if (provider === 'google') {
      providerUserId = await exchangeGoogleCode(code, codeVerifier, redirectUri);
    } else {
      providerUserId = await exchangeGithubCode(code, redirectUri);
    }
  }

  if (!providerUserId) {
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401 },
    );
  }

  const account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId: providerUserId,
      },
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, handle: true, image: true, role: true },
      },
    },
  });

  if (!account) {
    return NextResponse.json(
      { error: 'No account linked to this provider. Sign up on sotto.fm first.' },
      { status: 404 },
    );
  }

  const { key, hash, prefix } = generateApiKey();

  await prisma.apiKey.create({
    data: {
      userId: account.userId,
      name: 'Mobile App',
      keyHash: hash,
      keyPrefix: prefix,
    },
  });

  return NextResponse.json({
    token: key,
    user: account.user,
  });
}

async function exchangeGoogleCode(
  code: string,
  codeVerifier: string | undefined,
  redirectUri: string,
): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
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
    if (typeof tokenData.id_token !== 'string') return null;

    return verifyGoogleToken(tokenData.id_token);
  } catch {
    return null;
  }
}

async function exchangeGithubCode(
  code: string,
  redirectUri: string,
): Promise<string | null> {
  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
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
    });
    if (!response.ok) return null;

    const tokenData = await response.json();
    if (typeof tokenData.access_token !== 'string') return null;

    return verifyGithubToken(tokenData.access_token);
  } catch {
    return null;
  }
}

async function verifyOAuthToken(
  provider: string,
  idToken: string,
): Promise<string | null> {
  switch (provider) {
    case 'apple': {
      const payload = await verifyAppleToken(idToken);
      return payload;
    }
    case 'google': {
      const payload = await verifyGoogleToken(idToken);
      return payload;
    }
    case 'github': {
      const payload = await verifyGithubToken(idToken);
      return payload;
    }
    case 'twitter': {
      const payload = await verifyTwitterToken(idToken);
      return payload;
    }
    default:
      return null;
  }
}

async function verifyAppleToken(idToken: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(idToken, appleJWKS, {
      issuer: 'https://appleid.apple.com',
      audience: process.env.APPLE_CLIENT_ID,
    });

    if (typeof payload.sub !== 'string') return null;

    return payload.sub;
  } catch {
    return null;
  }
}

async function verifyGoogleToken(idToken: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!response.ok) return null;

    const payload = await response.json();
    if (typeof payload.sub !== 'string') return null;

    return payload.sub;
  } catch {
    return null;
  }
}

async function verifyGithubToken(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;

    const user = await response.json();
    if (typeof user.id !== 'number') return null;

    return String(user.id);
  } catch {
    return null;
  }
}

async function verifyTwitterToken(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;

    const result = await response.json();
    if (typeof result.data?.id !== 'string') return null;

    return result.data.id;
  } catch {
    return null;
  }
}
