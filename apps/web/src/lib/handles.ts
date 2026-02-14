import { prisma } from './prisma';
import { generateResponse } from './claude';
import { cache } from './redis';
import { logger } from './logger';

const HANDLE_REGEX = /^[a-z0-9_]{3,30}$/;

/**
 * Hardcoded set of handles that can never be claimed by users.
 * Includes route segments, brand terms, and common system words.
 */
const RESERVED_HANDLES = new Set([
  // Brand / system
  'sotto',
  'admin',
  'support',
  'help',
  'official',
  'system',
  'bot',
  // Route segments
  'api',
  'feed',
  'create',
  'settings',
  'dashboard',
  'billing',
  'pricing',
  'auth',
  'login',
  'signup',
  'onboarding',
  'podcast',
  'profile',
  'team',
  'notifications',
  'analytics',
  'explore',
  'search',
  'trending',
  'home',
  'about',
  'contact',
  'terms',
  'privacy',
  // Reserved words
  'null',
  'undefined',
  'anonymous',
  'unknown',
  'deleted',
  'moderator',
  'mod',
  'staff',
  'root',
  'superadmin',
  'postmaster',
  'webmaster',
  'info',
  'abuse',
  'security',
  'noreply',
  'no_reply',
  'mailer',
  'daemon',
]);

const HANDLE_CHECK_CACHE_PREFIX = 'handle:check:';
const HANDLE_CHECK_CACHE_TTL = 60 * 60 * 24 * 30; // 30 days

type HandleCheckResult = 'NAME' | 'OFFENSIVE' | 'OK';

/**
 * LLM-based handle screening: catches common first names (premium)
 * and profane/offensive content in one call. Results cached in Redis.
 * Fails open — if the LLM or Redis is unavailable, allows the handle.
 */
export async function checkHandleContent(handle: string, apiKeyOverride?: string): Promise<HandleCheckResult> {
  const normalized = handle.toLowerCase();

  // Handles with underscores/digits are unlikely plain names or slurs
  if (normalized.includes('_') || /\d/.test(normalized)) {
    return 'OK';
  }

  try {
    const cacheKey = `${HANDLE_CHECK_CACHE_PREFIX}${normalized}`;
    const cached = await cache.get<HandleCheckResult>(cacheKey);
    if (cached !== null) return cached;

    const { content } = await generateResponse(
      'Classify the word into exactly one category. Answer with a single word: NAME, OFFENSIVE, or OK. Nothing else.',
      [
        {
          role: 'user',
          content: `Classify "${normalized}":\n- NAME if it is a common given name (first name) in any language or culture\n- OFFENSIVE if it is profane, vulgar, a slur, hate speech, or sexually explicit\n- OK otherwise`,
        },
      ],
      { maxTokens: 3, model: 'claude-haiku-4-5-20251001', apiKeyOverride }
    );

    const answer = content.trim().toUpperCase();
    const result: HandleCheckResult = answer.startsWith('NAME')
      ? 'NAME'
      : answer.startsWith('OFFENSIVE')
        ? 'OFFENSIVE'
        : 'OK';
    await cache.set(cacheKey, result, HANDLE_CHECK_CACHE_TTL);
    return result;
  } catch (err) {
    logger.warn('Handle content check failed, allowing handle', {
      handle: normalized,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'OK';
  }
}

/** @deprecated Use checkHandleContent instead */
export async function isPremiumHandle(handle: string): Promise<boolean> {
  return (await checkHandleContent(handle)) === 'NAME';
}

export function isValidHandleFormat(handle: string): boolean {
  return HANDLE_REGEX.test(handle);
}

export function isHardcodedReserved(handle: string): boolean {
  return RESERVED_HANDLES.has(handle.toLowerCase());
}

export async function isDbReserved(handle: string): Promise<boolean> {
  const reserved = await prisma.reservedHandle.findUnique({
    where: { handle: handle.toLowerCase() },
  });
  return !!reserved;
}

export async function isHandleTaken(handle: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { handle: handle.toLowerCase() },
    select: { id: true },
  });
  return !!user;
}

export async function isHandleAvailable(
  handle: string
): Promise<{ available: boolean; reason?: string }> {
  const normalized = handle.toLowerCase();

  if (!isValidHandleFormat(normalized)) {
    return {
      available: false,
      reason: 'Handle must be 3-30 characters, lowercase letters, numbers, and underscores only',
    };
  }

  if (isHardcodedReserved(normalized)) {
    return { available: false, reason: 'This handle is reserved' };
  }

  const contentCheck = await checkHandleContent(normalized);
  if (contentCheck === 'NAME') {
    return { available: false, reason: 'This handle is already taken' };
  }
  if (contentCheck === 'OFFENSIVE') {
    return { available: false, reason: 'This handle is not allowed' };
  }

  if (await isDbReserved(normalized)) {
    return { available: false, reason: 'This handle is reserved' };
  }

  if (await isHandleTaken(normalized)) {
    return { available: false, reason: 'This handle is already taken' };
  }

  return { available: true };
}

/**
 * Generate a candidate handle from a display name.
 * Lowercases, strips non-alphanumeric chars, replaces spaces with underscores.
 */
export function generateHandleFromName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 30);
}

/**
 * Generate a unique handle. Tries the base name first, then appends
 * random 4-digit suffixes, and falls back to a cuid-based handle.
 */
export async function generateUniqueHandle(name: string | null): Promise<string> {
  const base = name ? generateHandleFromName(name) : '';

  // If base is valid, try it first
  if (base.length >= 3 && isValidHandleFormat(base)) {
    const { available } = await isHandleAvailable(base);
    if (available) return base;
  }

  // Try with random suffixes (up to 10 attempts)
  const prefix = base.length >= 2 ? base.slice(0, 25) : 'user';
  for (let i = 0; i < 10; i++) {
    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    const candidate = `${prefix}_${suffix}`;
    if (isValidHandleFormat(candidate)) {
      const { available } = await isHandleAvailable(candidate);
      if (available) return candidate;
    }
  }

  // Fallback: random hex
  const { randomBytes } = await import('crypto');
  const fallback = `user_${randomBytes(6).toString('hex')}`;
  return fallback;
}
