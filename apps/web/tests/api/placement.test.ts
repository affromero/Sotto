// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../helpers/setup/shared-instance';
import { GET, POST } from '@/app/api/v1/placement/route';
import { POST as generate } from '@/app/api/v1/placement/generate/route';
const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('profile-bound asynchronous placement HTTP', () => {
  let instance: SharedTestInstance, owner: Awaited<ReturnType<SharedTestInstance['reset']>>;
  const origin = 'https://selfhost.example.com';
  beforeAll(async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'a'.repeat(64));
    instance = await createSharedTestInstance('placement_http');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    owner = await instance.reset();
    await instance.configureInfrastructure({
      aiProvider: 'local',
      aiModel: 'local:owned-quiz-fixture',
      aiBaseUrl: 'http://127.0.0.1:9999/v1',
    });
    await instance.database.user.update({
      where: { id: owner.ownerId },
      data: { preferredAiProvider: 'local', preferredAiModel: 'local:owned-quiz-fixture' },
    });
    vi.stubGlobal('fetch', () => {
      throw new Error('Placement admission must not invoke a paid or external provider');
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
    vi.unstubAllEnvs();
  });
  function get(query: string, token: string | null = owner.ownerToken, requestOrigin = origin) {
    return GET(
      new NextRequest(`${origin}/api/v1/placement?${query}`, {
        headers: { ...(token ? { cookie: `sotto_session=${token}` } : {}), origin: requestOrigin },
      })
    );
  }
  function post(body: unknown, token: string | null = owner.ownerToken, requestOrigin = origin) {
    return POST(
      new NextRequest(`${origin}/api/v1/placement`, {
        method: 'POST',
        headers: {
          ...(token ? { cookie: `sotto_session=${token}` } : {}),
          origin: requestOrigin,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    );
  }
  it('requires authentication, current private ownership and explicit mutation origin', async () => {
    expect((await get('native=en&target=de&requestId=' + randomUUID(), null)).status).toBe(401);
    expect(
      (
        await get(
          'native=en&target=de&requestId=' + randomUUID(),
          owner.ownerToken,
          'https://untrusted.invalid'
        )
      ).status
    ).toBe(403);
    const first = await get('native=en&target=de&requestId=' + randomUUID());
    expect(first.status).toBe(202);
    const body = await first.json();
    const other = await owner.household('Other');
    expect((await get(`placementSessionId=${body.placementSessionId}`, other.token)).status).toBe(
      404
    );
  });
  it('durably admits once and polls the same exact session without calling a provider', async () => {
    const query = 'native=en&target=de&requestId=' + randomUUID();
    const first = await get(query),
      body = await first.json();
    expect(first.status).toBe(202);
    expect(body.status).toBe('QUEUED');
    expect(body.questions).toEqual([]);
    const replay = await get(query);
    expect(await replay.json()).toEqual(body);
    const poll = await get(`placementSessionId=${body.placementSessionId}`);
    expect(await poll.json()).toEqual(body);
    expect(await instance.database.placementSession.count()).toBe(1);
    expect(await instance.database.course.count()).toBe(0);
  });
  it('rejects missing request or frozen question identity rather than selecting the current language-pair cache', async () => {
    expect((await get('native=en&target=de')).status).toBe(400);
    expect(
      (await post({ native: 'en', target: 'de', answers: [{ id: 'pq_0', selectedIndex: 0 }] }))
        .status
    ).toBe(400);
    const id = randomUUID();
    await get(`native=en&target=de&requestId=${id}`);
    expect((await get(`native=en&target=es&requestId=${id}`)).status).toBe(409);
    expect(await instance.database.course.count()).toBe(0);
  });
  it('admits browser quiz generation by protected POST and polls its retained status without Origin', async () => {
    const browserHeaders = {
      cookie: `sotto_session=${owner.ownerToken}`,
      'sec-fetch-site': 'same-origin',
    };
    const blocked = await GET(
      new NextRequest(`${origin}/api/v1/placement?native=en&target=de&requestId=${randomUUID()}`, {
        headers: browserHeaders,
      })
    );
    expect(blocked.status).toBe(403);
    const response = await generate(
      new NextRequest(`${origin}/api/v1/placement/generate`, {
        method: 'POST',
        headers: { ...browserHeaders, origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          requestId: randomUUID(),
          native: 'en',
          target: 'de',
        }),
      })
    );
    expect(response.status).toBe(202);
    const session = await response.json();
    const poll = await GET(
      new NextRequest(
        `${origin}/api/v1/placement?placementSessionId=${session.placementSessionId}`,
        { headers: browserHeaders }
      )
    );
    expect(poll.status).toBe(202);
    expect((await poll.json()).placementSessionId).toBe(session.placementSessionId);
    expect(await instance.database.placementSession.count()).toBe(1);
  });
  it('rejects an unready quiz and malformed UTF8 without granting placement', async () => {
    const body = await (await get('native=en&target=de&requestId=' + randomUUID())).json();
    const result = await post({
      schemaVersion: 1,
      requestId: randomUUID(),
      native: 'en',
      target: 'de',
      placementSessionId: body.placementSessionId,
      questionsDigest: body.questionsDigest,
      answers: Array.from({ length: 6 }, (_, index) => ({ id: `pq_${index}`, selectedIndex: 0 })),
    });
    expect(result.status).toBe(409);
    expect(await instance.database.course.count()).toBe(0);
    const invalid = new NextRequest(`${origin}/api/v1/placement`, {
      method: 'POST',
      headers: {
        cookie: `sotto_session=${owner.ownerToken}`,
        origin,
        'content-type': 'application/json',
      },
      body: Uint8Array.from([255]),
    });
    expect((await POST(invalid)).status).toBe(400);
  });
  it('preserves the admission rate limit while allowing exact receipt replay and polling after it is exhausted', async () => {
    const query = 'native=en&target=de&requestId=' + randomUUID();
    const first = await get(query),
      body = await first.json();
    expect(first.status).toBe(202);
    for (let index = 1; index < 10; index++)
      expect((await get('native=en&target=de&requestId=' + randomUUID())).status).toBe(409);
    expect((await get('native=en&target=de&requestId=' + randomUUID())).status).toBe(429);
    expect(await (await get(query)).json()).toEqual(body);
    expect((await get(`placementSessionId=${body.placementSessionId}`)).status).toBe(202);
    expect(await instance.database.placementSession.count()).toBe(1);
  });
});
