import { prisma } from './prisma';
import { containsBlockedModerationTerm } from './local-moderation';

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

type HandleCheckResult = 'NAME' | 'OFFENSIVE' | 'OK';

const PREMIUM_NAME_HANDLES = new Set([
  'aaron',
  'adam',
  'alex',
  'alice',
  'ana',
  'andrew',
  'anna',
  'anthony',
  'ben',
  'benjamin',
  'bob',
  'bruno',
  'carlos',
  'charlie',
  'chris',
  'daniel',
  'david',
  'diego',
  'elena',
  'emily',
  'emma',
  'ethan',
  'eva',
  'fatima',
  'gabriel',
  'hannah',
  'isabella',
  'jack',
  'james',
  'john',
  'jose',
  'julia',
  'kate',
  'laura',
  'liam',
  'lucas',
  'lucia',
  'maria',
  'mark',
  'maya',
  'michael',
  'miguel',
  'noah',
  'olivia',
  'paul',
  'pedro',
  'sarah',
  'sofia',
  'sophia',
  'tom',
  'victor',
  'zoe',
]);

/**
 * Deterministic handle screening. Blocks obvious offensive terms and keeps
 * common first names unavailable for product/system namespace protection.
 */
export function checkHandleContent(handle: string): HandleCheckResult {
  const normalized = handle.toLowerCase();

  if (containsBlockedModerationTerm(normalized)) {
    return 'OFFENSIVE';
  }

  // Handles with underscores/digits are unlikely to be plain first-name claims.
  if (normalized.includes('_') || /\d/.test(normalized)) {
    return 'OK';
  }

  return PREMIUM_NAME_HANDLES.has(normalized) ? 'NAME' : 'OK';
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

  const contentCheck = checkHandleContent(normalized);
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
