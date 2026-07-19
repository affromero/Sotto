import crypto from 'crypto';
import { prisma } from './prisma';
import { auth } from './auth';
import { logger } from './logger';
import { accessPasswordConfigured, verifyGateToken, GATE_COOKIE } from './access/gate';
import type { NextRequest } from 'next/server';

const KEY_PREFIX = 'sk_sotto_';
const PROFILE_HEADER = 'x-sotto-profile-id';

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
  prisma.apiKey
    .update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    })
    .catch((err) => {
      logger.warn('Failed to update API key lastUsedAt', {
        keyId: apiKey.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

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
      const apiKeyAuth = await validateApiKey(token);
      if (!apiKeyAuth) return null;

      const requestedProfileId = request.headers.get(PROFILE_HEADER)?.trim();
      if (!requestedProfileId) return apiKeyAuth;

      // Native/tablet clients carry one paired API key and choose a household
      // profile separately. Match the passwordless local picker, but fail closed
      // if the selected profile no longer exists.
      const profile = await prisma.user.findUnique({
        where: { id: requestedProfileId },
        select: { id: true },
      });

      return profile ? { userId: profile.id } : null;
    }
  }

  // On gated public instances the cookie-session fallback is only available to
  // browsers that opened the access gate; without this, any anonymous request
  // would resolve to the owner profile. Bearer clients never reach this path.
  if (accessPasswordConfigured()) {
    const gateToken = request.cookies.get(GATE_COOKIE)?.value;
    if (!(await verifyGateToken(gateToken))) return null;
  }

  // Fall back to session auth
  const session = await auth();
  if (session?.user?.id) {
    return { userId: session.user.id };
  }

  return null;
}
