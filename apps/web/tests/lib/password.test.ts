/**
 * password: scrypt hashing for the local profile sign-in. Verifies round trip,
 * salting, the versioned format, and that malformed input fails closed rather
 * than throwing. The plaintext must never appear in the stored hash.
 */
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/password';

describe('password hashing', () => {
  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('hunter2');
    expect(await verifyPassword('hunter3', hash)).toBe(false);
  });

  it('produces a salted, versioned hash that never contains the plaintext', async () => {
    const a = await hashPassword('same-secret');
    const b = await hashPassword('same-secret');
    expect(a).not.toBe(b); // random salt
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(a).not.toContain('same-secret');
  });

  it('fails closed on malformed stored values without throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$16384$zz$')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$1$aa$bb')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});
