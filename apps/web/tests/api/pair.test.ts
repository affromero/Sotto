// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { RedisOptions } from 'ioredis';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../helpers/setup/shared-instance';
import { POST as issue } from '@/app/api/v1/auth/pair/route';
import { POST as redeem } from '@/app/api/v1/auth/pair/redeem/route';
import { getRedisClient, closeRedis } from '@/lib/redis';
import { authenticateRequest } from '@/lib/api-keys';

const binding = vi.hoisted(() => {
  const configured = process.env.SIDEDOOR_TEST_REDIS_URL;
  if (configured) {
    const url = new URL(configured);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use isolated local Redis database 15');
    vi.stubEnv('REDIS_URL', url.href);
  }
  return { database: null as PrismaClient | null };
});
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('ioredis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ioredis')>();
  const keyPrefix = `sotto-pair-test:${crypto.randomUUID()}:`;
  return {
    ...actual,
    default: class IsolatedRedis extends actual.default {
      constructor(url: string, options: RedisOptions) {
        super(url, { ...options, keyPrefix } as never);
      }
    },
  };
});
const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;
suite('Pairing HTTP routes with shared authority and Redis', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    const url = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use isolated local Redis database 15');
    vi.stubEnv('REDIS_URL', url.href);
    instance = await createSharedTestInstance('pair_routes');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('REDIS_URL', process.env.SIDEDOOR_TEST_REDIS_URL!);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    identity = await instance.reset();
    await getRedisClient().del('ratelimit:pair-redeem:instance');
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await closeRedis();
    binding.database = null;
    if (instance) await instance.close();
  });
  function request(body: unknown, token: string | null = null, issuing = false) {
    const headers = new Headers({
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    });
    if (token) headers.set('cookie', `sotto_session=${token}`);
    const path = issuing ? '/api/v1/auth/pair' : '/api/v1/auth/pair/redeem';
    return new NextRequest(`http://localhost:3000${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }
  async function pairing(token = identity.ownerToken) {
    const response = await issue(
      request({ name: 'Tablet', reachUrl: 'https://sotto.tailnet.ts.net/' }, token, true)
    );
    expect(response.status).toBe(201);
    return response.json() as Promise<{
      token: string;
      serverUrl: string;
      connectUrl: string;
      expiresAt: string;
    }>;
  }
  it('requires a browser session and a trusted origin before issuing', async () => {
    expect((await issue(request({}, null, true))).status).toBe(401);
    const forged = request({}, identity.ownerToken, true);
    forged.headers.set('origin', 'https://untrusted.example');
    expect((await issue(forged)).status).toBe(403);
    const bearer = request({}, identity.ownerToken, true);
    bearer.headers.set('authorization', 'Bearer invalid');
    expect((await issue(bearer)).status).toBe(403);
    expect(await instance.database.apiKey.count()).toBe(0);
  });
  it('returns a reachable connect URL and a usable device credential exactly once', async () => {
    const pair = await pairing();
    expect(pair.serverUrl).toBe('https://sotto.tailnet.ts.net');
    expect(pair.connectUrl).toBe(
      `https://sotto.tailnet.ts.net/connect?token=${encodeURIComponent(pair.token)}`
    );
    expect(Date.parse(pair.expiresAt)).toBeGreaterThan(Date.now());
    const response = await redeem(request({ token: pair.token }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const result = await response.json();
    expect(result.user.id).toBe(identity.ownerId);
    const deviceRequest = request({});
    deviceRequest.headers.set('authorization', `Bearer ${result.token}`);
    expect(await authenticateRequest(deviceRequest)).toMatchObject({
      userId: identity.ownerId,
      authentication: 'device',
    });
    expect((await redeem(request({ token: pair.token }))).status).toBe(401);
    expect(await instance.database.apiKey.count()).toBe(1);
  });
  it('preserves the selected household learner when pairing a device', async () => {
    const household = await identity.household('Learner');
    const pair = await pairing(household.token);
    const response = await redeem(request({ token: pair.token }));
    expect(response.status).toBe(200);
    expect((await response.json()).user).toMatchObject({ id: household.id, role: 'USER' });
  });
  it('allows native clients to redeem without Origin, cookies, or browser headers', async () => {
    const pair = await pairing();
    const native = new NextRequest('http://localhost:3000/api/v1/auth/pair/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: pair.token }),
    });
    const response = await redeem(native);
    expect(response.status).toBe(200);
    expect((await response.json()).user.id).toBe(identity.ownerId);
  });
  it('rejects malformed and unknown credentials without creating device records', async () => {
    expect((await redeem(request({ token: 'x' }))).status).toBe(400);
    expect((await redeem(request({ token: 'unknown-pairing-token' }))).status).toBe(401);
    expect(await instance.database.apiKey.count()).toBe(0);
  });
  it('enforces one attempt budget despite rotating every forwarded address header', async () => {
    const pair = await pairing();
    for (let index = 0; index < 10; index++) {
      const attempt = request({ token: 'unknown-pairing-token' });
      attempt.headers.set('cf-connecting-ip', `192.0.2.${index}`);
      attempt.headers.set('x-real-ip', `198.51.100.${index}`);
      attempt.headers.set('x-forwarded-for', `203.0.113.${index}`);
      expect((await redeem(attempt)).status).toBe(401);
    }
    expect((await redeem(request({ token: pair.token }))).status).toBe(429);
    expect(await instance.database.apiKey.count()).toBe(0);
    await getRedisClient().del('ratelimit:pair-redeem:instance');
    expect((await redeem(request({ token: pair.token }))).status).toBe(200);
  });
  it('fails closed with a sanitized response when Redis cannot enforce the attempt budget', async () => {
    const pair = await pairing();
    await getRedisClient().set('ratelimit:pair-redeem:instance', 'invalid-counter-type');
    const response = await redeem(request({ token: pair.token }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Access is unavailable. Check the instance configuration and access setup.',
      requestId: expect.any(String),
    });
    expect(await instance.database.apiKey.count()).toBe(0);
    await getRedisClient().del('ratelimit:pair-redeem:instance');
    expect((await redeem(request({ token: pair.token }))).status).toBe(200);
  });
});
