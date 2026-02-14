import crypto from 'crypto';
import { prisma } from './prisma';
import { auth } from './auth';
import type { NextRequest } from 'next/server';

const KEY_PREFIX = 'sk_sotto_';

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const key = `${KEY_PREFIX}${randomBytes}`;
  const hash = hashApiKey(key);
  const prefix = key.substring(0, 16) + '...';
  return { key, hash, prefix };
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function validateApiKey(key: string): Promise<{ userId: string } | null> {
  const hash = hashApiKey(key);

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash: hash },
    select: { id: true, userId: true, revokedAt: true },
  });

  if (!apiKey || apiKey.revokedAt) {
    return null;
  }

  // Update lastUsedAt (fire and forget)
  prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  return { userId: apiKey.userId };
}

export async function authenticateRequest(
  request: NextRequest
): Promise<{ userId: string } | null> {
  // Check Bearer token first
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (token.startsWith(KEY_PREFIX)) {
      return validateApiKey(token);
    }
  }

  // Fall back to session auth
  const session = await auth();
  if (session?.user?.id) {
    return { userId: session.user.id };
  }

  return null;
}
