import { prisma } from './prisma';
import { getAutoModelConfig } from './auto-model-config';
import { getRedisClient } from './redis';

export type MusicGateReason = 'ok' | 'no_music_provider' | 'daily_limit_reached';

export interface MusicGateResult {
  allowed: boolean;
  reason: MusicGateReason;
  dailyUsed: number;
  dailyLimit: number;
  dailyRemaining: number;
  resetInSeconds?: number;
  isByokUser: boolean;
  isProUser: boolean;
}

/**
 * Check whether the user has a BYOK key for music generation.
 */
async function hasMusicByokKey(userId: string): Promise<boolean> {
  const key = await prisma.userTtsKey.findFirst({
    where: {
      userId,
      provider: { in: ['suno', 'elevenlabs'] },
      isValid: true,
    },
    select: { id: true },
  });
  return !!key;
}

/**
 * Check whether a music provider is available (platform or BYOK).
 */
async function hasMusicProvider(userId: string): Promise<boolean> {
  if (process.env.SUNO_API_KEY || process.env.ELEVENLABS_API_KEY) return true;
  return hasMusicByokKey(userId);
}

/**
 * Get the Redis daily music counter value without incrementing.
 */
async function getMusicDailyCount(userId: string): Promise<{ count: number; ttl: number }> {
  const redis = getRedisClient();
  const key = `free:music:daily:${userId}`;
  const [countStr, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
  return { count: parseInt(countStr ?? '0', 10), ttl };
}

/**
 * Check whether a user is allowed to start a new music generation.
 *
 * Priority:
 * 1. No music provider available → blocked (no_music_provider)
 * 2. BYOK (suno/elevenlabs key) → always allowed, no counting
 * 3. Admin/System               → always allowed
 * 4. PRO user                   → check Redis, limit = dailyMusicLimitPro (default 3)
 * 5. Free user                  → check Redis, limit = dailyMusicLimit (default 1)
 */
export async function checkMusicGenerationGate(userId: string): Promise<MusicGateResult> {
  const [hasByok, providerAvailable, config, user] = await Promise.all([
    hasMusicByokKey(userId),
    hasMusicProvider(userId),
    getAutoModelConfig(),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, plan: true },
    }),
  ]);

  const isProUser = user.plan === 'PRO';
  const isPrivileged = user.role === 'ADMIN' || user.role === 'SYSTEM';
  const dailyLimit = isProUser ? config.dailyMusicLimitPro : config.dailyMusicLimit;

  const baseResult: MusicGateResult = {
    allowed: false,
    reason: 'ok',
    dailyUsed: 0,
    dailyLimit,
    dailyRemaining: dailyLimit,
    isByokUser: hasByok,
    isProUser,
  };

  // No music provider at all
  if (!providerAvailable) {
    return { ...baseResult, reason: 'no_music_provider' };
  }

  // BYOK users bypass daily limits (using their own resources)
  if (hasByok) {
    return { ...baseResult, allowed: true };
  }

  // Admin/System bypass
  if (isPrivileged) {
    return { ...baseResult, allowed: true, isByokUser: true };
  }

  // Check Redis rolling 24h window
  const { count: dailyUsed, ttl } = await getMusicDailyCount(userId);

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
 * Get music generation status for display purposes.
 */
export async function getMusicGenerationStatus(userId: string): Promise<{
  dailyUsed: number;
  dailyLimit: number;
  dailyRemaining: number;
  resetInSeconds?: number;
  isByokUser: boolean;
  isProUser: boolean;
}> {
  const [hasByok, config, user, dailyData] = await Promise.all([
    hasMusicByokKey(userId),
    getAutoModelConfig(),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, plan: true },
    }),
    getMusicDailyCount(userId),
  ]);

  const isProUser = user.plan === 'PRO';
  const isPrivileged = user.role === 'ADMIN' || user.role === 'SYSTEM';
  const dailyLimit = isProUser ? config.dailyMusicLimitPro : config.dailyMusicLimit;

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

/**
 * Atomically increment the daily music Redis counter.
 * Returns true if the increment succeeded (user was under limit).
 * Returns false if already at limit (TOCTOU-safe).
 */
export async function tryIncrementMusicGeneration(
  userId: string,
  limit: number,
): Promise<boolean> {
  const redis = getRedisClient();
  const key = `free:music:daily:${userId}`;

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
