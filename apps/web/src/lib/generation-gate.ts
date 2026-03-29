import { prisma } from './prisma';
import { hasByokKey } from './byok';
import { getAutoModelConfig, type ProviderAllocation } from './auto-model-config';
import { getRedisClient } from './redis';
import { getReferralBonus, getActiveReferralCount } from './referrals';

export interface ProviderQuotaStatus {
  provider: string;
  model: string;
  quota: number;
  used: number;
  remaining: number;
}

export type GateReason =
  | 'ok'
  | 'no_provider'
  | 'daily_limit_reached'
  | 'generation_in_progress'
  | 'budget_exceeded';

export interface GenerationGateResult {
  allowed: boolean;
  reason: GateReason;
  dailyUsed: number;
  dailyLimit: number;
  resetInSeconds?: number;
  isByokUser: boolean;
  isProUser: boolean;
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
 * Get the Redis daily counter value for a user without incrementing.
 * Returns { count, ttl } where ttl is seconds until reset (-1 = no TTL).
 */
async function getDailyCount(userId: string): Promise<{ count: number; ttl: number }> {
  const redis = getRedisClient();
  const key = `free:daily:${userId}`;
  const [countStr, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
  return { count: parseInt(countStr ?? '0', 10), ttl };
}

/**
 * Check whether a free user already has a non-terminal podcast in progress.
 * Returns true if any podcast created in the last 24h is still in a pipeline state.
 * The 24h cap prevents ancient stuck podcasts from blocking the user forever.
 */
async function hasInFlightGeneration(userId: string): Promise<boolean> {
  const count = await prisma.podcast.count({
    where: {
      userId,
      status: { notIn: ['READY', 'FAILED', 'DRAFT', 'DUPLICATE_REVIEW'] },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  return count > 0;
}

/**
 * Check whether a user is allowed to start a new generation.
 *
 * Priority:
 * 1. BYOK user (has TTS key)  → always allowed, no counting
 * 2. Admin/System              → always allowed
 * 3. PRO user                  → check Redis, limit = dailyGenerationLimitPro (default 5)
 * 4. Free user                 → check in-flight generation, then Redis rolling-window daily counter
 *                                (TTL 24h, configurable limit via AutoModelConfig)
 */
export async function checkGenerationGate(userId: string): Promise<GenerationGateResult> {
  const [hasTts, config, user] = await Promise.all([
    hasByokKey(userId),
    getAutoModelConfig(),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        role: true,
        plan: true,
        dailyGenerationOverride: true,
        spentMonthCents: true,
        budgetMonthCents: true,
        spentMonthResetAt: true,
      },
    }),
  ]);

  const isByokUser = hasTts;
  const isProUser = user.plan === 'PRO';
  const isPrivileged = user.role === 'ADMIN' || user.role === 'SYSTEM';

  const baseLimit =
    user.dailyGenerationOverride !== null
      ? user.dailyGenerationOverride
      : isProUser
        ? config.dailyGenerationLimitPro
        : config.dailyGenerationLimit;

  // Only compute referral bonus for free users
  const referralBonus =
    isByokUser || isProUser || isPrivileged
      ? 0
      : getReferralBonus(await getActiveReferralCount(userId));
  const effectiveDailyLimit = baseLimit + referralBonus;

  const baseResult = {
    dailyUsed: 0,
    dailyLimit: effectiveDailyLimit,
    isByokUser,
    isProUser,
  };

  // BYOK and privileged users bypass all counters
  if (isByokUser || isPrivileged) {
    return { ...baseResult, allowed: true, reason: 'ok', isByokUser: true };
  }

  // Per-user unlimited override (dailyGenerationOverride === 0)
  if (user.dailyGenerationOverride === 0) {
    return { ...baseResult, allowed: true, reason: 'ok' };
  }

  // Budget enforcement (budgetMonthCents > 0 means a cap is set)
  if (user.budgetMonthCents > 0) {
    const now = new Date();
    const resetAt = user.spentMonthResetAt;
    if (!resetAt || resetAt.getMonth() !== now.getMonth() || resetAt.getFullYear() !== now.getFullYear()) {
      // New month — reset spend counter
      await prisma.user.update({
        where: { id: userId },
        data: { spentMonthCents: 0, spentMonthResetAt: now },
      });
    } else if (user.spentMonthCents >= user.budgetMonthCents) {
      return { ...baseResult, allowed: false, reason: 'budget_exceeded' as GateReason };
    }
  }

  // Ensure platform TTS is available
  const hasPlatformTts =
    !!process.env.ELEVENLABS_API_KEY ||
    !!process.env.OPENAI_API_KEY;

  if (!hasPlatformTts) {
    return { ...baseResult, allowed: false, reason: 'no_provider' };
  }

  // Free user only: check for in-flight generation before allowing a new one
  if (!isProUser && await hasInFlightGeneration(userId)) {
    return {
      ...baseResult,
      allowed: false,
      reason: 'generation_in_progress',
    };
  }

  // Check Redis rolling 24h window (both Free and Pro)
  const { count: dailyUsed, ttl } = await getDailyCount(userId);

  if (dailyUsed >= effectiveDailyLimit) {
    const resetInSeconds = ttl > 0 ? ttl : 86400;
    return {
      ...baseResult,
      allowed: false,
      reason: 'daily_limit_reached',
      dailyUsed,
      resetInSeconds,
    };
  }

  return { ...baseResult, allowed: true, reason: 'ok', dailyUsed };
}

/**
 * Atomically increment the free-user daily Redis counter.
 * Returns true if the increment succeeded (user was under limit).
 * Returns false if already at limit (TOCTOU-safe).
 *
 * Also increments the lifetime freeGenerationsUsed counter for analytics.
 */
export async function tryIncrementFreeGeneration(
  userId: string,
  limit: number,
  providerUsage?: {
    ai?: { provider: string; quota: number };
    tts?: { provider: string; quota: number };
  }
): Promise<boolean> {
  const redis = getRedisClient();
  const key = `free:daily:${userId}`;

  // Lua script: increment only if count < limit, set TTL on first increment
  const lua = `
    local current = redis.call('GET', KEYS[1])
    local count = tonumber(current) or 0
    if count >= tonumber(ARGV[1]) then
      return -1
    end
    local newCount = redis.call('INCR', KEYS[1])
    if newCount == 1 then
      redis.call('EXPIRE', KEYS[1], 86400)
    end
    return newCount
  `;

  const result = await redis.eval(lua, 1, key, String(limit));
  if (result === -1) return false;

  // Per-provider TTS usage tracking
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

  // Per-provider AI usage tracking
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
 * Record a successful free-tier generation (called by workers when podcast reaches READY).
 *
 * Increments the Redis daily counter unconditionally (no limit check — we already gated
 * at creation time via checkGenerationGate) and bumps the lifetime analytics counter.
 */
export async function consumeFreeGeneration(
  userId: string,
  providerUsage?: {
    ai?: { provider: string; quota: number };
    tts?: { provider: string; quota: number };
  }
): Promise<void> {
  const redis = getRedisClient();
  const key = `free:daily:${userId}`;

  // Increment daily counter unconditionally, set 24h TTL on first use
  const lua = `
    local newCount = redis.call('INCR', KEYS[1])
    if newCount == 1 then
      redis.call('EXPIRE', KEYS[1], 86400)
    end
    return newCount
  `;
  await redis.eval(lua, 1, key);

  // Per-provider TTS usage tracking
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

  // Per-provider AI usage tracking
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
}

/**
 * Get free tier status for display purposes (dashboard, billing).
 */
export async function getFreeTierStatus(userId: string): Promise<{
  dailyUsed: number;
  dailyLimit: number;
  dailyRemaining: number;
  resetInSeconds?: number;
  isByokUser: boolean;
  isProUser: boolean;
  aiQuotas?: ProviderQuotaStatus[];
  ttsQuotas?: ProviderQuotaStatus[];
}> {
  const [hasTts, config, user, dailyData] = await Promise.all([
    hasByokKey(userId),
    getAutoModelConfig(),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, plan: true, dailyGenerationOverride: true },
    }),
    getDailyCount(userId),
  ]);

  const isByokUser = hasTts;
  const isPrivileged = user.role === 'ADMIN' || user.role === 'SYSTEM';
  const isProUser = user.plan === 'PRO';

  const baseLimit =
    user.dailyGenerationOverride !== null
      ? user.dailyGenerationOverride
      : isProUser
        ? config.dailyGenerationLimitPro
        : config.dailyGenerationLimit;

  const referralBonus =
    isByokUser || isPrivileged || isProUser
      ? 0
      : getReferralBonus(await getActiveReferralCount(userId));
  const effectiveDailyLimit = baseLimit + referralBonus;

  const base = {
    dailyUsed: dailyData.count,
    dailyLimit: effectiveDailyLimit,
    dailyRemaining: effectiveDailyLimit === 0 ? Infinity : Math.max(0, effectiveDailyLimit - dailyData.count),
    ...(dailyData.ttl > 0 && { resetInSeconds: dailyData.ttl }),
    isByokUser: isByokUser || isPrivileged,
    isProUser,
  };

  if (base.isByokUser) return base;

  const hasAllocations = config.ttsAllocations.length > 0 || config.aiAllocations.length > 0;
  if (!hasAllocations) return base;

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
