import { prisma } from './prisma';
import { hasByokKey } from './byok';
import { getFreeTierConfig } from './free-tier-config';

export interface GenerationGateResult {
  allowed: boolean;
  reason: 'ok' | 'no_provider' | 'free_tier_exhausted';
  freeGenerationsUsed: number;
  freeGenerationsLimit: number;
  isByokUser: boolean;
}

/**
 * Check whether a user is allowed to start a new generation.
 *
 * isByokUser = has at least one valid TTS key.
 * AI is platform-subsidized for all users — no AI key required.
 */
export async function checkGenerationGate(userId: string): Promise<GenerationGateResult> {
  const hasTts = await hasByokKey(userId);
  const isByokUser = hasTts;

  const config = await getFreeTierConfig();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { freeGenerationsUsed: true, role: true },
  });

  const isPrivileged = user.role === 'ADMIN' || user.role === 'SYSTEM';

  // Admin, system, and BYOK users are always allowed, no counting
  if (isPrivileged || isByokUser) {
    return {
      allowed: true,
      reason: 'ok',
      freeGenerationsUsed: user.freeGenerationsUsed,
      freeGenerationsLimit: config.generationLimit,
      isByokUser: true,
    };
  }

  // Check platform TTS availability (AI is always platform-subsidized)
  const hasPlatformTts = !!process.env.ELEVENLABS_API_KEY || !!process.env.OPENAI_API_KEY;

  if (!hasPlatformTts && !hasTts) {
    return {
      allowed: false,
      reason: 'no_provider',
      freeGenerationsUsed: user.freeGenerationsUsed,
      freeGenerationsLimit: config.generationLimit,
      isByokUser: false,
    };
  }

  // Free tier: check counter
  if (user.freeGenerationsUsed >= config.generationLimit) {
    return {
      allowed: false,
      reason: 'free_tier_exhausted',
      freeGenerationsUsed: user.freeGenerationsUsed,
      freeGenerationsLimit: config.generationLimit,
      isByokUser: false,
    };
  }

  return {
    allowed: true,
    reason: 'ok',
    freeGenerationsUsed: user.freeGenerationsUsed,
    freeGenerationsLimit: config.generationLimit,
    isByokUser: false,
  };
}

/**
 * Atomically increment free generation counter.
 * Returns true if incremented, false if already at limit (TOCTOU-safe).
 */
export async function tryIncrementFreeGeneration(
  userId: string,
  limit: number
): Promise<boolean> {
  const result = await prisma.$executeRaw`
    UPDATE "User"
    SET "freeGenerationsUsed" = "freeGenerationsUsed" + 1
    WHERE id = ${userId}
    AND "freeGenerationsUsed" < ${limit}
  `;
  return result > 0;
}

/**
 * Get free tier status for display purposes (dashboard, billing).
 */
export async function getFreeTierStatus(userId: string): Promise<{
  freeGenerationsUsed: number;
  freeGenerationsLimit: number;
  freeGenerationsRemaining: number;
  isByokUser: boolean;
}> {
  const hasTts = await hasByokKey(userId);
  const isByokUser = hasTts;
  const config = await getFreeTierConfig();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { freeGenerationsUsed: true, role: true },
  });

  const isPrivileged = user.role === 'ADMIN' || user.role === 'SYSTEM';

  return {
    freeGenerationsUsed: user.freeGenerationsUsed,
    freeGenerationsLimit: config.generationLimit,
    freeGenerationsRemaining: Math.max(0, config.generationLimit - user.freeGenerationsUsed),
    isByokUser: isByokUser || isPrivileged,
  };
}
