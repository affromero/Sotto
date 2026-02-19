import { prisma } from './prisma';
import { hasByokKey } from './byok';
import { getFreeTierConfig, type ProviderAllocation } from './free-tier-config';

export interface ProviderQuotaStatus {
  provider: string;
  model: string;
  quota: number;
  used: number;
  remaining: number;
}

export interface GenerationGateResult {
  allowed: boolean;
  reason: 'ok' | 'no_provider' | 'free_tier_exhausted';
  freeGenerationsUsed: number;
  freeGenerationsLimit: number;
  isByokUser: boolean;
  aiQuotas?: ProviderQuotaStatus[];
  ttsQuotas?: ProviderQuotaStatus[];
}

/**
 * Build per-provider quota status from allocations + usage rows.
 */
function buildQuotaStatuses(
  allocations: ProviderAllocation[],
  usageRows: { provider: string; used: number }[]
): ProviderQuotaStatus[] {
  const usageMap = new Map(usageRows.map((r) => [r.provider, r.used]));
  return allocations.map((a) => {
    const used = usageMap.get(a.provider) ?? 0;
    return {
      provider: a.provider,
      model: a.model,
      quota: a.quota,
      used,
      remaining: Math.max(0, a.quota - used),
    };
  });
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

  // Free tier: check total counter
  if (user.freeGenerationsUsed >= config.generationLimit) {
    return {
      allowed: false,
      reason: 'free_tier_exhausted',
      freeGenerationsUsed: user.freeGenerationsUsed,
      freeGenerationsLimit: config.generationLimit,
      isByokUser: false,
    };
  }

  // Per-provider quota breakdown (when allocations are configured)
  const hasAllocations = config.ttsAllocations.length > 0 || config.aiAllocations.length > 0;
  let aiQuotas: ProviderQuotaStatus[] | undefined;
  let ttsQuotas: ProviderQuotaStatus[] | undefined;

  if (hasAllocations) {
    const usageRows = await prisma.freeProviderUsage.findMany({
      where: { userId },
      select: { category: true, provider: true, used: true },
    });

    if (config.aiAllocations.length > 0) {
      aiQuotas = buildQuotaStatuses(
        config.aiAllocations,
        usageRows.filter((r) => r.category === 'ai')
      );
    }

    if (config.ttsAllocations.length > 0) {
      ttsQuotas = buildQuotaStatuses(
        config.ttsAllocations,
        usageRows.filter((r) => r.category === 'tts')
      );

      // If TTS allocations exist but all are exhausted, block generation
      const anyTtsRemaining = ttsQuotas.some((q) => q.remaining > 0);
      if (!anyTtsRemaining) {
        return {
          allowed: false,
          reason: 'free_tier_exhausted',
          freeGenerationsUsed: user.freeGenerationsUsed,
          freeGenerationsLimit: config.generationLimit,
          isByokUser: false,
          aiQuotas,
          ttsQuotas,
        };
      }
    }
  }

  return {
    allowed: true,
    reason: 'ok',
    freeGenerationsUsed: user.freeGenerationsUsed,
    freeGenerationsLimit: config.generationLimit,
    isByokUser: false,
    aiQuotas,
    ttsQuotas,
  };
}

/**
 * Atomically increment free generation counter.
 * Returns true if incremented, false if already at limit (TOCTOU-safe).
 *
 * When providerUsage is given, also increments per-provider tracking counters.
 * If the total increment succeeds but a per-provider increment fails (quota exhausted),
 * the total counter is conservatively over-counted — safe direction.
 */
export async function tryIncrementFreeGeneration(
  userId: string,
  limit: number,
  providerUsage?: {
    ai?: { provider: string; quota: number };
    tts?: { provider: string; quota: number };
  }
): Promise<boolean> {
  // Step 1: Increment total counter (unchanged from before)
  const result = await prisma.$executeRaw`
    UPDATE "User"
    SET "freeGenerationsUsed" = "freeGenerationsUsed" + 1
    WHERE id = ${userId}
    AND "freeGenerationsUsed" < ${limit}
  `;
  if (result === 0) return false;

  // Step 2: Increment per-provider TTS usage (if provided)
  if (providerUsage?.tts) {
    const { provider, quota } = providerUsage.tts;
    await prisma.$executeRaw`
      INSERT INTO "FreeProviderUsage" (id, "userId", category, provider, used)
      VALUES (gen_random_uuid(), ${userId}, 'tts', ${provider}, 1)
      ON CONFLICT ("userId", category, provider)
      DO UPDATE SET used = "FreeProviderUsage".used + 1
      WHERE "FreeProviderUsage".used < ${quota}
    `;
  }

  // Step 3: Increment per-provider AI usage (if provided)
  if (providerUsage?.ai) {
    const { provider, quota } = providerUsage.ai;
    await prisma.$executeRaw`
      INSERT INTO "FreeProviderUsage" (id, "userId", category, provider, used)
      VALUES (gen_random_uuid(), ${userId}, 'ai', ${provider}, 1)
      ON CONFLICT ("userId", category, provider)
      DO UPDATE SET used = "FreeProviderUsage".used + 1
      WHERE "FreeProviderUsage".used < ${quota}
    `;
  }

  return true;
}

/**
 * Get free tier status for display purposes (dashboard, billing).
 */
export async function getFreeTierStatus(userId: string): Promise<{
  freeGenerationsUsed: number;
  freeGenerationsLimit: number;
  freeGenerationsRemaining: number;
  isByokUser: boolean;
  aiQuotas?: ProviderQuotaStatus[];
  ttsQuotas?: ProviderQuotaStatus[];
}> {
  const hasTts = await hasByokKey(userId);
  const isByokUser = hasTts;
  const config = await getFreeTierConfig();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { freeGenerationsUsed: true, role: true },
  });

  const isPrivileged = user.role === 'ADMIN' || user.role === 'SYSTEM';

  const base = {
    freeGenerationsUsed: user.freeGenerationsUsed,
    freeGenerationsLimit: config.generationLimit,
    freeGenerationsRemaining: Math.max(0, config.generationLimit - user.freeGenerationsUsed),
    isByokUser: isByokUser || isPrivileged,
  };

  // Add per-provider breakdowns when allocations are active
  const hasAllocations = config.ttsAllocations.length > 0 || config.aiAllocations.length > 0;
  if (!hasAllocations || base.isByokUser) return base;

  const usageRows = await prisma.freeProviderUsage.findMany({
    where: { userId },
    select: { category: true, provider: true, used: true },
  });

  return {
    ...base,
    ...(config.aiAllocations.length > 0 && {
      aiQuotas: buildQuotaStatuses(
        config.aiAllocations,
        usageRows.filter((r) => r.category === 'ai')
      ),
    }),
    ...(config.ttsAllocations.length > 0 && {
      ttsQuotas: buildQuotaStatuses(
        config.ttsAllocations,
        usageRows.filter((r) => r.category === 'tts')
      ),
    }),
  };
}
