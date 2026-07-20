/**
 * Device pairing token lifecycle. Tokens are single-use, short-lived, and stored
 * only as a hash. These tests lock the security-critical redemption path: unknown,
 * expired, already-used, and race-claimed tokens must all fail closed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const mockCreate = vi.fn();
const mockFindUnique = vi.fn();
const mockUpdateMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    pairingToken: {
      create: (...a: unknown[]) => mockCreate(...a),
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      updateMany: (...a: unknown[]) => mockUpdateMany(...a),
    },
  },
}));

import { createPairingToken, redeemPairingToken } from '@/lib/pairing';

const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

describe('createPairingToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists only the hash and returns the raw token + expiry', async () => {
    mockCreate.mockResolvedValue({});
    const { token, expiresAt } = await createPairingToken('user-1');

    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/); // base64url, never empty
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const arg = mockCreate.mock.calls[0][0] as { data: { tokenHash: string; userId: string } };
    expect(arg.data.userId).toBe('user-1');
    expect(arg.data.tokenHash).toBe(hash(token)); // raw token never stored
    expect(arg.data).not.toHaveProperty('token');
  });
});

describe('redeemPairingToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redeems a valid unused token and claims it atomically', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'pt-1',
      userId: 'user-1',
      name: 'iPad',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const result = await redeemPairingToken('rawtoken');

    expect(result).toEqual({ userId: 'user-1', name: 'iPad' });
    // single-use claim only touches a row that is still unused
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'pt-1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('returns null for an unknown token (and never claims)', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await redeemPairingToken('nope')).toBeNull();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('returns null for an already-used token', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'pt-1',
      userId: 'user-1',
      name: 'd',
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await redeemPairingToken('used')).toBeNull();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('returns null for an expired token', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'pt-1',
      userId: 'user-1',
      name: 'd',
      usedAt: null,
      expiresAt: new Date(Date.now() - 1),
    });
    expect(await redeemPairingToken('old')).toBeNull();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('returns null when a concurrent redeem already claimed it (count 0)', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'pt-1',
      userId: 'user-1',
      name: 'd',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockUpdateMany.mockResolvedValue({ count: 0 }); // lost the race
    expect(await redeemPairingToken('raced')).toBeNull();
  });
});
