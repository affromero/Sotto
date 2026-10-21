// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { newToken } from 'thesidedoor-core/access';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { approvePlayEntry } from '@/lib/play/admission/approvals';
import { claimPlayEntry } from '@/lib/play/admission/claims';
import { rotatePlayInvitation } from '@/lib/play/admission/invitations';
import { updatePlayPresence } from '@/lib/play/admission/presence';
import { requestPlayEntry } from '@/lib/play/admission/requests';
import {
  blockPlayPartner,
  listPlayBlocks,
  unblockPlayPartner,
} from '@/lib/play/safety/preferences';
import { reportPlayContent } from '@/lib/play/safety/reports';
import { reviewPlayReport } from '@/lib/play/safety/review';
import {
  createStoredPlayRoom,
  actOnStoredPlayRoom,
  readStoredPlayRoom,
} from '@/lib/play/storage/rooms';
import { acceptedPlayTestIdentity, playTestActor } from '../../../helpers/play-fixture';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const settings = { nativeLang: 'en', targetLang: 'de', level: 'A1' } as const;
suite('serializable safety changes against sharing and receipt recovery', () => {
  let instance: SharedTestInstance, authority: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('play_safety_races');
  });
  beforeEach(async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'isolated-play-safety-race-key');
    authority = await acceptedPlayTestIdentity(instance, await instance.reset());
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => instance?.close());
  const input = () => ({ actionId: randomUUID(), kind: 'MIXED', theme: 'EVERYDAY', settings });
  async function pair() {
    const host = await playTestActor(instance, authority.ownerToken);
    const member = await authority.household('Partner');
    const guest = await playTestActor(instance, member.token);
    const room = await createStoredPlayRoom(host, input());
    await instance.database.playRoom.update({
      where: { id: room.id },
      data: { guestUserId: member.id, guestSettings: settings },
    });
    return { host, guest, room };
  }
  async function reported() {
    const fixture = await pair();
    const reportId = randomUUID();
    await reportPlayContent(fixture.host, fixture.room.id, {
      actionId: reportId,
      category: 'OTHER',
      detail: 'Please review.',
      selector: { kind: 'PARTNER_NAME' },
      expectedVisibleText: 'Partner',
    });
    return { ...fixture, reportId };
  }

  it('serializes BLOCK against START and refuses the committed action receipt after blocking', async () => {
    const { host, guest, room } = await pair();
    const start = { actionId: randomUUID(), expectedRevision: 0, type: 'START' };
    const outcomes = await Promise.allSettled([
      actOnStoredPlayRoom(host, room.id, start),
      blockPlayPartner(guest, room.id, { actionId: randomUUID() }),
    ]);
    expect(outcomes[1].status).toBe('fulfilled');
    expect(await instance.database.playRoom.findUnique({ where: { id: room.id } })).toMatchObject({
      status: 'CANCELLED',
      invitationHash: null,
    });
    await expect(actOnStoredPlayRoom(host, room.id, start)).rejects.toMatchObject({
      reason: 'PLAY_UNAVAILABLE',
    });
    expect(await instance.database.playPresenceLease.count({ where: { roomId: room.id } })).toBe(0);
  });

  it('retries a real frozen room-read snapshot after waiting on a committed safety fence', async () => {
    const { host, guest, room } = await pair();
    const continueBlock = Promise.withResolvers<void>();
    const held = Promise.withResolvers<number>();
    let paused = false,
      serialized = false;
    type Operation = (database: Prisma.TransactionClient) => Promise<unknown>;
    type Options = { isolationLevel?: Prisma.TransactionIsolationLevel };
    const blockerDatabase = new Proxy(instance.database, {
      get(target, key, receiver) {
        if (key !== '$transaction') return Reflect.get(target, key, receiver);
        return (operation: Operation, options: Options) =>
          target.$transaction(
            (database) =>
              operation(
                new Proxy(database, {
                  get(tx, property, txReceiver) {
                    if (property !== '$queryRaw') return Reflect.get(tx, property, txReceiver);
                    return async (...args: unknown[]) => {
                      const result: unknown = await Reflect.apply(tx.$queryRaw, tx, args);
                      const query = args[0];
                      if (
                        !paused &&
                        query &&
                        typeof query === 'object' &&
                        'sql' in query &&
                        typeof query.sql === 'string' &&
                        query.sql.includes('PlaySafetyState')
                      ) {
                        paused = true;
                        const [connection] = await tx.$queryRaw<
                          Array<{ pid: number }>
                        >`SELECT pg_backend_pid() AS pid`;
                        held.resolve(connection.pid);
                        await continueBlock.promise;
                      }
                      return result;
                    };
                  },
                })
              ),
            options
          );
      },
    });
    const readerDatabase = new Proxy(instance.database, {
      get(target, key, receiver) {
        if (key !== '$transaction') return Reflect.get(target, key, receiver);
        return async (operation: Operation, options: Options) => {
          try {
            return await target.$transaction(operation, options);
          } catch (error) {
            serialized ||= isSerializationConflict(error);
            throw error;
          }
        };
      },
    });
    const blocker = blockPlayPartner({ ...host, database: blockerDatabase }, room.id, {
      actionId: randomUUID(),
    });
    let reader: Promise<unknown> | undefined;
    try {
      const pid = await held.promise;
      // Capture the outcome immediately so an expected rejection is always handled.
      reader = readStoredPlayRoom({ ...guest, database: readerDatabase }, room.id).then(
        (view) => ({ kind: 'view', view }),
        (error: unknown) => ({ kind: 'error', error })
      );
      await expect
        .poll(
          async () => {
            const [state] = await instance.database.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity
            WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock'
              AND query LIKE '%PlaySafetyState%') AS waiting`;
            return state.waiting;
          },
          { timeout: 5000 }
        )
        .toBe(true);
      continueBlock.resolve();
      await blocker;
      expect(await reader).toMatchObject({ kind: 'error', error: { reason: 'PLAY_UNAVAILABLE' } });
      expect(serialized).toBe(true);
    } finally {
      continueBlock.resolve();
      await Promise.allSettled([blocker, ...(reader ? [reader] : [])]);
    }
  });

  it('keeps exact BLOCK and UNBLOCK retries from changing the final concurrent decision', async () => {
    const { host, guest, room } = await pair();
    await blockPlayPartner(host, room.id, { actionId: randomUUID() });
    const block = { actionId: randomUUID() },
      unblock = { actionId: randomUUID() };
    const outcomes = await Promise.all([
      blockPlayPartner(host, room.id, block),
      unblockPlayPartner(host, guest.identity.userId, unblock),
    ]);
    const final = await listPlayBlocks(host);
    expect(await blockPlayPartner(host, room.id, block)).toEqual(outcomes[0]);
    expect(await unblockPlayPartner(host, guest.identity.userId, unblock)).toEqual(outcomes[1]);
    expect(await listPlayBlocks(host)).toEqual(final);
  });

  it('commits one report revision when owner responses race', async () => {
    const { host, reportId } = await reported();
    const response = (text: string) => ({
      actionId: randomUUID(),
      expectedRevision: 0,
      action: 'RESPOND',
      response: text,
    });
    const first = response('I reviewed the report.'),
      second = response('Thank you for reporting this.');
    const outcomes = await Promise.allSettled([
      reviewPlayReport(host, reportId, first),
      reviewPlayReport(host, reportId, second),
    ]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ reason: 'SAFETY_CONFLICT' }) }),
    ]);
    const saved = await instance.database.playSafetyReport.findUniqueOrThrow({
      where: { id: reportId },
    });
    expect(saved).toMatchObject({
      revision: 1,
      status: 'RESOLVED',
      reviewAction: 'RESPOND',
      responderUserId: authority.ownerId,
    });
    expect([first.response, second.response]).toContain(saved.response);
  });

  it('leaves no active room when creation races with an owner sharing restriction', async () => {
    const { host, guest, reportId } = await reported();
    const command = input();
    const outcomes = await Promise.allSettled([
      createStoredPlayRoom(guest, command),
      reviewPlayReport(host, reportId, {
        actionId: randomUUID(),
        expectedRevision: 0,
        action: 'RESTRICT_PLAY',
        response: 'Partner games are paused.',
      }),
    ]);
    expect(outcomes[1].status).toBe('fulfilled');
    expect(
      await instance.database.playRoom.count({
        where: {
          OR: [{ hostUserId: guest.identity.userId }, { guestUserId: guest.identity.userId }],
          status: { in: ['WAITING', 'PLAYING'] },
        },
      })
    ).toBe(0);
    await expect(createStoredPlayRoom(guest, command)).rejects.toMatchObject({
      reason: 'PLAY_UNAVAILABLE',
    });
  });

  it('revokes pending or committed delivery when BLOCK races with canonical first claim', async () => {
    const host = await playTestActor(instance, authority.ownerToken);
    const room = await createStoredPlayRoom(host, input());
    const viewNonce = newToken();
    const beat = () => updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce });
    await beat();
    const invitation = await rotatePlayInvitation(host, room.id, {
      actionId: randomUUID(),
      expectedRevision: 0,
    });
    const requestId = randomUUID(),
      proof = newToken();
    await requestPlayEntry(
      instance.database,
      {
        requestId,
        code: invitation.code,
        client: 'NATIVE',
        deviceName: 'Phone',
        acceptedConductVersion: 1,
        candidate: { kind: 'NEW', name: 'Partner', settings, consentToProfile: true },
      },
      proof,
      null
    );
    await approvePlayEntry(host, requestId, {
      actionId: randomUUID(),
      expectedRevision: 1,
      type: 'APPROVE_PROFILE',
    });
    const candidate = await instance.database.playJoinRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    const prior = await createStoredPlayRoom(host, input());
    await instance.database.playRoom.update({
      where: { id: prior.id },
      data: { guestUserId: candidate.provisionedUserId, guestSettings: settings },
    });
    await beat();
    const outcomes = await Promise.allSettled([
      claimPlayEntry(instance.database, requestId, proof, null),
      blockPlayPartner(host, prior.id, { actionId: randomUUID() }),
    ]);
    expect(outcomes[1].status).toBe('fulfilled');
    await expect(claimPlayEntry(instance.database, requestId, proof, null)).rejects.toMatchObject({
      reason: 'PLAY_UNAVAILABLE',
    });
    expect(
      await instance.database.playJoinRequest.findUnique({ where: { id: requestId } })
    ).toMatchObject({ status: 'REVOKED', deliveryState: null });
    expect(
      await instance.database.playRoom.count({
        where: {
          hostUserId: authority.ownerId,
          guestUserId: candidate.provisionedUserId,
          status: { in: ['WAITING', 'PLAYING'] },
        },
      })
    ).toBe(0);
  });
});
