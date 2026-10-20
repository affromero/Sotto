// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { newToken } from 'thesidedoor-core/access';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { approvePlayEntry } from '@/lib/play/admission/approvals';
import {
  readPlayInvitation,
  rotatePlayInvitation,
  previewPlayInvitation,
} from '@/lib/play/admission/invitations';
import { requestPlayEntry, readPlayEntryStatus } from '@/lib/play/admission/requests';
import { updatePlayPresence } from '@/lib/play/admission/presence';
import { issueSottoPairing, redeemSottoPairing } from '@/lib/sidedoor/access/core/pairing';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { createStoredPlayRoom, readStoredPlayRoom } from '@/lib/play/storage/rooms';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const settings = { nativeLang: 'es', targetLang: 'de', level: 'A1' } as const;

suite('invitation requests and canonical owner approval', () => {
  let instance: SharedTestInstance, authority: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('play_admission');
  });
  beforeEach(async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'isolated-play-admission-test-key');
    authority = await instance.reset();
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => instance?.close());

  async function actor(token: string) {
    const request = new Request('http://localhost/api/v1/play', {
      headers: { cookie: `sotto_session=${token}` },
    });
    const identity = await sottoTransaction(instance.database, (database) =>
      resolveSottoRequest(database, request)
    );
    if (identity?.kind !== 'content')
      throw new Error('Fixture requires canonical content admission');
    return { database: instance.database, request, identity };
  }

  async function roomFixture(ownerHost = true) {
    const owner = await actor(authority.ownerToken);
    const host = ownerHost ? owner : await actor((await authority.household('Game host')).token);
    let room = await createStoredPlayRoom(host, {
      actionId: randomUUID(),
      kind: 'MIXED',
      theme: 'EVERYDAY',
      settings,
    });
    const viewNonce = newToken();
    await updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce });
    const invitation = await rotatePlayInvitation(host, room.id, {
      actionId: randomUUID(),
      expectedRevision: 0,
    });
    room = await readStoredPlayRoom(host, room.id);
    return { owner, host, room, invitation, viewNonce };
  }

  function newRequest(code: string) {
    return {
      requestId: randomUUID(),
      code,
      client: 'NATIVE',
      deviceName: 'Partner phone',
      candidate: { kind: 'NEW', name: 'New partner', settings, consentToProfile: true },
    };
  }

  it('opens invitations without side effects and recovers the host code from encrypted storage', async () => {
    const { host, room, invitation } = await roomFixture();
    const before = await instance.database.user.count();
    const preview = await previewPlayInvitation(instance.database, invitation.code);
    expect(preview).toMatchObject({ roomId: room.id, hostName: 'Owner', hostWaiting: true });
    expect(Object.keys(preview!)).not.toContain('hostUserId');
    expect(Object.keys(preview!)).not.toContain('hostSettings');
    expect(await instance.database.user.count()).toBe(before);
    expect(await instance.database.playJoinRequest.count()).toBe(0);
    expect(await readPlayInvitation(host, room.id)).toEqual(invitation);
    expect(JSON.stringify(await instance.database.playActionReceipt.findMany())).not.toContain(
      invitation.code
    );
    const stranger = await actor((await authority.household('Stranger')).token);
    await expect(readPlayInvitation(stranger, room.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('makes concurrent invitation rotation idempotent and rejects conflicting action reuse', async () => {
    const { host, room, invitation } = await roomFixture();
    const command = { actionId: randomUUID(), expectedRevision: room.revision };
    const [first, second] = await Promise.all([
      rotatePlayInvitation(host, room.id, command),
      rotatePlayInvitation(host, room.id, command),
    ]);
    expect(first).toEqual(second);
    expect(first.generation).toBe(2);
    expect(await readPlayInvitation(host, room.id)).toEqual(first);
    expect(await previewPlayInvitation(instance.database, invitation.code)).toBeNull();
    await expect(
      rotatePlayInvitation(host, room.id, { ...command, expectedRevision: 0 })
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rolls rotation back if its encryption key is unavailable', async () => {
    const { host, room, invitation } = await roomFixture();
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '');
    await expect(
      rotatePlayInvitation(host, room.id, {
        actionId: randomUUID(),
        expectedRevision: room.revision,
      })
    ).rejects.toThrow(/BYOK_ENCRYPTION_KEY/);
    expect(
      (await instance.database.playRoom.findUniqueOrThrow({ where: { id: room.id } })).revision
    ).toBe(room.revision);
    expect(await previewPlayInvitation(instance.database, invitation.code)).not.toBeNull();
  });

  it('records only consent and proof before approval, coalesces retries, and isolates claimant status', async () => {
    const { invitation } = await roomFixture();
    const command = newRequest(invitation.code),
      proof = newToken();
    const [first, second] = await Promise.all([
      requestPlayEntry(instance.database, command, proof, null),
      requestPlayEntry(instance.database, command, proof, null),
    ]);
    expect(first.requestId).toBe(second.requestId);
    expect(first.status).toBe('WAITING_FOR_OWNER');
    expect(await instance.database.user.count()).toBe(1);
    expect(await instance.database.apiKey.count()).toBe(0);
    expect(await instance.database.playJoinRequest.count()).toBe(1);
    const stored = await instance.database.playJoinRequest.findUniqueOrThrow({
      where: { id: command.requestId },
    });
    expect(stored).toMatchObject({
      plannedProfileId: null,
      provisionedUserId: null,
      approvedByUserId: null,
      approvedAt: null,
      deliveryState: null,
    });
    expect(JSON.stringify(stored)).not.toContain(proof);
    expect(await readPlayEntryStatus(instance.database, command.requestId, proof)).toMatchObject({
      status: 'WAITING_FOR_OWNER',
    });
    await expect(
      readPlayEntryStatus(instance.database, command.requestId, newToken())
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      requestPlayEntry(
        instance.database,
        { ...command, deviceName: 'Different phone' },
        proof,
        null
      )
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      requestPlayEntry(instance.database, command, newToken(), null)
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('requires current admission for existing learners and rejects self-joining', async () => {
    const { owner, invitation } = await roomFixture();
    const request = {
      ...newRequest(invitation.code),
      candidate: {
        kind: 'EXISTING',
        expectedProfileId: owner.identity.userId,
        settings,
      },
    };
    await expect(
      requestPlayEntry(instance.database, request, newToken(), null)
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      requestPlayEntry(instance.database, request, newToken(), owner)
    ).rejects.toMatchObject({ code: 'conflict' });
    const guest = await actor((await authority.household('Existing guest')).token);
    request.candidate.expectedProfileId = guest.identity.userId;
    expect(await requestPlayEntry(instance.database, request, newToken(), guest)).toMatchObject({
      status: 'HOST_UNAVAILABLE',
    });
    expect(await instance.database.user.count()).toBe(2);
  });

  it('rejects an existing intake when the displayed profile differs from canonical admission, including replay', async () => {
    const { invitation } = await roomFixture();
    const first = await actor((await authority.household('First')).token);
    const second = await actor((await authority.household('Second')).token);
    const proof = newToken();
    const request = {
      ...newRequest(invitation.code),
      candidate: {
        kind: 'EXISTING',
        expectedProfileId: first.identity.userId,
        settings,
      },
    };
    await expect(requestPlayEntry(instance.database, request, proof, second)).rejects.toMatchObject(
      { code: 'conflict' }
    );
    expect(await instance.database.playJoinRequest.count()).toBe(0);
    await requestPlayEntry(instance.database, request, proof, first);
    await expect(requestPlayEntry(instance.database, request, proof, second)).rejects.toMatchObject(
      { code: 'conflict' }
    );
    expect(
      await instance.database.playJoinRequest.findUniqueOrThrow({
        where: { id: request.requestId },
      })
    ).toMatchObject({ candidateUserId: first.identity.userId });
  });

  it('allows explicit new browser enrollment with an unselected cookie and fences selected-profile intake and replay', async () => {
    const { owner, invitation } = await roomFixture();
    const proof = newToken();
    const request = { ...newRequest(invitation.code), client: 'BROWSER' };
    const selected = { request: owner.request, expectedProfileId: null };
    await expect(
      requestPlayEntry(instance.database, request, proof, null, undefined, selected)
    ).rejects.toMatchObject({ code: 'conflict' });
    const unselectedToken = await authority.access.enterHousehold(
      'owner password for integration tests'
    );
    const unselected = {
      request: new Request('http://localhost', {
        headers: { cookie: `sotto_session=${unselectedToken}` },
      }),
      expectedProfileId: null,
    };
    await requestPlayEntry(instance.database, request, proof, null, undefined, unselected);
    await expect(
      requestPlayEntry(instance.database, request, proof, null, undefined, selected)
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await instance.database.user.count()).toBe(1);
    expect(
      await instance.database.playJoinRequest.findUniqueOrThrow({
        where: { id: request.requestId },
      })
    ).toMatchObject({ candidateUserId: null, provisionedUserId: null });
  });

  it('separates server-owner enrollment from a different game host accepting entry', async () => {
    const { owner, host, room, invitation, viewNonce } = await roomFixture(false);
    const command = newRequest(invitation.code),
      proof = newToken();
    await requestPlayEntry(instance.database, command, proof, null);
    await expect(
      approvePlayEntry(host, command.requestId, {
        actionId: randomUUID(),
        expectedRevision: room.revision,
        type: 'APPROVE_PROFILE',
      })
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await instance.database.user.count()).toBe(2);
    await updatePlayPresence(host, room.id, { type: 'RELEASE', viewNonce });
    const approved = await approvePlayEntry(owner, command.requestId, {
      actionId: randomUUID(),
      expectedRevision: room.revision,
      type: 'APPROVE_PROFILE',
    });
    expect(approved).toMatchObject({ status: 'HOST_UNAVAILABLE', allowedActions: ['DECLINE'] });
    expect(approved.profileId).not.toBeNull();
    expect(await instance.database.user.count()).toBe(3);
    const enrolled = (await authority.access.store.read()).principals.find(
      (principal) => principal.id === approved.profileId
    );
    expect(enrolled).toMatchObject({ role: 'member', passwordHash: null });
    await expect(
      approvePlayEntry(owner, command.requestId, {
        actionId: randomUUID(),
        expectedRevision: approved.roomRevision,
        type: 'ACCEPT',
      })
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      approvePlayEntry(host, command.requestId, {
        actionId: randomUUID(),
        expectedRevision: approved.roomRevision,
        type: 'ACCEPT',
      })
    ).rejects.toMatchObject({ code: 'forbidden' });
    await updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce: newToken() });
    const accepted = await approvePlayEntry(host, command.requestId, {
      actionId: randomUUID(),
      expectedRevision: approved.roomRevision,
      type: 'ACCEPT',
    });
    expect(accepted.status).toBe('ACCEPTED');
    expect(
      (await instance.database.playRoom.findUniqueOrThrow({ where: { id: room.id } })).guestUserId
    ).toBeNull();
  });

  it('combines owner-host approval while requiring a fresh presence snapshot before claim', async () => {
    const { host, room, invitation, viewNonce } = await roomFixture();
    const command = newRequest(invitation.code),
      proof = newToken();
    await requestPlayEntry(instance.database, command, proof, null);
    const action = {
      actionId: randomUUID(),
      expectedRevision: room.revision,
      type: 'APPROVE_PROFILE',
    };
    const approved = await approvePlayEntry(host, command.requestId, action);
    expect(await approvePlayEntry(host, command.requestId, action)).toEqual(approved);
    const record = await instance.database.playJoinRequest.findUniqueOrThrow({
      where: { id: command.requestId },
    });
    expect(record).toMatchObject({ status: 'ACCEPTED', approvedByUserId: authority.ownerId });
    expect(record.plannedProfileId).toBe(record.provisionedUserId);
    expect(await readPlayEntryStatus(instance.database, command.requestId, proof)).toMatchObject({
      status: 'HOST_UNAVAILABLE',
    });
    await updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce });
    expect(await readPlayEntryStatus(instance.database, command.requestId, proof)).toMatchObject({
      status: 'ACCEPTED',
    });
    expect(await instance.database.apiKey.count()).toBe(0);
  });

  it('does not create a profile when the owner-host has left the waiting view', async () => {
    const { host, room, invitation, viewNonce } = await roomFixture();
    const request = newRequest(invitation.code);
    await requestPlayEntry(instance.database, request, newToken(), null);
    await updatePlayPresence(host, room.id, { type: 'RELEASE', viewNonce });
    await expect(
      approvePlayEntry(host, request.requestId, {
        actionId: randomUUID(),
        expectedRevision: room.revision,
        type: 'APPROVE_PROFILE',
      })
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await instance.database.user.count()).toBe(1);
  });

  it('creates exactly one profile under concurrent owner approvals with different action IDs', async () => {
    const { owner, room, invitation } = await roomFixture(false);
    const request = newRequest(invitation.code);
    await requestPlayEntry(instance.database, request, newToken(), null);
    const results = await Promise.all([
      approvePlayEntry(owner, request.requestId, {
        actionId: randomUUID(),
        expectedRevision: room.revision,
        type: 'APPROVE_PROFILE',
      }),
      approvePlayEntry(owner, request.requestId, {
        actionId: randomUUID(),
        expectedRevision: room.revision,
        type: 'APPROVE_PROFILE',
      }),
    ]);
    expect(results[0]?.profileId).toBe(results[1]?.profileId);
    expect(await instance.database.user.count()).toBe(3);
    expect((await authority.access.store.read()).principals).toHaveLength(3);
    expect(
      await instance.database.playActionReceipt.count({ where: { operation: 'APPROVE' } })
    ).toBe(2);
  });

  it('rolls back canonical learner creation when the approval record cannot commit', async () => {
    const { host, room, invitation } = await roomFixture();
    const request = newRequest(invitation.code);
    await requestPlayEntry(instance.database, request, newToken(), null);
    const before = await authority.access.store.read();
    await instance.database.$executeRawUnsafe(
      `CREATE FUNCTION "${instance.schema}".reject_play_approval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."provisionedUserId" IS NOT NULL THEN RAISE EXCEPTION 'fixture approval write failure'; END IF; RETURN NEW; END $$`
    );
    await instance.database.$executeRawUnsafe(
      `CREATE TRIGGER reject_play_approval BEFORE UPDATE ON "${instance.schema}"."PlayJoinRequest" FOR EACH ROW EXECUTE FUNCTION "${instance.schema}".reject_play_approval()`
    );
    try {
      await expect(
        approvePlayEntry(host, request.requestId, {
          actionId: randomUUID(),
          expectedRevision: room.revision,
          type: 'APPROVE_PROFILE',
        })
      ).rejects.toThrow(/fixture approval write failure/);
      expect(await instance.database.user.count()).toBe(1);
      expect(await authority.access.store.read()).toEqual(before);
      expect(
        (await instance.database.playRoom.findUniqueOrThrow({ where: { id: room.id } })).revision
      ).toBe(room.revision);
      expect(
        (
          await instance.database.playJoinRequest.findUniqueOrThrow({
            where: { id: request.requestId },
          })
        ).provisionedUserId
      ).toBeNull();
    } finally {
      await instance.database.$executeRawUnsafe(
        `DROP TRIGGER reject_play_approval ON "${instance.schema}"."PlayJoinRequest"`
      );
      await instance.database.$executeRawUnsafe(
        `DROP FUNCTION "${instance.schema}".reject_play_approval()`
      );
    }
  });

  it('rejects an owner whose credential was revoked before approval', async () => {
    const { host, room, invitation } = await roomFixture();
    const request = newRequest(invitation.code);
    await requestPlayEntry(instance.database, request, newToken(), null);
    await authority.access.logout(authority.ownerToken);
    await expect(
      approvePlayEntry(host, request.requestId, {
        actionId: randomUUID(),
        expectedRevision: room.revision,
        type: 'APPROVE_PROFILE',
      })
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(await instance.database.user.count()).toBe(1);
  });

  it('reserves only one entrant when the host accepts competing existing players concurrently', async () => {
    const { host, room, invitation, viewNonce } = await roomFixture();
    const candidates = [];
    for (const name of ['First guest', 'Second guest']) {
      const guest = await actor((await authority.household(name)).token);
      const command = {
        ...newRequest(invitation.code),
        candidate: {
          kind: 'EXISTING',
          expectedProfileId: guest.identity.userId,
          settings,
        },
      };
      await requestPlayEntry(instance.database, command, newToken(), guest);
      candidates.push(command);
    }
    await updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce });
    const results = await Promise.allSettled(
      candidates.map((candidate) =>
        approvePlayEntry(host, candidate.requestId, {
          actionId: randomUUID(),
          expectedRevision: room.revision,
          type: 'ACCEPT',
        })
      )
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const stored = await instance.database.playJoinRequest.findMany({ where: { roomId: room.id } });
    expect(stored.filter((request) => request.status === 'ACCEPTED')).toHaveLength(1);
    expect(stored.filter((request) => request.status === 'REVOKED')).toHaveLength(1);
    expect(await instance.database.user.count()).toBe(3);
  });

  it.each(['BROWSER', 'NATIVE'] as const)(
    'binds %s approval to the canonical owner principal',
    async (client) => {
      const selected = await authority.household('Selected learner');
      await authority.access.store.transact((state) => {
        const profile = state.householdProfiles?.find((entry) => entry.id === selected.id);
        if (!profile) throw new Error('Fixture selected profile missing');
        profile.ownerPrincipalId = authority.ownerId;
      });
      const ownerSession = await actor(selected.token);
      expect(ownerSession.identity).toMatchObject({ userId: selected.id, isOwner: true });
      let host = ownerSession;
      if (client === 'NATIVE') {
        const pair = await sottoTransaction(instance.database, async (database) => {
          const invitation = await issueSottoPairing(database, selected.token, 'Owner phone', {
            scopes: ['app', 'owner'],
          });
          return redeemSottoPairing(database, invitation.token);
        });
        const request = new Request('http://localhost/api/v1/play', {
          headers: { authorization: `Bearer ${pair.token}` },
        });
        const identity = await sottoTransaction(instance.database, (database) =>
          resolveSottoRequest(database, request)
        );
        if (identity?.kind !== 'content') throw new Error('Fixture native owner missing');
        host = { database: instance.database, request, identity };
        expect(host.identity).toMatchObject({ userId: authority.ownerId, isOwner: true });
      }
      const room = await createStoredPlayRoom(host, {
        actionId: randomUUID(),
        kind: 'MIXED',
        theme: 'FOOD',
        settings,
      });
      await updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce: newToken() });
      const invitation = await rotatePlayInvitation(host, room.id, {
        actionId: randomUUID(),
        expectedRevision: 0,
      });
      const request = newRequest(invitation.code);
      await requestPlayEntry(instance.database, request, newToken(), null);
      const approved = await approvePlayEntry(host, request.requestId, {
        actionId: randomUUID(),
        expectedRevision: 1,
        type: 'APPROVE_PROFILE',
      });
      expect(approved.profileId).not.toBe(selected.id);
      expect(
        await instance.database.playJoinRequest.findUniqueOrThrow({
          where: { id: request.requestId },
        })
      ).toMatchObject({
        status: 'ACCEPTED',
        approvedByUserId: authority.ownerId,
        provisionedUserId: approved.profileId,
      });
    }
  );
});
