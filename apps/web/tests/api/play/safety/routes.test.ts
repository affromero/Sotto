// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { newToken } from 'thesidedoor-core/access';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { GET as policy } from '@/app/api/v1/play/policy/route';
import { GET as safety } from '@/app/api/v1/play/safety/route';
import { POST as conduct } from '@/app/api/v1/play/safety/conduct/route';
import { GET as blocks } from '@/app/api/v1/play/safety/blocks/route';
import { POST as block } from '@/app/api/v1/play/rooms/[roomId]/block/route';
import { POST as unblock } from '@/app/api/v1/play/safety/blocks/[blockedUserId]/unblock/route';
import { POST as report } from '@/app/api/v1/play/rooms/[roomId]/reports/route';
import { GET as ownReports } from '@/app/api/v1/play/safety/reports/route';
import { GET as reviewList } from '@/app/api/v1/play/safety/review/route';
import { POST as review } from '@/app/api/v1/play/safety/review/[reportId]/route';
import { POST as pendingConduct } from '@/app/api/v1/play/join-requests/[requestId]/conduct/route';
import { GET as room } from '@/app/api/v1/play/rooms/[roomId]/route';
import { POST as create } from '@/app/api/v1/play/rooms/route';
import { createStoredPlayRoom } from '@/lib/play/storage/rooms';
import { rotatePlayInvitation } from '@/lib/play/admission/invitations';
import { requestPlayEntry } from '@/lib/play/admission/requests';
import { issueSottoPairing, redeemSottoPairing } from '@/lib/sidedoor/access/core/pairing';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { isPublicPlayRequest } from '@/lib/play/perimeter';
import { closeRedis, getRedisClient } from '@/lib/redis';
import { acceptedPlayTestIdentity, playTestActor } from '../../../helpers/play-fixture';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const origin = 'http://localhost:3000';
const settings = { nativeLang: 'en', targetLang: 'de', level: 'A1' } as const;
const ctx = (roomId: string) => ({ params: Promise.resolve({ roomId }) });
suite('safety HTTP boundaries with canonical PostgreSQL and Redis', () => {
  let instance: SharedTestInstance, identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('play_safety_api');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'isolated-play-safety-api-key');
    vi.stubEnv('SOTTO_PRIVACY_CONTACT_EMAIL', 'operator@example.test');
    identity = await instance.reset();
    const redis = getRedisClient();
    const keys = await redis.keys('ratelimit:play:*');
    if (keys.length) await redis.del(...keys);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    boundary.database = null;
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
  const browser = (token = identity.ownerToken) => ({ origin, cookie: `sotto_session=${token}` });
  async function pair() {
    identity = await acceptedPlayTestIdentity(instance, identity);
    const owner = await playTestActor(instance, identity.ownerToken);
    const member = await identity.household('Partner');
    const game = await createStoredPlayRoom(owner, {
      actionId: randomUUID(),
      kind: 'MIXED',
      theme: 'EVERYDAY',
      settings,
    });
    await instance.database.playRoom.update({
      where: { id: game.id },
      data: { guestUserId: member.id, guestSettings: settings },
    });
    return { owner, member, game };
  }
  const reportBody = () => ({
    actionId: randomUUID(),
    category: 'HARASSMENT',
    detail: 'Please review.',
    selector: { kind: 'PARTNER_NAME' },
    expectedVisibleText: 'Partner',
  });

  it('publishes only bounded operator policy and keeps private safety authenticated and uncached', async () => {
    const published = await policy(request('GET', '/policy'));
    expect(published.status).toBe(200);
    expect(published.headers.get('cache-control')).toBe('private, no-store');
    expect(await published.json()).toMatchObject({
      version: 1,
      operatorContactUrl: expect.stringContaining('operator%40example.test'),
    });
    expect((await policy(request('GET', '/policy?unexpected=secret'))).status).toBe(400);
    expect((await safety(request('GET', '/safety'))).status).toBe(401);
    const own = await safety(request('GET', '/safety', undefined, browser()));
    expect(own.status).toBe(200);
    expect(own.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await own.json()).toMatchObject({ profileId: identity.ownerId, acceptedVersion: null });
  });

  it('applies canonical origin, exclusive bearer, strict shape and bounded body processing to consent', async () => {
    const command = { actionId: randomUUID(), version: 1 };
    expect(
      (await conduct(request('POST', '/safety/conduct', command, { cookie: browser().cookie })))
        .status
    ).toBe(403);
    expect(
      (
        await conduct(
          request('POST', '/safety/conduct', command, {
            ...browser(),
            origin: 'https://other.example.test',
          })
        )
      ).status
    ).toBe(403);
    expect(
      (
        await conduct(
          request('POST', '/safety/conduct', command, {
            ...browser(),
            authorization: 'Bearer invalid',
          })
        )
      ).status
    ).toBe(401);
    expect(
      (
        await conduct(
          request('POST', '/safety/conduct', { ...command, profileId: identity.ownerId }, browser())
        )
      ).status
    ).toBe(400);
    const oversized = await conduct(
      request(
        'POST',
        '/safety/conduct',
        { ...command, extra: 'private-safety-draft'.repeat(10_000) },
        browser()
      )
    );
    expect(oversized.status).toBe(400);
    expect(await oversized.text()).not.toContain('private-safety-draft');
    const accepted = await conduct(request('POST', '/safety/conduct', command, browser()));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ actionId: command.actionId, completed: true });
    expect(accepted.headers.get('set-cookie')).toBeNull();
  });

  it('returns typed non-auth conduct failures so valid profiles keep their safety controls', async () => {
    const command = { actionId: randomUUID(), kind: 'MIXED', theme: 'EVERYDAY', settings };
    const refused = await create(request('POST', '/rooms', command, browser()));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ reason: 'CONDUCT_REQUIRED' });
    expect((await safety(request('GET', '/safety', undefined, browser()))).status).toBe(200);
    await conduct(
      request('POST', '/safety/conduct', { actionId: randomUUID(), version: 1 }, browser())
    );
    expect((await create(request('POST', '/rooms', command, browser()))).status).toBe(201);
  });

  it('keeps app-only owner devices out of owner moderation without disabling their own safety access', async () => {
    const pairing = await sottoTransaction(instance.database, (database) =>
      issueSottoPairing(database, identity.ownerToken, 'App only', { scopes: ['app'] })
    );
    const device = await sottoTransaction(instance.database, (database) =>
      redeemSottoPairing(database, pairing.token)
    );
    const headers = { authorization: `Bearer ${device.token}` };
    const own = await safety(request('GET', '/safety', undefined, headers));
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ canReviewReports: false });
    expect((await reviewList(request('GET', '/safety/review', undefined, headers))).status).toBe(
      403
    );
    expect((await safety(request('GET', '/safety', undefined, headers))).status).toBe(200);
  });

  it('derives bounded reports from actual membership and gives only actual owners the review workflow', async () => {
    const { member, game } = await pair();
    const command = reportBody();
    const reported = await report(
      request('POST', `/rooms/${game.id}/reports`, command, browser()),
      ctx(game.id)
    );
    expect(reported.status).toBe(201);
    expect(await reported.json()).toEqual({ actionId: command.actionId, completed: true });
    expect(
      (
        await report(
          request(
            'POST',
            `/rooms/${game.id}/reports`,
            { ...command, subjectUserId: member.id },
            browser()
          ),
          ctx(game.id)
        )
      ).status
    ).toBe(400);
    const mine = await ownReports(request('GET', '/safety/reports', undefined, browser()));
    const own = await mine.json();
    expect(own.reports[0]).toMatchObject({ id: command.actionId, evidence: { text: 'Partner' } });
    expect(JSON.stringify(own)).not.toContain(member.id);
    expect(
      await (
        await ownReports(request('GET', '/safety/reports', undefined, browser(member.token)))
      ).json()
    ).toEqual({ reports: [], nextCursor: null });
    expect(
      (
        await ownReports(
          request(
            'GET',
            `/safety/reports?beforeId=${command.actionId}`,
            undefined,
            browser(member.token)
          )
        )
      ).status
    ).toBe(404);
    expect(
      (await reviewList(request('GET', '/safety/review', undefined, browser(member.token)))).status
    ).toBe(403);
    const ownerView = await (
      await reviewList(request('GET', '/safety/review?status=OPEN', undefined, browser()))
    ).json();
    expect(ownerView.reports[0]).toMatchObject({
      subject: { id: member.id },
      reporter: { id: identity.ownerId },
    });
    const result = await review(
      request(
        'POST',
        `/safety/review/${command.actionId}`,
        {
          actionId: randomUUID(),
          expectedRevision: 0,
          action: 'RESPOND',
          response: 'Thank you. I reviewed this.',
        },
        browser()
      ),
      { params: Promise.resolve({ reportId: command.actionId }) }
    );
    expect(result.status).toBe(200);
    expect(
      (await (await ownReports(request('GET', '/safety/reports', undefined, browser()))).json())
        .reports[0].response
    ).toBe('Thank you. I reviewed this.');
  });

  it('keeps report rate boundaries private and leaves later safety reads available', async () => {
    const { game } = await pair();
    for (let index = 0; index < 5; index++)
      expect(
        (
          await report(
            request('POST', `/rooms/${game.id}/reports`, reportBody(), browser()),
            ctx(game.id)
          )
        ).status
      ).toBe(201);
    const refused = await report(
      request('POST', `/rooms/${game.id}/reports`, reportBody(), browser()),
      ctx(game.id)
    );
    expect(refused.status).toBe(429);
    expect(refused.headers.get('cache-control')).toBe('private, no-store');
    expect(await instance.database.playSafetyReport.count()).toBe(5);
    expect((await safety(request('GET', '/safety', undefined, browser()))).status).toBe(200);
  });

  it('blocks room access with404 and replays exact safety acknowledgments after unblock and room deletion', async () => {
    const { member, game } = await pair();
    const command = { actionId: randomUUID() };
    const ack = await block(
      request('POST', `/rooms/${game.id}/block`, command, browser()),
      ctx(game.id)
    );
    expect(ack.status).toBe(200);
    const unavailable = await room(
      request('GET', `/rooms/${game.id}`, undefined, browser(member.token)),
      ctx(game.id)
    );
    expect(unavailable.status).toBe(404);
    expect(await unavailable.json()).toMatchObject({ reason: 'PLAY_UNAVAILABLE' });
    expect((await safety(request('GET', '/safety', undefined, browser(member.token)))).status).toBe(
      200
    );
    expect(
      (await (await blocks(request('GET', '/safety/blocks', undefined, browser()))).json())
        .blocks[0].blockedUserId
    ).toBe(member.id);
    expect(
      (
        await unblock(
          request(
            'POST',
            `/safety/blocks/${member.id}/unblock`,
            { actionId: randomUUID() },
            browser()
          ),
          { params: Promise.resolve({ blockedUserId: member.id }) }
        )
      ).status
    ).toBe(200);
    await instance.database.playRoom.delete({ where: { id: game.id } });
    expect(
      (await block(request('POST', `/rooms/${game.id}/block`, command, browser()), ctx(game.id)))
        .status
    ).toBe(200);
    expect(
      (await (await blocks(request('GET', '/safety/blocks', undefined, browser()))).json()).blocks
    ).toEqual([]);
  });

  it('requires proof, browser origin and explicit nullable observation for legacy pending acceptance', async () => {
    identity = await acceptedPlayTestIdentity(instance, identity);
    const owner = await playTestActor(instance, identity.ownerToken);
    const game = await createStoredPlayRoom(owner, {
      actionId: randomUUID(),
      kind: 'MIXED',
      theme: 'EVERYDAY',
      settings,
    });
    const invitation = await rotatePlayInvitation(owner, game.id, {
      actionId: randomUUID(),
      expectedRevision: 0,
    });
    const requestId = randomUUID(),
      proof = newToken();
    const context = { request: request('POST', '/invitations'), expectedProfileId: null };
    await requestPlayEntry(
      instance.database,
      {
        requestId,
        code: invitation.code,
        client: 'BROWSER',
        deviceName: 'Browser',
        acceptedConductVersion: 1,
        candidate: { kind: 'NEW', name: 'Partner', settings, consentToProfile: true },
      },
      proof,
      null,
      undefined,
      context
    );
    await instance.database.playJoinRequest.update({
      where: { id: requestId },
      data: { acceptedConductVersion: null, acceptedConductAt: null },
    });
    const endpoint = `/join-requests/${requestId}/conduct`;
    const route = { params: Promise.resolve({ requestId }) };
    expect(
      (
        await pendingConduct(
          request('POST', endpoint, { version: 1, expectedProfileId: null }, { origin }),
          route
        )
      ).status
    ).toBe(401);
    expect(
      (
        await pendingConduct(
          request(
            'POST',
            endpoint,
            { version: 1, expectedProfileId: null },
            { 'X-Sotto-Play-Proof': proof }
          ),
          route
        )
      ).status
    ).toBe(403);
    expect(
      (
        await pendingConduct(
          request('POST', endpoint, { version: 1 }, { origin, 'X-Sotto-Play-Proof': proof }),
          route
        )
      ).status
    ).toBe(400);
    const accepted = await pendingConduct(
      request(
        'POST',
        endpoint,
        { version: 1, expectedProfileId: null },
        { origin, 'X-Sotto-Play-Proof': proof }
      ),
      route
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ requestId, version: 1 });
    expect(accepted.headers.get('set-cookie')).toBeNull();
    expect(await instance.database.user.count()).toBe(1);
  });

  it('limits public perimeter exceptions to exact read policy and proof POST paths', () => {
    expect(isPublicPlayRequest('/api/v1/play/policy', 'GET')).toBe(true);
    expect(isPublicPlayRequest('/api/v1/play/policy', 'POST')).toBe(false);
    expect(isPublicPlayRequest('/api/v1/play/join-requests/request/conduct', 'POST')).toBe(true);
    for (const path of [
      '/api/v1/play/safety',
      '/api/v1/play/safety/review',
      '/api/v1/play/rooms/room/block',
      '/api/v1/play/join-requests/request/conduct/extra',
    ])
      expect(isPublicPlayRequest(path, 'POST')).toBe(false);
  });

  it('keeps valid credentials usable when new report or block targets a missing or private room', async () => {
    const { game } = await pair();
    const stranger = await identity.household('Unrelated learner');
    for (const roomId of [game.id, randomUUID()]) {
      const blocked = await block(
        request(
          'POST',
          `/rooms/${roomId}/block`,
          { actionId: randomUUID() },
          browser(stranger.token)
        ),
        ctx(roomId)
      );
      expect(blocked.status).toBe(404);
      expect(await blocked.json()).toMatchObject({
        reason: 'PLAY_UNAVAILABLE',
      });
      const reported = await report(
        request('POST', `/rooms/${roomId}/reports`, reportBody(), browser(stranger.token)),
        ctx(roomId)
      );
      expect(reported.status).toBe(404);
      expect(await reported.json()).toMatchObject({
        reason: 'PLAY_UNAVAILABLE',
      });
    }
    expect(
      (await safety(request('GET', '/safety', undefined, browser(stranger.token)))).status
    ).toBe(200);
    expect(await instance.database.playSafetyReport.count()).toBe(0);
    expect(await instance.database.playUserBlock.count()).toBe(0);
    const invalid = { ...browser(stranger.token), authorization: 'Bearer invalid' };
    expect(
      (
        await block(
          request('POST', `/rooms/${game.id}/block`, { actionId: randomUUID() }, invalid),
          ctx(game.id)
        )
      ).status
    ).toBe(401);
    expect(
      (
        await report(
          request('POST', `/rooms/${game.id}/reports`, reportBody(), invalid),
          ctx(game.id)
        )
      ).status
    ).toBe(401);
    expect(
      (await reviewList(request('GET', '/safety/review', undefined, browser(stranger.token))))
        .status
    ).toBe(403);
  });
});
