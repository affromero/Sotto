import {
  scrypt,
  randomBytes,
  timingSafeEqual,
  type ScryptOptions,
  type BinaryLike,
} from 'crypto';
import { promisify } from 'util';

/**
 * Local password hashing for the self-hosted profile sign-in. Uses Node's built
 * in scrypt (no extra dependency) with a random per-user salt. The stored value
 * is a single versioned string `scrypt$N$saltHex$hashHex`, so the cost can be
 * raised later without breaking existing hashes. Verification is constant-time.
 *
 * Passwords are never logged, and only the hash is persisted (User.passwordHash).
 */

const scryptAsync = promisify<BinaryLike, BinaryLike, number, ScryptOptions, Buffer>(
  scrypt
);

// scrypt cost. 16384 keeps verification fast while staying well above brute
// force comfort for local accounts. r=8, keylen=64. Memory ~ 128*N*r = 16 MB.
const COST = 16384;
const KEYLEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(plain, salt, KEYLEN, { N: COST })) as Buffer;
  return `scrypt$${COST}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;

  const cost = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(cost) || cost < 1) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[2], 'hex');
    expected = Buffer.from(parts[3], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = (await scryptAsync(plain, salt, expected.length, { N: cost })) as Buffer;
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
