// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createStoredPlayRoom,
  actOnStoredPlayRoom,
  readStoredPlayRoom,
  listStoredPlayRooms,
  type PlayActor,
} from '@/lib/play/storage/rooms';
import {
  acceptPlayConduct,
  blockPlayPartner,
  listPlayBlocks,
  readPlaySafety,
  unblockPlayPartner,
} from '@/lib/play/safety/preferences';
import { listOwnPlayReports, reportPlayContent } from '@/lib/play/safety/reports';
import { listReviewPlayReports, reviewPlayReport } from '@/lib/play/safety/review';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { PlayRoundCommand, PlayRoomView } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { acceptedPlayTestIdentity, playTestActor } from '../../../helpers/play-fixture';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const settings = { nativeLang: 'en', targetLang: 'de', level: 'A1' } as const;
suite('persistent partner safety with canonical PostgreSQL identities', () => {
  let instance: SharedTestInstance, authority: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('play_safety_preferences');
  });
  beforeEach(async () => {
    authority = await instance.reset();
  });
  afterAll(async () => instance?.close());
  const input = () => ({ actionId: randomUUID(), kind: 'KNOW_ME', theme: 'EVERYDAY', settings });
  async function pair(kind = 'KNOW_ME', questionStyle = 'CHOICES') {
    authority = await acceptedPlayTestIdentity(instance, authority);
    const host = await playTestActor(instance, authority.ownerToken);
    const member = await authority.household('Partner');
    const guest = await playTestActor(instance, member.token);
    const created = { ...input(), kind, questionStyle };
    const room = await createStoredPlayRoom(host, created);
    await instance.database.playRoom.update({
      where: { id: room.id },
      data: { guestUserId: member.id, guestSettings: settings },
    });
    return { host, guest, room: await readStoredPlayRoom(host, room.id), created };
  }
  async function step(actor: PlayActor, room: PlayRoomView, command: PlayRoundCommand) {
    return actOnStoredPlayRoom(actor, room.id, {
      actionId: randomUUID(),
      expectedRevision: room.revision,
      command,
    });
  }
  const nameReport = (text = 'Partner') => ({
    actionId: randomUUID(),
    category: 'HARASSMENT',
    detail: 'Please review this name.',
    selector: { kind: 'PARTNER_NAME' },
    expectedVisibleText: text,
  });

  it('requires explicit current conduct before sharing while keeping safety usable', async () => {
    const owner = await playTestActor(instance, authority.ownerToken);
    expect(await readPlaySafety(owner)).toMatchObject({
      acceptedVersion: null,
      acceptedAt: null,
      sharingRestricted: false,
      canReviewReports: true,
    });
    await expect(createStoredPlayRoom(owner, input())).rejects.toMatchObject({
      reason: 'CONDUCT_REQUIRED',
    });
    expect(await instance.database.playRoom.count()).toBe(0);
    expect(() => acceptPlayConduct(owner, { actionId: randomUUID(), version: 0 })).toThrow();
    const command = { actionId: randomUUID(), version: 1 };
    const accepted = await acceptPlayConduct(owner, command);
    expect(await acceptPlayConduct(owner, command)).toEqual(accepted);
    expect(await readPlaySafety(owner)).toMatchObject({
      acceptedVersion: 1,
      acceptedAt: expect.any(String),
    });
    expect((await createStoredPlayRoom(owner, input())).status).toBe('WAITING');
  });

  it('blocks both directions, hides histories and receipts, and never resurrects a game on unblock', async () => {
    const { host, guest, room, created } = await pair();
    const block = { actionId: randomUUID() };
    const ack = await blockPlayPartner(host, room.id, block);
    expect(await listPlayBlocks(host)).toMatchObject({
      blocks: [{ blockedUserId: guest.identity.userId, name: 'Partner' }],
    });
    expect(await listPlayBlocks(guest)).toEqual({ blocks: [], nextCursor: null });
    for (const actor of [host, guest]) {
      await expect(readStoredPlayRoom(actor, room.id)).rejects.toMatchObject({
        reason: 'PLAY_UNAVAILABLE',
      });
      expect(await listStoredPlayRooms(actor)).toEqual({ rooms: [], nextCursor: null });
    }
    await expect(createStoredPlayRoom(host, created)).rejects.toMatchObject({
      reason: 'PLAY_UNAVAILABLE',
    });
    expect(
      await sottoTransaction(instance.database, (database) =>
        resolveSottoRequest(database, guest.request)
      )
    ).toMatchObject({ userId: guest.identity.userId });
    const unblock = { actionId: randomUUID() };
    const unblocked = await unblockPlayPartner(host, guest.identity.userId, unblock);
    expect((await readStoredPlayRoom(host, room.id)).status).toBe('CANCELLED');
    await instance.database.playRoom.delete({ where: { id: room.id } });
    expect(await blockPlayPartner(host, room.id, block)).toEqual(ack);
    expect(await unblockPlayPartner(host, guest.identity.userId, unblock)).toEqual(unblocked);
    expect(await listPlayBlocks(host)).toEqual({ blocks: [], nextCursor: null });
    expect(() => blockPlayPartner(host, room.id, { ...block, surprise: true })).toThrow();
    await expect(
      unblockPlayPartner(guest, host.identity.userId, { actionId: randomUUID() })
    ).rejects.toMatchObject({ reason: 'PLAY_UNAVAILABLE' });
  });

  it('retains verified reports after room deletion and exposes only my report and real owner review', async () => {
    const { host, guest, room } = await pair();
    const command = nameReport();
    const ack = await reportPlayContent(host, room.id, command);
    await blockPlayPartner(host, room.id, { actionId: randomUUID() });
    const afterBlock = nameReport();
    await reportPlayContent(host, room.id, afterBlock);
    expect((await listOwnPlayReports(guest)).reports).toEqual([]);
    const own = await listOwnPlayReports(host);
    expect(own.reports).toHaveLength(2);
    expect(own.reports[0]).toMatchObject({
      evidence: { text: 'Partner' },
      status: 'OPEN',
      response: null,
    });
    expect(JSON.stringify(own)).not.toContain('subjectUserId');
    await expect(listReviewPlayReports(guest)).rejects.toMatchObject({ code: 'forbidden' });
    await instance.database.playRoom.delete({ where: { id: room.id } });
    expect(await reportPlayContent(host, room.id, command)).toEqual(ack);
    const inbox = await listReviewPlayReports(host);
    expect(inbox.reports[0]).toMatchObject({
      roomId: null,
      reporter: { id: host.identity.userId },
      subject: { id: guest.identity.userId },
    });
    const review = {
      actionId: randomUUID(),
      expectedRevision: 0,
      action: 'RESPOND',
      response: 'Thank you. I reviewed this report.',
    };
    const reviewed = await reviewPlayReport(host, command.actionId, review);
    expect(await reviewPlayReport(host, command.actionId, review)).toEqual(reviewed);
    expect(
      (await listOwnPlayReports(host)).reports.find((row) => row.id === command.actionId)
    ).toMatchObject({ status: 'RESOLVED', revision: 1, response: review.response });
    await expect(
      reviewPlayReport(host, command.actionId, { ...review, actionId: randomUUID() })
    ).rejects.toMatchObject({ reason: 'SAFETY_CONFLICT' });
    await expect(
      reportPlayContent(host, room.id, { ...command, detail: 'Changed' })
    ).rejects.toMatchObject({ reason: 'SAFETY_CONFLICT' });
  });

  it('restricts only sharing, preserves safety access and canonical credentials, and permits deliberate restoration', async () => {
    const { host, guest, room } = await pair();
    const report = nameReport();
    await reportPlayContent(host, room.id, report);
    const restrict = {
      actionId: randomUUID(),
      expectedRevision: 0,
      action: 'RESTRICT_PLAY',
      response: 'Partner games are paused while I review this concern.',
    };
    await reviewPlayReport(host, report.actionId, restrict);
    expect(await readPlaySafety(guest)).toMatchObject({
      sharingRestricted: true,
      acceptedVersion: 1,
    });
    await expect(createStoredPlayRoom(guest, input())).rejects.toMatchObject({
      reason: 'PLAY_UNAVAILABLE',
    });
    expect((await listOwnPlayReports(guest)).reports).toEqual([]);
    await blockPlayPartner(guest, room.id, { actionId: randomUUID() });
    await unblockPlayPartner(guest, host.identity.userId, { actionId: randomUUID() });
    await reviewPlayReport(host, report.actionId, {
      actionId: randomUUID(),
      expectedRevision: 1,
      action: 'RESTORE_PLAY',
      response: 'Partner games are available again.',
    });
    expect(await readPlaySafety(guest)).toMatchObject({ sharingRestricted: false });
    expect((await readStoredPlayRoom(guest, room.id)).status).toBe('CANCELLED');
    expect((await createStoredPlayRoom(guest, input())).status).toBe('WAITING');
  });

  it('redacts later profile renames and legacy room receipts without changing canonical names', async () => {
    const { host, guest, room, created } = await pair();
    await instance.database.user.update({
      where: { id: guest.identity.userId },
      data: { name: 'f.u.c.k' },
    });
    expect((await readStoredPlayRoom(host, room.id)).guest?.name).toBe('Name hidden');
    const receipt = await instance.database.playActionReceipt.findFirstOrThrow({
      where: { actionId: created.actionId },
    });
    await instance.database.playActionReceipt.update({
      where: { id: receipt.id },
      data: { result: { ...room, host: { ...room.host, name: 'sh1t' } } },
    });
    expect((await createStoredPlayRoom(host, created)).host.name).toBe('Name hidden');
    await expect(reportPlayContent(host, room.id, nameReport('f.u.c.k'))).rejects.toMatchObject({
      reason: 'CONTENT_CHANGED',
    });
    await reportPlayContent(host, room.id, nameReport('Name hidden'));
    expect((await listOwnPlayReports(host)).reports[0].evidence.text).toBe('Name hidden');
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: guest.identity.userId } }))
        .name
    ).toBe('f.u.c.k');
  });

  it('filters every shared describe text command before saving or issuing a receipt', async () => {
    const { host, guest, room } = await pair('DESCRIBE');
    let current = await actOnStoredPlayRoom(host, room.id, {
      actionId: randomUUID(),
      expectedRevision: room.revision,
      type: 'START',
    });
    await expect(
      step(host, current, { type: 'SET_TARGET', text: 'f.u.c.k' })
    ).rejects.toMatchObject({ reason: 'TEXT_FILTERED' });
    current = await step(host, current, { type: 'SET_TARGET', text: 'Ein Haus' });
    await expect(step(host, current, { type: 'GIVE_CLUE', text: 'sh1t' })).rejects.toMatchObject({
      reason: 'TEXT_FILTERED',
    });
    current = await step(host, current, { type: 'GIVE_CLUE', text: 'Ein Ort zum Wohnen' });
    await expect(step(guest, current, { type: 'GUESS', text: 'pórn' })).rejects.toMatchObject({
      reason: 'TEXT_FILTERED',
    });
    current = await step(guest, current, { type: 'GUESS', text: 'Ein Haus' });
    await expect(
      step(guest, current, { type: 'FEEDBACK', understood: true, correction: 'sh1t' })
    ).rejects.toMatchObject({ reason: 'TEXT_FILTERED' });
    expect((await readStoredPlayRoom(host, room.id)).revision).toBe(current.revision);
  });

  it.each(['KNOW_ME', 'MISSION'])(
    'filters %s answers/messages and hints without a provider',
    async (mode) => {
      const { host, room } = await pair(mode, 'OPEN');
      const current = await actOnStoredPlayRoom(host, room.id, {
        actionId: randomUUID(),
        expectedRevision: room.revision,
        type: 'START',
      });
      await expect(
        step(host, current, { type: mode === 'KNOW_ME' ? 'ANSWER' : 'MESSAGE', text: 'f.u.c.k' })
      ).rejects.toMatchObject({ reason: 'TEXT_FILTERED' });
      await expect(step(host, current, { type: 'HINT', text: 'sh1t' })).rejects.toMatchObject({
        reason: 'TEXT_FILTERED',
      });
      expect((await readStoredPlayRoom(host, room.id)).revision).toBe(current.revision);
    }
  );

  it('refuses hidden, future, own or changed evidence and records only the chosen other-authored field', async () => {
    const { host, guest, room } = await pair('DESCRIBE');
    let current = await actOnStoredPlayRoom(host, room.id, {
      actionId: randomUUID(),
      expectedRevision: room.revision,
      type: 'START',
    });
    current = await step(host, current, { type: 'SET_TARGET', text: 'Ein Haus' });
    const report = (field: string, text: string) => ({
      ...nameReport(text),
      selector: { kind: 'ROUND_TEXT', roundId: current.round!.id, field },
    });
    await expect(
      reportPlayContent(guest, room.id, report('TARGET', 'Ein Haus'))
    ).rejects.toMatchObject({ reason: 'CONTENT_CHANGED' });
    current = await step(host, current, { type: 'GIVE_CLUE', text: 'Ein Ort zum Wohnen' });
    await expect(
      reportPlayContent(host, room.id, report('CLUE', 'Ein Ort zum Wohnen'))
    ).rejects.toMatchObject({ reason: 'CONTENT_CHANGED' });
    await expect(
      reportPlayContent(guest, room.id, report('CLUE', 'A changed clue'))
    ).rejects.toMatchObject({ reason: 'CONTENT_CHANGED' });
    await blockPlayPartner(guest, room.id, { actionId: randomUUID() });
    await reportPlayContent(guest, room.id, report('CLUE', 'Ein Ort zum Wohnen'));
    expect((await listOwnPlayReports(guest)).reports[0].evidence).toEqual({
      selector: { kind: 'ROUND_TEXT', roundId: current.round!.id, field: 'CLUE' },
      text: 'Ein Ort zum Wohnen',
    });
    expect(JSON.stringify(await listReviewPlayReports(host))).not.toContain('Ein Haus');
    const future = await instance.database.playRound.findFirstOrThrow({
      where: { roomId: room.id, order: 1 },
    });
    await expect(
      reportPlayContent(guest, room.id, {
        ...report('CLUE', 'Ein Ort zum Wohnen'),
        selector: { kind: 'ROUND_TEXT', roundId: future.id, field: 'CLUE' },
      })
    ).rejects.toMatchObject({ reason: 'CONTENT_CHANGED' });
  });

  it('rechecks revoked and changed canonical callers before bounded receipt replay or owner response', async () => {
    const { host, guest, room } = await pair();
    const command = nameReport();
    await reportPlayContent(host, room.id, command);
    await expect(
      reportPlayContent({ ...host, identity: guest.identity }, room.id, command)
    ).rejects.toMatchObject({ code: 'conflict' });
    await authority.access.logout(authority.ownerToken);
    await expect(reportPlayContent(host, room.id, command)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    await expect(
      reviewPlayReport(host, command.actionId, {
        actionId: randomUUID(),
        expectedRevision: 0,
        action: 'RESPOND',
        response: 'Reviewed.',
      })
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rechecks real owner authority before replaying a completed review acknowledgment', async () => {
    const { host, guest, room } = await pair();
    const report = nameReport();
    await reportPlayContent(host, room.id, report);
    const command = {
      actionId: randomUUID(),
      expectedRevision: 0,
      action: 'RESPOND',
      response: 'Reviewed by the server owner.',
    };
    await reviewPlayReport(host, report.actionId, command);
    await authority.access.store.transact((state) => {
      const owner = state.principals.find((principal) => principal.id === authority.ownerId)!;
      const successor = state.principals.find(
        (principal) => principal.id === guest.identity.userId
      )!;
      owner.role = 'member';
      successor.role = 'owner';
    });
    const demoted = await playTestActor(instance, authority.ownerToken);
    expect(demoted.identity.isOwner).toBe(false);
    await expect(reviewPlayReport(demoted, report.actionId, command)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(reviewPlayReport(host, report.actionId, command)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(
      await instance.database.playSafetyReport.findUnique({ where: { id: report.actionId } })
    ).toMatchObject({ revision: 1, response: command.response });
  });

  it('recovers a lost committed block acknowledgment without replaying its effect after unblock', async () => {
    const { host, guest, room } = await pair();
    let loseCommit = true;
    const database = new Proxy(instance.database, {
      get(target, key, receiver) {
        if (key !== '$transaction') return Reflect.get(target, key, receiver);
        return async (
          operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: { isolationLevel?: Prisma.TransactionIsolationLevel }
        ) => {
          const result = await target.$transaction(operation, options);
          if (loseCommit) {
            loseCommit = false;
            throw new Error('Safety acknowledgment connection lost after COMMIT');
          }
          return result;
        };
      },
    });
    const command = { actionId: randomUUID() };
    await expect(blockPlayPartner({ ...host, database }, room.id, command)).rejects.toThrow(
      'Safety acknowledgment connection lost after COMMIT'
    );
    expect((await listPlayBlocks(host)).blocks).toHaveLength(1);
    await unblockPlayPartner(host, guest.identity.userId, { actionId: randomUUID() });
    expect(await blockPlayPartner(host, room.id, command)).toEqual({
      actionId: command.actionId,
      completed: true,
    });
    expect((await listPlayBlocks(host)).blocks).toEqual([]);
  });

  it('reports only revealed other open answers and refuses hidden answers, own answers and fixed choice IDs', async () => {
    const { host, guest, room } = await pair('KNOW_ME', 'OPEN');
    let current = await actOnStoredPlayRoom(host, room.id, {
      actionId: randomUUID(),
      expectedRevision: 0,
      type: 'START',
    });
    current = await step(host, current, { type: 'ANSWER', text: 'Am Strand' });
    const report = (text: string) => ({
      ...nameReport(text),
      selector: { kind: 'ROUND_TEXT', roundId: current.round!.id, field: 'OTHER_ANSWER' },
    });
    await expect(reportPlayContent(guest, room.id, report('Am Strand'))).rejects.toMatchObject({
      reason: 'CONTENT_CHANGED',
    });
    current = await step(guest, current, { type: 'ANSWER', text: 'Im Park' });
    await reportPlayContent(guest, room.id, report('Am Strand'));
    await reportPlayContent(host, room.id, report('Im Park'));
    await expect(reportPlayContent(guest, room.id, report('Im Park'))).rejects.toMatchObject({
      reason: 'CONTENT_CHANGED',
    });
    const choice = await pair('KNOW_ME', 'CHOICES');
    let choices = await actOnStoredPlayRoom(choice.host, choice.room.id, {
      actionId: randomUUID(),
      expectedRevision: 0,
      type: 'START',
    });
    choices = await step(choice.host, choices, { type: 'CHOOSE', optionId: 'A' });
    choices = await step(choice.guest, choices, { type: 'CHOOSE', optionId: 'B' });
    await expect(
      reportPlayContent(choice.host, choice.room.id, {
        ...report('B'),
        selector: { kind: 'ROUND_TEXT', roundId: choices.round!.id, field: 'OTHER_ANSWER' },
      })
    ).rejects.toMatchObject({ reason: 'CONTENT_CHANGED' });
  });

  it('attributes mission messages and hints to the original other-seat index', async () => {
    const { host, guest, room } = await pair('MISSION');
    let current = await actOnStoredPlayRoom(host, room.id, {
      actionId: randomUUID(),
      expectedRevision: 0,
      type: 'START',
    });
    current = await step(host, current, { type: 'MESSAGE', text: 'Einen Kaffee, bitte.' });
    current = await step(guest, current, { type: 'MESSAGE', text: 'Mit Milch?' });
    current = await step(host, current, { type: 'HINT', text: 'Die Tasse ist klein.' });
    current = await step(guest, current, { type: 'HINT', text: 'Du kannst bitte sagen.' });
    const report = (field: 'MESSAGE' | 'HINT', index: number, text: string) => ({
      ...nameReport(text),
      selector: { kind: 'ROUND_TEXT', roundId: current.round!.id, field, index },
    });
    await reportPlayContent(host, room.id, report('MESSAGE', 1, 'Mit Milch?'));
    await reportPlayContent(host, room.id, report('HINT', 1, 'Du kannst bitte sagen.'));
    await expect(
      reportPlayContent(host, room.id, report('MESSAGE', 0, 'Einen Kaffee, bitte.'))
    ).rejects.toMatchObject({ reason: 'CONTENT_CHANGED' });
    await expect(
      reportPlayContent(host, room.id, report('HINT', 0, 'Die Tasse ist klein.'))
    ).rejects.toMatchObject({ reason: 'CONTENT_CHANGED' });
    await expect(
      reportPlayContent(host, room.id, report('MESSAGE', 0, 'Mit Milch?'))
    ).rejects.toMatchObject({ reason: 'CONTENT_CHANGED' });
    await expect(
      reportPlayContent(host, room.id, report('MESSAGE', 5, 'Mit Milch?'))
    ).rejects.toMatchObject({ reason: 'CONTENT_CHANGED' });
    expect((await listOwnPlayReports(host)).reports.map((row) => row.evidence.text).sort()).toEqual(
      ['Du kannst bitte sagen.', 'Mit Milch?']
    );
  });

  it('attributes describe guesses to the partner and feedback corrections to the non-learner seat', async () => {
    const { host, guest, room } = await pair('DESCRIBE');
    let current = await actOnStoredPlayRoom(host, room.id, {
      actionId: randomUUID(),
      expectedRevision: 0,
      type: 'START',
    });
    current = await step(host, current, { type: 'SET_TARGET', text: 'Ein Haus' });
    current = await step(host, current, { type: 'GIVE_CLUE', text: 'Ein Ort zum Wohnen' });
    current = await step(guest, current, { type: 'GUESS', text: 'Eine Wohnung' });
    const report = (field: 'GUESS' | 'CORRECTION' | 'TARGET', text: string) => ({
      ...nameReport(text),
      selector: { kind: 'ROUND_TEXT', roundId: current.round!.id, field },
    });
    await reportPlayContent(host, room.id, report('GUESS', 'Eine Wohnung'));
    await expect(
      reportPlayContent(guest, room.id, report('GUESS', 'Eine Wohnung'))
    ).rejects.toMatchObject({ reason: 'CONTENT_CHANGED' });
    await reportPlayContent(guest, room.id, report('TARGET', 'Ein Haus'));
    current = await step(guest, current, {
      type: 'FEEDBACK',
      understood: true,
      correction: 'Das Haus ist klein.',
    });
    await reportPlayContent(host, room.id, report('CORRECTION', 'Das Haus ist klein.'));
    await expect(
      reportPlayContent(guest, room.id, report('CORRECTION', 'Das Haus ist klein.'))
    ).rejects.toMatchObject({ reason: 'CONTENT_CHANGED' });
  });

  it('rejects incomplete consent, self blocks, unbounded evidence and malformed acknowledgments in PostgreSQL', async () => {
    const { host, guest, room } = await pair();
    await expect(
      instance.database.playSafetyState.update({
        where: { userId: host.identity.userId },
        data: { conductVersion: null },
      })
    ).rejects.toThrow(/PlaySafetyState_state_check/);
    await expect(
      instance.database.playSafetyState.update({
        where: { userId: host.identity.userId },
        data: { acceptedAt: null },
      })
    ).rejects.toThrow(/PlaySafetyState_state_check/);
    await expect(
      instance.database.playUserBlock.create({
        data: { blockerUserId: host.identity.userId, blockedUserId: host.identity.userId },
      })
    ).rejects.toThrow(/PlayUserBlock_distinct_check/);
    const command = nameReport();
    await reportPlayContent(host, room.id, command);
    for (const evidence of [
      { selector: { kind: 'PARTNER_NAME' } },
      { selector: { kind: 'PARTNER_NAME' }, text: 'x'.repeat(501) },
    ])
      await expect(
        instance.database.playSafetyReport.update({
          where: { id: command.actionId },
          data: { evidence },
        })
      ).rejects.toThrow(/PlaySafetyReport_content_check/);
    await expect(
      instance.database.playSafetyReport.update({
        where: { id: command.actionId },
        data: { respondedAt: new Date() },
      })
    ).rejects.toThrow(/PlaySafetyReport_content_check/);
    const receipt = { actorUserId: host.identity.userId, actionId: command.actionId };
    await expect(
      instance.database.playSafetyReceipt.update({
        where: { actorUserId_actionId: receipt },
        data: { result: { actionId: command.actionId } },
      })
    ).rejects.toThrow(/PlaySafetyReceipt_result_check/);
    await expect(
      instance.database.playSafetyReceipt.update({
        where: { actorUserId_actionId: receipt },
        data: {
          result: { actionId: command.actionId, completed: true, content: 'unbounded payload' },
        },
      })
    ).rejects.toThrow(/PlaySafetyReceipt_result_check/);
    await blockPlayPartner(guest, room.id, { actionId: randomUUID() });
    await instance.database.user.delete({ where: { id: guest.identity.userId } });
    expect(await instance.database.playSafetyReport.count()).toBe(0);
    expect(await instance.database.playUserBlock.count()).toBe(0);
    expect(
      await instance.database.playSafetyState.findUnique({
        where: { userId: guest.identity.userId },
      })
    ).toBeNull();
    expect(
      await instance.database.playSafetyReceipt.count({
        where: { actorUserId: guest.identity.userId },
      })
    ).toBe(0);
  });
});
