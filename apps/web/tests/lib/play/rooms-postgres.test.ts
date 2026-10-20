// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PlayRoomView, PlayRoundCommand } from '@sotto/shared';
import { playFingerprint } from '@/lib/play/storage/fingerprint';
import { listStoredPlayPhrases, saveStoredPlayPhrase } from '@/lib/play/storage/phrases';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  actOnStoredPlayRoom,
  createStoredPlayRoom,
  PLAY_ROOM_TTL_MS,
  readStoredPlayRoom,
} from '@/lib/play/storage/rooms';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const hostSettings = { nativeLang: 'en', targetLang: 'de', level: 'A1' } as const;
const guestSettings = { nativeLang: 'es', targetLang: 'en', level: 'B2' } as const;

suite('persistent private games on PostgreSQL', () => {
  let instance: SharedTestInstance;
  let authority: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('play_rooms');
  });
  beforeEach(async () => {
    authority = await instance.reset();
  });
  afterAll(async () => instance?.close());

  async function actor(token: string) {
    const request = new Request('http://localhost/api/v1/play/rooms', {
      headers: { cookie: `sotto_session=${token}` },
    });
    const identity = await sottoTransaction(instance.database, (database) =>
      resolveSottoRequest(database, request)
    );
    if (identity?.kind !== 'content') throw new Error('Test requires a selected profile');
    return { database: instance.database, request, identity };
  }

  function createInput() {
    return {
      actionId: randomUUID(),
      kind: 'KNOW_ME',
      theme: 'EVERYDAY',
      settings: hostSettings,
    };
  }

  async function waitingPair(kind: 'DESCRIBE' | 'KNOW_ME' = 'KNOW_ME') {
    const host = await actor(authority.ownerToken);
    const member = await authority.household('Guest');
    const guest = await actor(member.token);
    const room = await createStoredPlayRoom(host, { ...createInput(), kind });
    // Admission is a separate tested tool boundary. This fixture starts with two admitted members.
    await instance.database.playRoom.update({
      where: { id: room.id },
      data: { guestUserId: member.id, guestSettings },
    });
    return { host, guest, room };
  }

  async function playingPair(kind: 'DESCRIBE' | 'KNOW_ME' = 'KNOW_ME') {
    const pair = await waitingPair(kind);
    const room = await actOnStoredPlayRoom(pair.host, pair.room.id, {
      actionId: randomUUID(),
      expectedRevision: 0,
      type: 'START',
    });
    return { ...pair, room };
  }

  function roundAction(view: PlayRoomView, command: PlayRoundCommand) {
    return { actionId: randomUUID(), expectedRevision: view.revision, command };
  }

  it('creates an independent game without courses or providers and replays its exact receipt', async () => {
    const host = await actor(authority.ownerToken);
    const command = createInput();
    const room = await createStoredPlayRoom(host, command);
    expect(room).toMatchObject({
      status: 'WAITING',
      host: { id: authority.ownerId, settings: hostSettings },
      guest: null,
      revision: 0,
      round: null,
      points: 0,
      hostWaiting: false,
      allowedActions: ['LEAVE', 'CANCEL'],
    });
    expect(await createStoredPlayRoom(host, command)).toEqual(room);
    expect(await instance.database.playRoom.count()).toBe(1);
    expect(await instance.database.course.count()).toBe(0);
    await expect(createStoredPlayRoom(host, { ...command, theme: 'TRAVEL' })).rejects.toMatchObject(
      { code: 'conflict' }
    );
  });

  it('coalesces concurrent room creation using one actor and action ID', async () => {
    const host = await actor(authority.ownerToken);
    const command = createInput();
    const results = await Promise.all([
      createStoredPlayRoom(host, command),
      createStoredPlayRoom(host, command),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await instance.database.playRoom.count()).toBe(1);
  });

  it('keeps rooms private and refuses an identity changed after initial authentication', async () => {
    const { host, guest, room } = await waitingPair();
    const stranger = await actor((await authority.household('Stranger')).token);
    await expect(readStoredPlayRoom(stranger, room.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      readStoredPlayRoom({ ...host, identity: guest.identity }, room.id)
    ).rejects.toMatchObject({ code: 'conflict' });
    const guestView = await readStoredPlayRoom(guest, room.id);
    expect(guestView).toMatchObject({ ownSeat: 'GUEST', guest: { settings: guestSettings } });
    expect(guestView.allowedActions).toEqual(['LEAVE']);
  });

  it('revalidates revoked credentials before reads and private receipt recovery', async () => {
    const host = await actor(authority.ownerToken);
    const command = createInput();
    const room = await createStoredPlayRoom(host, command);
    await authority.access.logout(authority.ownerToken);
    await expect(readStoredPlayRoom(host, room.id)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(createStoredPlayRoom(host, command)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(await instance.database.playRoom.count()).toBe(1);
  });

  it('allows only the host to start and hides the other committed pick in persisted projections', async () => {
    const { host, guest, room } = await waitingPair();
    await expect(
      actOnStoredPlayRoom(guest, room.id, {
        actionId: randomUUID(),
        expectedRevision: 0,
        type: 'START',
      })
    ).rejects.toMatchObject({ code: 'forbidden' });
    const started = await actOnStoredPlayRoom(host, room.id, {
      actionId: randomUUID(),
      expectedRevision: 0,
      type: 'START',
    });
    expect(started.round).toMatchObject({ learner: 'HOST', targetLang: 'de', phase: 'ANSWER' });
    const pick = roundAction(started, { type: 'CHOOSE', optionId: 'A' });
    const selected = await actOnStoredPlayRoom(host, room.id, pick);
    expect(selected.round).toMatchObject({ ownAnswer: 'A', otherAnswer: null });
    const hidden = await readStoredPlayRoom(guest, room.id);
    expect(hidden.round).toMatchObject({
      ownAnswer: null,
      otherAnswer: null,
      otherCommitted: true,
    });
    expect(hidden.completedRounds).toEqual([]);
    await expect(
      actOnStoredPlayRoom(guest, room.id, { ...pick, actionId: randomUUID() })
    ).rejects.toMatchObject({ code: 'conflict' });
    const finished = await actOnStoredPlayRoom(
      guest,
      room.id,
      roundAction(hidden, { type: 'CHOOSE', optionId: 'A' })
    );
    expect(finished).toMatchObject({
      points: 2,
      round: { phase: 'FINISHED', ownAnswer: 'A', otherAnswer: 'A', result: { matched: true } },
    });
    expect(await actOnStoredPlayRoom(host, room.id, pick)).toEqual(selected);
    expect((await readStoredPlayRoom(host, room.id)).points).toBe(2);
    await expect(
      actOnStoredPlayRoom(host, room.id, {
        ...pick,
        command: { type: 'CHOOSE', optionId: 'B' },
      })
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('commits one of two simultaneous revisions and lets the other player reconcile', async () => {
    const { host, guest, room } = await playingPair();
    const results = await Promise.allSettled([
      actOnStoredPlayRoom(host, room.id, roundAction(room, { type: 'CHOOSE', optionId: 'A' })),
      actOnStoredPlayRoom(guest, room.id, roundAction(room, { type: 'CHOOSE', optionId: 'B' })),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'conflict' }) }),
    ]);
    const hostView = await readStoredPlayRoom(host, room.id);
    const loser = results[0]?.status === 'rejected' ? host : guest;
    const reconciled = await actOnStoredPlayRoom(
      loser,
      room.id,
      roundAction(hostView, { type: 'CHOOSE', optionId: 'C' })
    );
    expect(reconciled).toMatchObject({ points: 1, round: { phase: 'FINISHED' } });
    expect(reconciled.revision).toBe(room.revision + 2);
  });

  it('replays a simultaneous identical game action without awarding twice', async () => {
    const { host, room } = await playingPair();
    const action = roundAction(room, { type: 'SKIP' });
    const [first, second] = await Promise.all([
      actOnStoredPlayRoom(host, room.id, action),
      actOnStoredPlayRoom(host, room.id, action),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ revision: room.revision + 1, points: 0 });
    expect(await instance.database.playRound.count({ where: { roomId: room.id } })).toBe(2);
  });

  it('swaps roles, finishes once, and creates a rematch while retaining the original recap', async () => {
    const { host, guest, room } = await playingPair();
    let view = room;
    for (let round = 0; round < 2; round++) {
      expect(view.round?.learner).toBe(round === 0 ? 'HOST' : 'GUEST');
      expect(view.round?.targetLang).toBe(round === 0 ? 'de' : 'en');
      view = await actOnStoredPlayRoom(
        host,
        room.id,
        roundAction(view, { type: 'CHOOSE', optionId: 'B' })
      );
      view = await actOnStoredPlayRoom(
        guest,
        room.id,
        roundAction(view, { type: 'CHOOSE', optionId: 'B' })
      );
      view = await actOnStoredPlayRoom(host, room.id, {
        actionId: randomUUID(),
        expectedRevision: view.revision,
        type: 'NEXT_ROUND',
      });
    }
    expect(view).toMatchObject({ status: 'COMPLETED', round: null, points: 4 });
    expect(view.completedRounds).toHaveLength(2);
    const rematchAction = {
      actionId: randomUUID(),
      expectedRevision: view.revision,
      type: 'REMATCH',
    };
    const expiredAt = new Date(Date.now() + PLAY_ROOM_TTL_MS + 1000);
    const rematch = await actOnStoredPlayRoom(host, room.id, rematchAction, expiredAt);
    expect(rematch).toMatchObject({
      status: 'WAITING',
      points: 0,
      guest: { settings: guestSettings },
    });
    expect(rematch.id).not.toBe(room.id);
    expect(await actOnStoredPlayRoom(host, room.id, rematchAction)).toEqual(rematch);
    const recap = await readStoredPlayRoom(guest, room.id);
    expect(recap.completedRounds).toHaveLength(2);
    expect(recap.rematchRoomId).toBe(rematch.id);
    const hostRecap = await readStoredPlayRoom(host, room.id, expiredAt);
    expect(hostRecap.allowedActions).toEqual([]);
    await expect(
      actOnStoredPlayRoom(
        host,
        room.id,
        {
          actionId: randomUUID(),
          expectedRevision: hostRecap.revision,
          type: 'REMATCH',
        },
        expiredAt
      )
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await instance.database.playRoom.count()).toBe(2);
    await instance.database.user.delete({ where: { id: guest.identity.userId } });
    expect(await instance.database.playRoom.count()).toBe(0);
  });

  it('projects expiry without allowing further mutations', async () => {
    const { host, room } = await waitingPair();
    const stored = await instance.database.playRoom.findUniqueOrThrow({ where: { id: room.id } });
    const expiredAt = new Date(stored.createdAt.getTime() + PLAY_ROOM_TTL_MS + 1);
    expect(await readStoredPlayRoom(host, room.id, expiredAt)).toMatchObject({
      status: 'EXPIRED',
      allowedActions: [],
    });
    await expect(
      actOnStoredPlayRoom(
        host,
        room.id,
        { actionId: randomUUID(), expectedRevision: 0, type: 'START' },
        expiredAt
      )
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('saves only visible phrases, keeping a skipped secret private in the recap too', async () => {
    const { host, guest, room } = await playingPair('DESCRIBE');
    const selected = await actOnStoredPlayRoom(
      host,
      room.id,
      roundAction(room, { type: 'SET_TARGET', text: 'Regenschirm' })
    );
    if (!selected.round) throw new Error('Test requires the active round');
    const phrase = {
      roundId: selected.round.id,
      kind: 'WORD',
      text: 'Regenschirm',
      contextText: 'Use it when it rains.',
    };
    const own = await saveStoredPlayPhrase(host, room.id, phrase);
    expect(own).toMatchObject({
      text: 'Regenschirm',
      targetLang: 'de',
      roundId: selected.round.id,
    });
    await expect(saveStoredPlayPhrase(guest, room.id, phrase)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      saveStoredPlayPhrase(host, room.id, { ...phrase, text: 'A fabricated transcript' })
    ).rejects.toMatchObject({ code: 'forbidden' });
    const skipped = await actOnStoredPlayRoom(
      host,
      room.id,
      roundAction(selected, { type: 'SKIP' })
    );
    await actOnStoredPlayRoom(host, room.id, {
      actionId: randomUUID(),
      expectedRevision: skipped.revision,
      type: 'NEXT_ROUND',
    });
    await expect(saveStoredPlayPhrase(guest, room.id, phrase)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect((await listStoredPlayPhrases(guest)).phrases).toEqual([]);
    expect((await listStoredPlayPhrases(host)).phrases).toEqual([own]);
    expect(await instance.database.course.count()).toBe(0);
  });

  it('allows the partner to save a target after it is revealed by a guess', async () => {
    const { host, guest, room } = await playingPair('DESCRIBE');
    let view = await actOnStoredPlayRoom(
      host,
      room.id,
      roundAction(room, { type: 'SET_TARGET', text: 'Regenschirm' })
    );
    view = await actOnStoredPlayRoom(
      host,
      room.id,
      roundAction(view, { type: 'GIVE_CLUE', text: 'Er hält dich im Regen trocken.' })
    );
    if (!view.round) throw new Error('Test requires the clue round');
    const selection = { roundId: view.round.id, contextText: null };
    expect(
      await saveStoredPlayPhrase(guest, room.id, {
        ...selection,
        kind: 'WORD',
        text: 'Regen',
      })
    ).toMatchObject({ text: 'Regen', targetLang: 'de' });
    expect(
      await saveStoredPlayPhrase(guest, room.id, {
        ...selection,
        kind: 'PHRASE',
        text: 'im Regen',
      })
    ).toMatchObject({ text: 'im Regen', targetLang: 'de' });
    await expect(
      saveStoredPlayPhrase(guest, room.id, {
        ...selection,
        kind: 'WORD',
        text: 'Regenschirm',
      })
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      saveStoredPlayPhrase(guest, room.id, {
        ...selection,
        kind: 'PHRASE',
        text: 'hält trocken',
      })
    ).rejects.toMatchObject({ code: 'forbidden' });
    view = await actOnStoredPlayRoom(
      guest,
      room.id,
      roundAction(view, { type: 'GUESS', text: 'Regenschirm' })
    );
    if (!view.round) throw new Error('Test requires the revealed round');
    expect(view.round.revealed).toBe(true);
    const phrase = await saveStoredPlayPhrase(guest, room.id, {
      roundId: view.round.id,
      kind: 'WORD',
      text: 'Regenschirm',
      contextText: null,
    });
    expect(phrase).toMatchObject({ text: 'Regenschirm', targetLang: 'de' });
    expect((await listStoredPlayPhrases(host)).phrases).toEqual([]);
  });

  it('deduplicates concurrent explicit saves and paginates each private notebook', async () => {
    const { host, guest, room } = await playingPair();
    if (room.round?.mode !== 'KNOW_ME') throw new Error('Test requires prediction cards');
    expect(await instance.database.playPhrase.count()).toBe(0);
    const round = room.round;
    const first = {
      roundId: round.id,
      kind: 'PHRASE',
      text: round.choices[0]!.text,
      contextText: null,
    };
    const saved = await Promise.all([
      saveStoredPlayPhrase(host, room.id, first),
      saveStoredPlayPhrase(host, room.id, first),
    ]);
    expect(saved[0]).toEqual(saved[1]);
    for (const card of round.choices.slice(1))
      await saveStoredPlayPhrase(host, room.id, { ...first, text: card.text });
    const page = await listStoredPlayPhrases(host, { limit: 2 });
    expect(page.phrases).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const next = await listStoredPlayPhrases(host, { limit: 2, beforeId: page.nextCursor });
    expect(next.phrases).toHaveLength(2);
    expect(next.nextCursor).toBeNull();
    expect(new Set([...page.phrases, ...next.phrases].map((phrase) => phrase.id)).size).toBe(4);
    expect((await listStoredPlayPhrases(guest)).phrases).toEqual([]);
    await expect(listStoredPlayPhrases(guest, { beforeId: page.nextCursor })).rejects.toMatchObject(
      { code: 'forbidden' }
    );
    const stranger = await actor((await authority.household('Other player')).token);
    await expect(saveStoredPlayPhrase(stranger, room.id, first)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await authority.access.logout(authority.ownerToken);
    await expect(listStoredPlayPhrases(host)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  async function seedAdmission(roomId: string, candidateUserId: string) {
    const requestId = randomUUID();
    const now = new Date();
    return instance.database.playJoinRequest.create({
      data: {
        id: requestId,
        roomId,
        generation: 1,
        candidateKind: 'EXISTING',
        candidateUserId,
        settings: guestSettings,
        client: 'BROWSER',
        deviceName: 'Test browser',
        proofHash: playFingerprint(requestId),
        fingerprint: playFingerprint({ roomId, candidateUserId }),
        status: 'ACCEPTED',
        acceptedAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      },
    });
  }

  async function seedLease(roomId: string) {
    const now = new Date();
    return instance.database.playPresenceLease.create({
      data: {
        roomId,
        credentialId: randomUUID(),
        credentialKind: 'session',
        viewHash: playFingerprint(randomUUID()),
        accessFingerprint: playFingerprint(await authority.access.store.read()),
        renewedAt: now,
        expiresAt: new Date(now.getTime() + 20_000),
        credentialExpiresAt: new Date(now.getTime() + 60_000),
      },
    });
  }

  it('cancels both players together and revokes pending admission and waiting leases', async () => {
    const { host, guest, room } = await waitingPair();
    await seedAdmission(room.id, guest.identity.userId);
    await seedLease(room.id);
    expect((await readStoredPlayRoom(host, room.id)).hostWaiting).toBe(true);
    const cancelled = await actOnStoredPlayRoom(guest, room.id, {
      actionId: randomUUID(),
      expectedRevision: 0,
      type: 'LEAVE',
    });
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      allowedActions: [],
      hostWaiting: false,
    });
    expect(await instance.database.playPresenceLease.count()).toBe(0);
    expect(await instance.database.playJoinRequest.findFirstOrThrow()).toMatchObject({
      status: 'REVOKED',
      deliveryState: null,
    });
  });

  it.each(['HOST', 'GUEST'] as const)(
    'erases transcripts, claims, receipts and private notes when the %s profile is deleted',
    async (seat) => {
      const { host, guest, room } = await playingPair();
      await seedAdmission(room.id, guest.identity.userId);
      await seedLease(room.id);
      const round = await instance.database.playRound.findFirstOrThrow({
        where: { roomId: room.id },
      });
      await instance.database.playPhrase.create({
        data: {
          userId: guest.identity.userId,
          roomId: room.id,
          roundId: round.id,
          kind: 'WORD',
          text: 'Hallo',
          targetLang: 'de',
          fingerprint: playFingerprint('Hallo'),
        },
      });
      expect(await instance.database.playActionReceipt.count()).toBe(2);
      const userId = seat === 'HOST' ? host.identity.userId : guest.identity.userId;
      await instance.database.user.delete({ where: { id: userId } });
      expect(await instance.database.playRoom.count()).toBe(0);
      expect(await instance.database.playRound.count()).toBe(0);
      expect(await instance.database.playJoinRequest.count()).toBe(0);
      expect(await instance.database.playActionReceipt.count()).toBe(0);
      expect(await instance.database.playPresenceLease.count()).toBe(0);
      expect(await instance.database.playPhrase.count()).toBe(0);
    }
  );

  it('keeps games independent of course deletion', async () => {
    const { host, room } = await playingPair();
    const curriculum = await instance.database.curriculum.create({
      data: { nativeLang: 'en', targetLang: 'de', title: 'Independent course' },
    });
    const course = await instance.database.course.create({
      data: {
        userId: host.identity.userId,
        curriculumId: curriculum.id,
        nativeLang: 'en',
        targetLang: 'de',
      },
    });
    await instance.database.course.delete({ where: { id: course.id } });
    expect((await readStoredPlayRoom(host, room.id)).status).toBe('PLAYING');
    expect(await instance.database.playRound.count()).toBe(2);
  });

  it('enforces one reserved guest and composite round provenance at the database boundary', async () => {
    const { host, guest, room } = await playingPair();
    await seedAdmission(room.id, guest.identity.userId);
    const stranger = await authority.household('Another candidate');
    await expect(seedAdmission(room.id, stranger.id)).rejects.toMatchObject({ code: 'P2002' });
    const other = await createStoredPlayRoom(host, createInput());
    const round = await instance.database.playRound.findFirstOrThrow({
      where: { roomId: room.id },
    });
    await expect(
      instance.database.playPhrase.create({
        data: {
          userId: host.identity.userId,
          roomId: other.id,
          roundId: round.id,
          kind: 'WORD',
          text: 'Hallo',
          targetLang: 'de',
          fingerprint: playFingerprint('Hallo'),
        },
      })
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(await instance.database.playPhrase.count()).toBe(0);
  });

  it('rejects self-joining rooms and incomplete new-profile approval records in PostgreSQL', async () => {
    const { host, room } = await waitingPair();
    await expect(
      instance.database.playRoom.update({
        where: { id: room.id },
        data: { guestUserId: host.identity.userId },
      })
    ).rejects.toThrow(/PlayRoom_valid_state/);
    const id = randomUUID();
    const request = {
      id,
      roomId: room.id,
      generation: 1,
      candidateKind: 'NEW',
      settings: guestSettings,
      client: 'NATIVE',
      deviceName: 'Test phone',
      proofHash: playFingerprint(id),
      fingerprint: playFingerprint({ id }),
      plannedProfileId: randomUUID(),
      status: 'WAITING_FOR_OWNER',
      expiresAt: new Date(Date.now() + 60_000),
    };
    await expect(instance.database.playJoinRequest.create({ data: request })).rejects.toThrow(
      /PlayJoinRequest_valid_state/
    );
    await expect(
      instance.database.playJoinRequest.create({
        data: {
          ...request,
          proposedName: 'New learner',
          approvedByUserId: authority.ownerId,
        },
      })
    ).rejects.toThrow(/PlayJoinRequest_valid_state/);
    expect(await instance.database.playJoinRequest.count()).toBe(0);
  });
});
