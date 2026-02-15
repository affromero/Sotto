import { prisma } from './prisma';
import { hasAiKey } from './byok';
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
 * isByokUser = has at least one valid AI key AND at least one valid TTS key.
 * A user with only one side is treated as free tier (platform subsidizes the missing half).
 */
export async function checkGenerationGate(userId: string): Promise<GenerationGateResult> {
  const [hasAi, hasTts] = await Promise.all([hasAiKey(userId), hasByokKey(userId)]);
  const isByokUser = hasAi && hasTts;

  const config = await getFreeTierConfig();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { freeGenerationsUsed: true, role: true },
  });

  const isAdmin = user.role === 'ADMIN';

  // Admin and BYOK users are always allowed, no counting
  if (isAdmin || isByokUser) {
    return {
      allowed: true,
      reason: 'ok',
      freeGenerationsUsed: user.freeGenerationsUsed,
      freeGenerationsLimit: config.generationLimit,
      isByokUser: true,
    };
  }

  // Check platform key availability (both AI and TTS must be available)
  const hasPlatformAi =
    !!process.env.ANTHROPIC_API_KEY ||
    !!process.env.OPENAI_API_KEY ||
    process.env.AI_PROVIDER === 'claude-code';
  const hasPlatformTts = !!process.env.ELEVENLABS_API_KEY || !!process.env.OPENAI_API_KEY;

  if (!hasPlatformAi || !hasPlatformTts) {
    // Platform can't subsidize — check if user's partial BYOK covers the gap
    const canResolve = (hasAi || hasPlatformAi) && (hasTts || hasPlatformTts);
    if (!canResolve) {
      return {
        allowed: false,
        reason: 'no_provider',
        freeGenerationsUsed: user.freeGenerationsUsed,
        freeGenerationsLimit: config.generationLimit,
        isByokUser: false,
      };
    }
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
  const [hasAi, hasTts] = await Promise.all([hasAiKey(userId), hasByokKey(userId)]);
  const isByokUser = hasAi && hasTts;
  const config = await getFreeTierConfig();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { freeGenerationsUsed: true, role: true },
  });

  const isAdmin = user.role === 'ADMIN';

  return {
    freeGenerationsUsed: user.freeGenerationsUsed,
    freeGenerationsLimit: config.generationLimit,
    freeGenerationsRemaining: Math.max(0, config.generationLimit - user.freeGenerationsUsed),
    isByokUser: isByokUser || isAdmin,
  };
}
