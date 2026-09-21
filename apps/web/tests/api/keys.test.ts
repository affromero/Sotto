// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { tokenHash } from 'thesidedoor-core/access';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../helpers/setup/shared-instance';
import { GET, POST } from '@/app/api/v1/keys/route';
import { DELETE } from '@/app/api/v1/keys/[keyId]/route';
import { authenticateRequest } from '@/lib/api-keys';
import { issueSottoPairing, redeemSottoPairing } from '@/lib/sidedoor/access/core/pairing';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('API key routes with shared authority', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('keys');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    identity = await instance.reset();
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    binding.database = null;
    if (instance) await instance.close();
  });
  function request(
    method = 'GET',
    body?: unknown,
    token: string | null = identity.ownerToken,
    authorization?: string
  ) {
    const headers = new Headers({
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    });
    if (token) headers.set('cookie', `sotto_session=${token}`);
    if (authorization !== undefined) headers.set('authorization', authorization);
    return new NextRequest('http://localhost:3000/api/v1/keys', {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function create(name = 'My device') {
    const response = await POST(request('POST', { name }));
    expect(response.status).toBe(201);
    return response.json() as Promise<{ id: string; name: string; key: string; expiresAt: string }>;
  }
  it('requires authentication and never falls back from an invalid bearer to a valid cookie', async () => {
    expect((await GET(request('GET', undefined, null))).status).toBe(401);
    expect(
      (await GET(request('GET', undefined, identity.ownerToken, 'Bearer sk_sotto_forged'))).status
    ).toBe(401);
    expect((await POST(request('POST', { name: 'Tablet' }, null))).status).toBe(401);
  });
  it('requires a browser owner and prevents household sessions or device credentials from minting keys', async () => {
    const household = await identity.household('Learner');
    expect((await POST(request('POST', { name: 'Tablet' }, household.token))).status).toBe(403);
    const key = await create();
    expect(
      (await POST(request('POST', { name: 'Escalation' }, null, `Bearer ${key.key}`))).status
    ).toBe(403);
    expect(await instance.database.apiKey.count()).toBe(1);
  });
  it.each([{}, { name: '' }, { name: 'x'.repeat(101) }])(
    'validates key names without minting a credential',
    async (body) => {
      expect((await POST(request('POST', body))).status).toBe(400);
      expect(await instance.database.apiKey.count()).toBe(0);
    }
  );
  it('returns a usable secret once, retains only its hash, and lists safe expiry metadata', async () => {
    const created = await create('Phone');
    expect(created.key).toMatch(/^sk_sotto_/);
    const row = await instance.database.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.keyHash).toBe(tokenHash(created.key));
    expect(JSON.stringify(row)).not.toContain(created.key);
    expect(row.expiresAt?.toISOString()).toBe(created.expiresAt);
    const authenticated = await authenticateRequest(
      request('GET', undefined, null, `Bearer ${created.key}`)
    );
    expect(authenticated).toMatchObject({
      userId: identity.ownerId,
      isOwner: true,
      authentication: 'device',
    });
    const response = await GET(request());
    const list = (await response.json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, name: 'Phone', status: 'active' });
    expect(list[0]).not.toHaveProperty('key');
    expect(list[0]).not.toHaveProperty('keyHash');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('enforces the shared active-device quota without leaking failed minting records', async () => {
    for (let index = 0; index < 10; index++) await create(`Device ${index}`);
    const response = await POST(request('POST', { name: 'Over quota' }));
    expect(response.status).toBe(429);
    expect(await instance.database.apiKey.count()).toBe(10);
  });
  it('revokes authority and keeps history while making repeated owner revocation safe', async () => {
    const created = await create();
    const params = { params: Promise.resolve({ keyId: created.id }) };
    expect((await DELETE(request('DELETE'), params)).status).toBe(204);
    expect(
      await authenticateRequest(request('GET', undefined, null, `Bearer ${created.key}`))
    ).toBeNull();
    expect(
      (await instance.database.apiKey.findUniqueOrThrow({ where: { id: created.id } })).revokedAt
    ).not.toBeNull();
    expect((await DELETE(request('DELETE'), params)).status).toBe(204);
    const list = await (await GET(request())).json();
    expect(list).toEqual([expect.objectContaining({ id: created.id, status: 'revoked' })]);
  });
  it('denies another household access to private key history and revocation', async () => {
    const created = await create();
    const household = await identity.household('Other learner');
    expect(await (await GET(request('GET', undefined, household.token))).json()).toEqual([]);
    expect(
      (
        await DELETE(request('DELETE', undefined, household.token), {
          params: Promise.resolve({ keyId: created.id }),
        })
      ).status
    ).toBe(403);
    expect(
      await authenticateRequest(request('GET', undefined, null, `Bearer ${created.key}`))
    ).not.toBeNull();
  });
  it('rejects cross-origin mutations and returns 404 for an absent key', async () => {
    const forged = request('POST', { name: 'Forged' });
    forged.headers.set('origin', 'https://untrusted.example');
    expect((await POST(forged)).status).toBe(403);
    expect(
      (await DELETE(request('DELETE'), { params: Promise.resolve({ keyId: 'missing' }) })).status
    ).toBe(404);
    expect(await instance.database.apiKey.count()).toBe(0);
  });
  it('keeps a private member outside owner key management', async () => {
    const created = await create();
    await identity.access.addMember(identity.ownerToken, 'Member', 'private member password');
    const memberToken = await identity.access.login('Member', 'private member password');
    expect((await POST(request('POST', { name: 'Member key' }, memberToken))).status).toBe(403);
    expect(await (await GET(request('GET', undefined, memberToken))).json()).toEqual([]);
    expect(
      (
        await DELETE(request('DELETE', undefined, memberToken), {
          params: Promise.resolve({ keyId: created.id }),
        })
      ).status
    ).toBe(403);
    expect(
      await authenticateRequest(request('GET', undefined, null, `Bearer ${created.key}`))
    ).not.toBeNull();
  });
  it('limits an owner device to its delegated scope while allowing self-revocation', async () => {
    const other = await create('Owner management');
    const limited = await sottoTransaction(instance.database, async (tx) => {
      const pair = await issueSottoPairing(tx, identity.ownerToken, 'Limited device', {
        scopes: ['app'],
      });
      return redeemSottoPairing(tx, pair.token);
    });
    const row = await instance.database.apiKey.findUniqueOrThrow({
      where: { keyHash: tokenHash(limited.token) },
    });
    const bearer = `Bearer ${limited.token}`;
    expect(await authenticateRequest(request('GET', undefined, null, bearer))).toMatchObject({
      userId: identity.ownerId,
      isOwner: false,
      authentication: 'device',
    });
    expect(await (await GET(request('GET', undefined, null, bearer))).json()).toEqual([
      expect.objectContaining({ id: row.id }),
    ]);
    expect(
      (
        await DELETE(request('DELETE', undefined, null, bearer), {
          params: Promise.resolve({ keyId: other.id }),
        })
      ).status
    ).toBe(403);
    expect(
      (
        await DELETE(request('DELETE', undefined, null, bearer), {
          params: Promise.resolve({ keyId: row.id }),
        })
      ).status
    ).toBe(204);
    expect(await authenticateRequest(request('GET', undefined, null, bearer))).toBeNull();
    expect(
      await authenticateRequest(request('GET', undefined, null, `Bearer ${other.key}`))
    ).not.toBeNull();
  });
});
