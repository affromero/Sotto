import { prisma } from './prisma';
import { getAutoModelConfig } from './auto-model-config';
import { getRedisClient } from './redis';

export type VideoGateReason = 'ok' | 'no_image_provider' | 'daily_limit_reached';

export interface VideoGateResult {
  allowed: boolean;
  reason: VideoGateReason;
  dailyUsed: number;
  dailyLimit: number;
  dailyRemaining: number;
  resetInSeconds?: number;
  isByokUser: boolean;
  isProUser: boolean;
}

/**
 * Check whether the user has a BYOK key for image/video generation.
 */
async function hasImageByokKey(userId: string): Promise<boolean> {
  const key = await prisma.userTtsKey.findFirst({
    where: {
      userId,
      provider: { in: ['fal', 'minimax', 'heygen'] },
      isValid: true,
    },
    select: { id: true },
  });
  return !!key;
}

/**
 * Check whether an image/video provider is available (platform or BYOK).
 */
async function hasImageProvider(userId: string): Promise<boolean> {
  if (process.env.FAL_KEY || process.env.MINIMAX_API_KEY) return true;
  return hasImageByokKey(userId);
}

/**
 * Get the Redis daily video counter value without incrementing.
 */
async function getVideoDailyCount(userId: string): Promise<{ count: number; ttl: number }> {
  const redis = getRedisClient();
  const key = `free:video:daily:${userId}`;
  const [countStr, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
  return { count: parseInt(countStr ?? '0', 10), ttl };
}

/**
 * Check whether a user is allowed to start a new video generation.
 *
 * Priority:
 * 1. No image provider available → blocked (no_image_provider)
 * 2. BYOK (image key)            → always allowed, no counting
 * 3. Admin/System                 → always allowed
 * 4. PRO user                     → check Redis, limit = dailyVideoLimitPro (default 2)
 * 5. Free user                    → check Redis, limit = dailyVideoLimit (default 1)
 */
export async function checkVideoGenerationGate(userId: string): Promise<VideoGateResult> {
  const [hasByok, providerAvailable, config, user] = await Promise.all([
    hasImageByokKey(userId),
    hasImageProvider(userId),
    getAutoModelConfig(),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, plan: true },
    }),
  ]);

  const isProUser = user.plan === 'PRO';
  const isPrivileged = user.role === 'ADMIN' || user.role === 'SYSTEM';
  const dailyLimit = isProUser ? config.dailyVideoLimitPro : config.dailyVideoLimit;

  const baseResult: VideoGateResult = {
    allowed: false,
    reason: 'ok',
    dailyUsed: 0,
    dailyLimit,
    dailyRemaining: dailyLimit,
    isByokUser: hasByok,
    isProUser,
  };

  // No image provider at all
  if (!providerAvailable) {
    return { ...baseResult, reason: 'no_image_provider' };
  }

  // BYOK users bypass daily limits (using their own resources)
  if (hasByok) {
    return { ...baseResult, allowed: true };
  }

  // Admin/System bypass
  if (isPrivileged) {
    return { ...baseResult, allowed: true };
  }

  // Check Redis rolling 24h window
  const { count: dailyUsed, ttl } = await getVideoDailyCount(userId);

  if (dailyUsed >= dailyLimit) {
    const resetInSeconds = ttl > 0 ? ttl : 86400;
    return {
      ...baseResult,
      allowed: false,
      reason: 'daily_limit_reached',
      dailyUsed,
      dailyRemaining: 0,
      resetInSeconds,
    };
  }

  return {
    ...baseResult,
    allowed: true,
    dailyUsed,
    dailyRemaining: dailyLimit - dailyUsed,
  };
}

/**
 * Atomically increment the daily video Redis counter.
 * Returns true if the increment succeeded (user was under limit).
 * Returns false if already at limit (TOCTOU-safe).
 */
export async function tryIncrementVideoGeneration(
  userId: string,
  limit: number,
): Promise<boolean> {
  const redis = getRedisClient();
  const key = `free:video:daily:${userId}`;

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
  return result !== -1;
}

/**
 * Get video generation status for display purposes.
 */
export async function getVideoGenerationStatus(userId: string): Promise<{
  dailyUsed: number;
  dailyLimit: number;
  dailyRemaining: number;
  resetInSeconds?: number;
  isByokUser: boolean;
  isProUser: boolean;
}> {
  const [hasByok, config, user, dailyData] = await Promise.all([
    hasImageByokKey(userId),
    getAutoModelConfig(),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, plan: true },
    }),
    getVideoDailyCount(userId),
  ]);

  const isProUser = user.plan === 'PRO';
  const isPrivileged = user.role === 'ADMIN' || user.role === 'SYSTEM';
  const dailyLimit = isProUser ? config.dailyVideoLimitPro : config.dailyVideoLimit;

  return {
    dailyUsed: dailyData.count,
    dailyLimit,
    dailyRemaining: hasByok || isPrivileged
      ? Infinity
      : Math.max(0, dailyLimit - dailyData.count),
    ...(dailyData.ttl > 0 && { resetInSeconds: dailyData.ttl }),
    isByokUser: hasByok || isPrivileged,
    isProUser,
  };
}
