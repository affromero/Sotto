// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenHash } from 'thesidedoor-core/access';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../helpers/setup/shared-instance';
import { createPairingToken, redeemPairingToken } from '@/lib/pairing';

const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Pairing lifecycle with persistent shared authority', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('pairing');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    binding.database = null;
    if (instance) await instance.close();
  });
  it('persists only the pairing hash and creates a device belonging to the issuing principal', async () => {
    const pair = await createPairingToken(identity.ownerToken, 'Tablet');
    expect(pair.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const state = await identity.access.store.read();
    expect(state.tokens).toContainEqual(
      expect.objectContaining({ id: tokenHash(pair.token), kind: 'pair' })
    );
    expect(JSON.stringify(state)).not.toContain(pair.token);
    const redeemed = await redeemPairingToken(pair.token);
    expect(redeemed).toMatchObject({ user: { id: identity.ownerId, role: 'ADMIN' } });
    if (!redeemed) throw new Error('Expected successful redemption');
    const metadata = await instance.database.apiKey.findUniqueOrThrow({
      where: { keyHash: tokenHash(redeemed.token) },
    });
    expect(metadata).toMatchObject({ userId: identity.ownerId, name: 'Tablet' });
    expect(JSON.stringify(metadata)).not.toContain(redeemed.token);
    expect(await redeemPairingToken(pair.token)).toBeNull();
    expect(await instance.database.apiKey.count()).toBe(1);
  });
  it('allows exactly one concurrent redemption', async () => {
    const pair = await createPairingToken(identity.ownerToken);
    const results = await Promise.all([
      redeemPairingToken(pair.token),
      redeemPairingToken(pair.token),
    ]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(await instance.database.apiKey.count()).toBe(1);
  });
  it('invalidates pending pairing when its issuing browser session signs out', async () => {
    const pair = await createPairingToken(identity.ownerToken);
    await identity.access.logout(identity.ownerToken);
    expect(await redeemPairingToken(pair.token)).toBeNull();
    expect(await instance.database.apiKey.count()).toBe(0);
  });
  it('rejects unknown and expired pairing credentials without minting devices', async () => {
    expect(await redeemPairingToken('unknown-pairing-credential')).toBeNull();
    const pair = await createPairingToken(identity.ownerToken);
    await identity.access.store.transact((state) => {
      const pending = state.tokens.find((token) => token.id === tokenHash(pair.token));
      if (!pending) throw new Error('Missing pending pairing');
      pending.expiresAt = Date.now() - 1;
    });
    expect(await redeemPairingToken(pair.token)).toBeNull();
    expect(await instance.database.apiKey.count()).toBe(0);
  });
});
