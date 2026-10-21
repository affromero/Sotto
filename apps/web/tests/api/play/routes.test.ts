// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { acceptedPlayTestIdentity } from '../../helpers/play-fixture';
import { newToken } from 'thesidedoor-core/access';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { GET as rooms, POST as createRoom } from '@/app/api/v1/play/rooms/route';
import { GET as readRoom } from '@/app/api/v1/play/rooms/[roomId]/route';
import { POST as presence } from '@/app/api/v1/play/rooms/[roomId]/presence/route';
import { POST as rotate } from '@/app/api/v1/play/rooms/[roomId]/invitations/route';
import { GET as pending } from '@/app/api/v1/play/rooms/[roomId]/join-requests/route';
import { GET as enrollments } from '@/app/api/v1/play/enrollments/route';
import { GET as preview, POST as intake } from '@/app/api/v1/play/invitations/route';
import { GET as status } from '@/app/api/v1/play/join-requests/[requestId]/route';
import { POST as approve } from '@/app/api/v1/play/join-requests/[requestId]/approve/route';
import { POST as claim } from '@/app/api/v1/play/join-requests/[requestId]/claim/route';
import { POST as ack } from '@/app/api/v1/play/join-requests/[requestId]/ack/route';
import { POST as action } from '@/app/api/v1/play/rooms/[roomId]/actions/route';
import { GET as phrases } from '@/app/api/v1/play/phrases/route';
import { getRedisClient, checkRateLimit, closeRedis } from '@/lib/redis';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';

const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const settings = { nativeLang: 'es', targetLang: 'de', level: 'A1' } as const;
const origin = 'http://localhost:3000';
const roomContext = (roomId: string) => ({ params: Promise.resolve({ roomId }) });
const requestContext = (requestId: string) => ({ params: Promise.resolve({ requestId }) });

suite('partner play API with canonical admission and real PostgreSQL/Redis', () => {
  let instance: SharedTestInstance, identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('play_routes');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'isolated-play-routes-test-key');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    identity = await acceptedPlayTestIdentity(instance, await instance.reset());
    const redis = getRedisClient();
    const keys = await redis.keys('ratelimit:play:*');
    if (keys.length) await redis.del(...keys);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    binding.database = null;
    await instance?.close();
    await closeRedis();
  });

  function request(method: string, path: string, body?: unknown, headers: HeadersInit = {}) {
    return new NextRequest(`${origin}/api/v1/play${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  function browser(token = identity.ownerToken) {
    return { origin, cookie: `sotto_session=${token}` };
  }
  function claimant(proof: string, web = false) {
    return { 'X-Sotto-Play-Proof': proof, ...(web ? { origin } : {}) };
  }

  async function waiting() {
    const created = await createRoom(
      request(
        'POST',
        '/rooms',
        {
          actionId: randomUUID(),
          kind: 'MIXED',
          theme: 'FOOD',
          settings,
        },
        browser()
      )
    );
    expect(created.status).toBe(201);
    const room = await created.json();
    const context = roomContext(room.id),
      viewNonce = newToken();
    const beat = () =>
      presence(
        request('POST', `/rooms/${room.id}/presence`, { type: 'RENEW', viewNonce }, browser()),
        context
      );
    expect((await beat()).status).toBe(200);
    const invitation = await rotate(
      request(
        'POST',
        `/rooms/${room.id}/invitations`,
        {
          actionId: randomUUID(),
          expectedRevision: 0,
        },
        browser()
      ),
      context
    );
    expect(invitation.status).toBe(200);
    return { room, context, beat, code: (await invitation.json()).code as string };
  }

  async function admitted(client: 'BROWSER' | 'NATIVE') {
    const fixture = await waiting(),
      proof = newToken(),
      requestId = randomUUID();
    const joined = await intake(
      request(
        'POST',
        '/invitations',
        {
          requestId,
          code: fixture.code,
          client,
          deviceName: 'Partner phone',
          acceptedConductVersion: 1,
          candidate: { kind: 'NEW', name: 'Partner', settings, consentToProfile: true },
        },
        claimant(proof, client === 'BROWSER')
      )
    );
    expect(joined.status).toBe(201);
    expect(await joined.json()).toMatchObject({ requestId, status: 'WAITING_FOR_OWNER' });
    const approval = await approve(
      request(
        'POST',
        `/join-requests/${requestId}/approve`,
        {
          actionId: randomUUID(),
          expectedRevision: 1,
          type: 'APPROVE_PROFILE',
        },
        browser()
      ),
      requestContext(requestId)
    );
    expect(approval.status).toBe(200);
    expect((await fixture.beat()).status).toBe(200);
    return { ...fixture, proof, requestId };
  }

  it('protects private APIs and never falls back from an invalid bearer to an owner cookie', async () => {
    expect((await rooms(request('GET', '/rooms'))).status).toBe(401);
    expect(
      (
        await rooms(
          request('GET', '/rooms', undefined, {
            ...browser(),
            authorization: 'Bearer invalid-device',
          })
        )
      ).status
    ).toBe(401);
    expect((await phrases(request('GET', '/phrases'))).status).toBe(401);
    expect(await instance.database.playRoom.count()).toBe(0);
  });

  it('enforces browser origin before creating a room or issuing an invitation', async () => {
    const body = { actionId: randomUUID(), kind: 'MIXED', theme: 'FOOD', settings };
    expect(
      (
        await createRoom(
          request('POST', '/rooms', body, {
            ...browser(),
            origin: 'https://attacker.example',
          })
        )
      ).status
    ).toBe(403);
    expect(
      (
        await createRoom(
          request('POST', '/rooms', body, {
            cookie: `sotto_session=${identity.ownerToken}`,
          })
        )
      ).status
    ).toBe(403);
    expect(await instance.database.playRoom.count()).toBe(0);
  });

  it('treats a client profile assertion as a canonical precondition rather than authority', async () => {
    const command = { actionId: randomUUID(), kind: 'MIXED', theme: 'FOOD', settings };
    const wrong = { ...browser(), 'X-Sotto-Play-Profile': 'another-profile' };
    expect((await rooms(request('GET', '/rooms', undefined, wrong))).status).toBe(403);
    expect((await createRoom(request('POST', '/rooms', command, wrong))).status).toBe(403);
    expect(await instance.database.playRoom.count()).toBe(0);
    const correct = { ...browser(), 'X-Sotto-Play-Profile': identity.ownerId };
    expect((await createRoom(request('POST', '/rooms', command, correct))).status).toBe(201);
    expect((await rooms(request('GET', '/rooms', undefined, correct))).status).toBe(200);
  });

  it('keeps previews minimal and rejects duplicate, unknown and oversized query input', async () => {
    const fixture = await waiting();
    const response = await preview(request('GET', `/invitations?code=${fixture.code}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ hostName: 'Owner', hostWaiting: true });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    for (const suffix of ['&code=ABCDEFGH2345', '&proof=secret', `&padding=${'a'.repeat(4096)}`])
      expect(
        (await preview(request('GET', `/invitations?code=${fixture.code}${suffix}`))).status
      ).toBe(400);
    expect(await instance.database.user.count()).toBe(1);
  });

  it('does not authorize claimant status from a path ID or a server-owner cookie', async () => {
    const fixture = await admitted('NATIVE'),
      context = requestContext(fixture.requestId);
    expect(
      (
        await status(
          request('GET', `/join-requests/${fixture.requestId}`, undefined, browser()),
          context
        )
      ).status
    ).toBe(401);
    expect(
      (
        await status(
          request('GET', `/join-requests/${fixture.requestId}`, undefined, claimant(newToken())),
          context
        )
      ).status
    ).toBe(401);
    const response = await status(
      request('GET', `/join-requests/${fixture.requestId}`, undefined, claimant(fixture.proof)),
      context
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      requestId: fixture.requestId,
      status: 'ACCEPTED',
    });
  });

  it('delivers native credentials only to their proof holder and makes lost-response recovery exact', async () => {
    const fixture = await admitted('NATIVE'),
      context = requestContext(fixture.requestId);
    const redeem = () =>
      claim(
        request('POST', `/join-requests/${fixture.requestId}/claim`, {}, claimant(fixture.proof)),
        context
      );
    const first = await redeem();
    expect(first.status).toBe(200);
    expect(first.headers.get('set-cookie')).toBeNull();
    const delivery = await first.json();
    expect(delivery).toMatchObject({ kind: 'NATIVE', profile: { name: 'Partner' } });
    expect(await (await redeem()).json()).toEqual(delivery);
    const admittedRoom = await readRoom(
      request('GET', `/rooms/${fixture.room.id}`, undefined, {
        authorization: `Bearer ${delivery.token}`,
      }),
      fixture.context
    );
    expect(admittedRoom.status).toBe(200);
    expect(await admittedRoom.json()).toMatchObject({ ownSeat: 'GUEST' });
    expect(await instance.database.apiKey.count()).toBe(1);
    expect(
      (
        await ack(
          request(
            'POST',
            `/join-requests/${fixture.requestId}/ack`,
            { deliveryId: delivery.deliveryId },
            claimant(fixture.proof)
          ),
          context
        )
      ).status
    ).toBe(200);
    expect((await redeem()).status).toBe(401);
    expect(await instance.database.apiKey.count()).toBe(1);
  });

  it('requires browser origin on claim and puts the exact session only in an HttpOnly cookie', async () => {
    const fixture = await admitted('BROWSER'),
      context = requestContext(fixture.requestId);
    const path = `/join-requests/${fixture.requestId}/claim`;
    expect((await claim(request('POST', path, {}, claimant(fixture.proof)), context)).status).toBe(
      403
    );
    expect(
      (
        await claim(
          request(
            'POST',
            path,
            {},
            {
              ...claimant(fixture.proof),
              origin: 'https://attacker.example',
            }
          ),
          context
        )
      ).status
    ).toBe(403);
    expect(await instance.database.apiKey.count()).toBe(0);
    expect(
      (await instance.database.playRoom.findUniqueOrThrow({ where: { id: fixture.room.id } }))
        .guestUserId
    ).toBeNull();
    const response = await claim(
      request('POST', path, { expectedProfileId: null }, claimant(fixture.proof, true)),
      context
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=lax');
    expect(cookie).toContain('Path=/');
    const session = /sotto_session=([^;]+)/.exec(cookie)?.[1];
    expect(session).toBeTruthy();
    const json = await response.text();
    expect(JSON.parse(json)).toMatchObject({ kind: 'BROWSER' });
    expect(json).not.toContain(session);
    expect(json).not.toContain('browserSessionToken');
    const room = await readRoom(
      request('GET', `/rooms/${fixture.room.id}`, undefined, browser(session)),
      fixture.context
    );
    expect(room.status).toBe(200);
    expect(await room.json()).toMatchObject({ ownSeat: 'GUEST' });
  });

  it.each([
    { canonical: 'https://sotto.example', alias: origin, secure: false },
    { canonical: origin, alias: 'https://local.sotto.example', secure: true },
  ])(
    'sets cookie security for the validated browser origin $alias',
    async ({ canonical, alias, secure }) => {
      const fixture = await admitted('BROWSER');
      vi.stubEnv('NEXT_PUBLIC_APP_URL', canonical);
      vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', JSON.stringify([alias]));
      const response = await claim(
        new NextRequest(`${alias}/api/v1/play/join-requests/${fixture.requestId}/claim`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: alias,
            'X-Sotto-Play-Proof': fixture.proof,
          },
          body: JSON.stringify({ expectedProfileId: null }),
        }),
        requestContext(fixture.requestId)
      );
      expect(response.status).toBe(200);
      const cookie = response.headers.get('set-cookie')!;
      expect(cookie.includes('; Secure')).toBe(secure);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=lax');
    }
  );

  it('lists only owned rooms and separates pending host requests from owner enrollments', async () => {
    const fixture = await waiting(),
      member = await identity.household('Stranger');
    const joined = await intake(
      request(
        'POST',
        '/invitations',
        {
          requestId: randomUUID(),
          code: fixture.code,
          client: 'NATIVE',
          deviceName: 'New device',
          acceptedConductVersion: 1,
          candidate: { kind: 'NEW', name: 'Pending partner', settings, consentToProfile: true },
        },
        claimant(newToken())
      )
    );
    expect(joined.status).toBe(201);
    expect(
      await (await rooms(request('GET', '/rooms', undefined, browser(member.token)))).json()
    ).toEqual({ rooms: [], nextCursor: null });
    expect(
      (
        await rooms(
          request('GET', `/rooms?beforeId=${fixture.room.id}`, undefined, browser(member.token))
        )
      ).status
    ).toBe(403);
    expect(
      (
        await pending(
          request(
            'GET',
            `/rooms/${fixture.room.id}/join-requests`,
            undefined,
            browser(member.token)
          ),
          fixture.context
        )
      ).status
    ).toBe(403);
    expect(
      (await enrollments(request('GET', '/enrollments', undefined, browser(member.token)))).status
    ).toBe(403);
    const requests = await (
      await pending(
        request('GET', `/rooms/${fixture.room.id}/join-requests`, undefined, browser()),
        fixture.context
      )
    ).json();
    expect(requests.requests).toEqual([
      expect.objectContaining({ name: 'Pending partner', allowedActions: ['DECLINE'] }),
    ]);
    expect(JSON.stringify(requests)).not.toMatch(/proofHash|deliveryState|fingerprint/);
    expect(
      (await (await enrollments(request('GET', '/enrollments', undefined, browser()))).json())
        .requests
    ).toHaveLength(1);
  });

  it('enforces API rate limits before public intake changes the database', async () => {
    const fixture = await waiting();
    for (let i = 0; i < 30; i++) await checkRateLimit('play:intake:instance', 30, 60);
    const response = await intake(
      request(
        'POST',
        '/invitations',
        {
          requestId: randomUUID(),
          code: fixture.code,
          client: 'NATIVE',
          deviceName: 'Phone',
          acceptedConductVersion: 1,
          candidate: { kind: 'NEW', name: 'Partner', settings, consentToProfile: true },
        },
        claimant(newToken())
      )
    );
    expect(response.status).toBe(429);
    expect(await instance.database.playJoinRequest.count()).toBe(0);
    expect(await instance.database.user.count()).toBe(1);
  });

  it('rejects malformed commands without reflecting secret input or changing room revision', async () => {
    const fixture = await waiting();
    const secret = newToken();
    const response = await action(
      request(
        'POST',
        `/rooms/${fixture.room.id}/actions`,
        {
          actionId: randomUUID(),
          expectedRevision: 1,
          command: { type: 'CHOOSE', optionId: secret },
        },
        browser()
      ),
      fixture.context
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(secret);
    expect(
      (await instance.database.playRoom.findUniqueOrThrow({ where: { id: fixture.room.id } }))
        .revision
    ).toBe(1);
  });
});
