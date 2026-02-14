import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateApiKey } from '@/lib/api-keys';

const devLoginSchema = z.object({
  email: z.string().email(),
});

const oauthLoginSchema = z.object({
  provider: z.enum(['apple', 'google', 'github', 'twitter']),
  idToken: z.string().min(1),
});

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
      { error: 'provider and idToken are required' },
      { status: 400 },
    );
  }

  const { provider, idToken } = parsed.data;

  const providerUserId = await verifyOAuthToken(provider, idToken);
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
    const response = await fetch('https://appleid.apple.com/auth/keys');
    if (!response.ok) return null;

    // Decode the JWT payload without verification for the subject claim
    // Apple's idToken is a JWT — extract the `sub` (user ID)
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    );

    if (payload.iss !== 'https://appleid.apple.com') return null;
    if (typeof payload.sub !== 'string') return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;

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
