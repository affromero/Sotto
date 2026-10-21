// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { newToken } from 'thesidedoor-core/access';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { approvePlayEntry } from '@/lib/play/admission/approvals';
import { claimPlayEntry } from '@/lib/play/admission/claims';
import {
  rotatePlayInvitation,
  readPlayInvitation,
  previewPlayInvitation,
} from '@/lib/play/admission/invitations';
import {
  acceptPendingPlayConduct,
  readPlayEntryStatus,
  requestPlayEntry,
} from '@/lib/play/admission/requests';
import { updatePlayPresence } from '@/lib/play/admission/presence';
import { listPendingPlayRequests } from '@/lib/play/admission/lists';
import { acceptPlayConduct, blockPlayPartner, readPlaySafety } from '@/lib/play/safety/preferences';
import { createStoredPlayRoom, readStoredPlayRoom } from '@/lib/play/storage/rooms';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { acceptedPlayTestIdentity, playTestActor } from '../../../helpers/play-fixture';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const settings = { nativeLang: 'en', targetLang: 'de', level: 'A1' } as const;
suite('consented private admission and encrypted recovery with PostgreSQL', () => {
  let instance: SharedTestInstance, authority: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('play_safety_admission');
  });
  beforeEach(async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'isolated-play-safety-admission-key');
    authority = await acceptedPlayTestIdentity(instance, await instance.reset());
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => instance?.close());

  async function waiting() {
    const host = await playTestActor(instance, authority.ownerToken);
    const room = await createStoredPlayRoom(host, {
      actionId: randomUUID(),
      kind: 'MIXED',
      theme: 'EVERYDAY',
      settings,
    });
    const viewNonce = newToken();
    const beat = () => updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce });
    await beat();
    const invitation = await rotatePlayInvitation(host, room.id, {
      actionId: randomUUID(),
      expectedRevision: room.revision,
    });
    return { host, room, beat, invitation };
  }
  async function joined(client: 'NATIVE' | 'BROWSER' = 'NATIVE') {
    const fixture = await waiting();
    const command = {
      requestId: randomUUID(),
      code: fixture.invitation.code,
      client,
      deviceName: 'Partner phone',
      acceptedConductVersion: 1,
      candidate: { kind: 'NEW', name: 'New partner', settings, consentToProfile: true },
    };
    const proof = newToken();
    const context = {
      request: new Request('http://localhost/api/v1/play'),
      expectedProfileId: null,
    };
    await requestPlayEntry(
      instance.database,
      command,
      proof,
      null,
      undefined,
      client === 'BROWSER' ? context : undefined
    );
    const approve = async () => {
      const room = await readStoredPlayRoom(fixture.host, fixture.room.id);
      return approvePlayEntry(fixture.host, command.requestId, {
        actionId: randomUUID(),
        type: 'APPROVE_PROFILE',
        expectedRevision: room.revision,
      });
    };
    return { ...fixture, command, proof, context, approve };
  }

  it('requires explicit current consent before uploading a name or device label', async () => {
    const fixture = await waiting();
    const body = {
      requestId: randomUUID(),
      code: fixture.invitation.code,
      client: 'NATIVE',
      deviceName: 'Phone',
      candidate: { kind: 'NEW', name: 'A', settings, consentToProfile: true },
    };
    const before = await instance.database.user.count();
    await expect(requestPlayEntry(instance.database, body, newToken(), null)).rejects.toThrow();
    expect(await instance.database.playJoinRequest.count()).toBe(0);
    for (const command of [
      { ...body, acceptedConductVersion: 1, candidate: { ...body.candidate, name: 'sh1t' } },
      { ...body, acceptedConductVersion: 1, deviceName: 'f.u.c.k' },
    ])
      await expect(
        requestPlayEntry(instance.database, command, newToken(), null)
      ).rejects.toMatchObject({ reason: 'TEXT_FILTERED' });
    expect(await instance.database.playJoinRequest.count()).toBe(0);
    expect(await instance.database.user.count()).toBe(before);
    await requestPlayEntry(
      instance.database,
      { ...body, acceptedConductVersion: 1 },
      newToken(),
      null
    );
    expect(await instance.database.playJoinRequest.count()).toBe(1);
  });

  it('lets a known legacy request explicitly consent while waiting for owner without changing proof or immutable input', async () => {
    const fixture = await joined();
    await instance.database.playJoinRequest.update({
      where: { id: fixture.command.requestId },
      data: { acceptedConductVersion: null, acceptedConductAt: null },
    });
    const before = await instance.database.playJoinRequest.findUniqueOrThrow({
      where: { id: fixture.command.requestId },
    });
    expect((await readPlayEntryStatus(instance.database, before.id, fixture.proof)).status).toBe(
      'WAITING_FOR_OWNER'
    );
    await expect(fixture.approve()).rejects.toMatchObject({ reason: 'CONDUCT_REQUIRED' });
    const count = await instance.database.user.count();
    await expect(
      acceptPendingPlayConduct(instance.database, before.id, newToken(), { version: 1 }, null)
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      acceptPendingPlayConduct(instance.database, randomUUID(), fixture.proof, { version: 1 }, null)
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(
      await acceptPendingPlayConduct(
        instance.database,
        before.id,
        fixture.proof,
        { version: 1 },
        null
      )
    ).toEqual({ requestId: before.id, version: 1 });
    expect(await instance.database.user.count()).toBe(count);
    const after = await instance.database.playJoinRequest.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after).toMatchObject({
      fingerprint: before.fingerprint,
      proofHash: before.proofHash,
      proposedName: before.proposedName,
      provisionedUserId: null,
    });
    await fixture.approve();
    const approved = await instance.database.playJoinRequest.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(
      await instance.database.playSafetyState.findUnique({
        where: { userId: approved.provisionedUserId! },
      })
    ).toMatchObject({ conductVersion: 1, acceptedAt: after.acceptedConductAt });
  });

  it.each(['NATIVE', 'BROWSER'] as const)(
    'records explicit conduct for an already-issued legacy %s delivery without altering the secret',
    async (client) => {
      const fixture = await joined(client);
      await fixture.approve();
      await fixture.beat();
      const delivery = await claimPlayEntry(
        instance.database,
        fixture.command.requestId,
        fixture.proof,
        null,
        undefined,
        client === 'BROWSER' ? fixture.context : undefined
      );
      const candidate = await instance.database.playJoinRequest.findUniqueOrThrow({
        where: { id: fixture.command.requestId },
      });
      await instance.database.$transaction([
        instance.database.playJoinRequest.update({
          where: { id: candidate.id },
          data: { acceptedConductVersion: null, acceptedConductAt: null },
        }),
        instance.database.playSafetyState.update({
          where: { userId: candidate.provisionedUserId! },
          data: { conductVersion: null, acceptedAt: null },
        }),
      ]);
      await expect(
        claimPlayEntry(
          instance.database,
          candidate.id,
          fixture.proof,
          null,
          undefined,
          client === 'BROWSER' ? fixture.context : undefined
        )
      ).rejects.toMatchObject({ reason: 'CONDUCT_REQUIRED' });
      const body = client === 'BROWSER' ? { version: 1, expectedProfileId: null } : { version: 1 };
      await acceptPendingPlayConduct(
        instance.database,
        candidate.id,
        fixture.proof,
        body,
        null,
        undefined,
        client === 'BROWSER' ? fixture.context : undefined
      );
      expect(
        await claimPlayEntry(
          instance.database,
          candidate.id,
          fixture.proof,
          null,
          undefined,
          client === 'BROWSER' ? fixture.context : undefined
        )
      ).toEqual(delivery);
      const after = await instance.database.playJoinRequest.findUniqueOrThrow({
        where: { id: candidate.id },
      });
      expect(after.deliveryState).toEqual(candidate.deliveryState);
      expect(after.deliveryId).toBe(candidate.deliveryId);
      expect(after.fingerprint).toBe(candidate.fingerprint);
    }
  );

  it('fences pending browser consent against an unobserved selected profile, including null', async () => {
    const fixture = await joined('BROWSER');
    const selected = await authority.household('Selected learner');
    const selectedActor = await playTestActor(instance, selected.token);
    await instance.database.playSafetyState.update({
      where: { userId: selected.id },
      data: { conductVersion: null, acceptedAt: null },
    });
    await expect(
      acceptPendingPlayConduct(
        instance.database,
        fixture.command.requestId,
        fixture.proof,
        { version: 1 },
        null,
        undefined,
        fixture.context
      )
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      acceptPendingPlayConduct(
        instance.database,
        fixture.command.requestId,
        fixture.proof,
        { version: 1, expectedProfileId: null },
        null,
        undefined,
        { request: selectedActor.request, expectedProfileId: null }
      )
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(
      await acceptPendingPlayConduct(
        instance.database,
        fixture.command.requestId,
        fixture.proof,
        { version: 1, expectedProfileId: selected.id },
        null,
        undefined,
        { request: selectedActor.request, expectedProfileId: selected.id }
      )
    ).toEqual({ requestId: fixture.command.requestId, version: 1 });
    expect(await readPlaySafety(selectedActor)).toMatchObject({
      profileId: selected.id,
      acceptedVersion: null,
    });
    expect(
      (
        await instance.database.playJoinRequest.findUniqueOrThrow({
          where: { id: fixture.command.requestId },
        })
      ).provisionedUserId
    ).toBeNull();
  });

  it('requires the original existing actor on legacy consent and claim recovery', async () => {
    const fixture = await waiting();
    const member = await authority.household('Existing partner');
    const guest = await playTestActor(instance, member.token);
    const requestId = randomUUID(),
      proof = newToken();
    await requestPlayEntry(
      instance.database,
      {
        requestId,
        code: fixture.invitation.code,
        client: 'NATIVE',
        deviceName: 'Phone',
        acceptedConductVersion: 1,
        candidate: { kind: 'EXISTING', expectedProfileId: member.id, settings },
      },
      proof,
      guest
    );
    await fixture.beat();
    await approvePlayEntry(fixture.host, requestId, {
      actionId: randomUUID(),
      expectedRevision: 1,
      type: 'ACCEPT',
    });
    const delivery = await claimPlayEntry(instance.database, requestId, proof, guest);
    await instance.database.playJoinRequest.update({
      where: { id: requestId },
      data: { acceptedConductVersion: null, acceptedConductAt: null },
    });
    await expect(
      acceptPendingPlayConduct(instance.database, requestId, proof, { version: 1 }, fixture.host)
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      acceptPendingPlayConduct(instance.database, requestId, proof, { version: 1 }, null)
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await acceptPendingPlayConduct(instance.database, requestId, proof, { version: 1 }, guest);
    expect(await claimPlayEntry(instance.database, requestId, proof, guest)).toEqual(delivery);
  });

  it('records explicit fresh existing intake consent atomically without a redundant acceptance request', async () => {
    const fixture = await waiting();
    const member = await authority.household('Existing partner');
    const guest = await playTestActor(instance, member.token);
    await instance.database.playSafetyState.update({
      where: { userId: member.id },
      data: { conductVersion: null, acceptedAt: null },
    });
    const command = {
      requestId: randomUUID(),
      code: fixture.invitation.code,
      client: 'NATIVE',
      deviceName: 'Phone',
      acceptedConductVersion: 1,
      candidate: { kind: 'EXISTING', expectedProfileId: member.id, settings },
    };
    const proof = newToken();
    const { acceptedConductVersion, ...legacy } = command;
    expect(acceptedConductVersion).toBe(1);
    await expect(requestPlayEntry(instance.database, legacy, proof, guest)).rejects.toThrow();
    await expect(
      requestPlayEntry(instance.database, { ...command, acceptedConductVersion: 0 }, proof, guest)
    ).rejects.toThrow();
    expect((await readPlaySafety(guest)).acceptedVersion).toBeNull();
    await instance.database.playSafetyState.update({
      where: { userId: fixture.host.identity.userId },
      data: { conductVersion: null, acceptedAt: null },
    });
    await expect(requestPlayEntry(instance.database, command, proof, guest)).rejects.toMatchObject({
      reason: 'CONDUCT_REQUIRED',
    });
    expect((await readPlaySafety(guest)).acceptedVersion).toBeNull();
    await acceptPlayConduct(fixture.host, { actionId: randomUUID(), version: 1 });
    await fixture.beat();
    expect(await requestPlayEntry(instance.database, command, proof, guest)).toMatchObject({
      status: 'WAITING_FOR_HOST',
    });
    const state = await readPlaySafety(guest);
    expect(state).toMatchObject({ acceptedVersion: 1, acceptedAt: expect.any(String) });
    expect(await requestPlayEntry(instance.database, command, proof, guest)).toMatchObject({
      status: 'WAITING_FOR_HOST',
    });
    expect((await readPlaySafety(guest)).acceptedAt).toBe(state.acceptedAt);
    expect(await instance.database.user.count()).toBe(2);
    await instance.database.playSafetyState.update({
      where: { userId: member.id },
      data: { conductVersion: null, acceptedAt: null, sharingRestrictedAt: new Date() },
    });
    await expect(
      requestPlayEntry(
        instance.database,
        { ...command, requestId: randomUUID() },
        newToken(),
        guest
      )
    ).rejects.toMatchObject({ reason: 'PLAY_UNAVAILABLE' });
    expect((await readPlaySafety(guest)).acceptedVersion).toBeNull();
  });

  it('refuses encrypted recovery and consent after a persistent block without revoking the delivered learner credential', async () => {
    const fixture = await joined();
    await fixture.approve();
    await fixture.beat();
    const delivered = await claimPlayEntry(
      instance.database,
      fixture.command.requestId,
      fixture.proof,
      null
    );
    if (delivered.delivery.kind !== 'NATIVE') throw new Error('Fixture requires native delivery');
    await blockPlayPartner(fixture.host, fixture.room.id, { actionId: randomUUID() });
    await expect(
      claimPlayEntry(instance.database, fixture.command.requestId, fixture.proof, null)
    ).rejects.toMatchObject({ reason: 'PLAY_UNAVAILABLE' });
    await expect(
      acceptPendingPlayConduct(
        instance.database,
        fixture.command.requestId,
        fixture.proof,
        { version: 1 },
        null
      )
    ).rejects.toMatchObject({ reason: 'PLAY_UNAVAILABLE' });
    expect(
      (await readPlayEntryStatus(instance.database, fixture.command.requestId, fixture.proof))
        .status
    ).toBe('REVOKED');
    expect(await listPendingPlayRequests(fixture.host, fixture.room.id)).toEqual({ requests: [] });
    expect(
      (
        await instance.database.playJoinRequest.findUniqueOrThrow({
          where: { id: fixture.command.requestId },
        })
      ).deliveryState
    ).toBeNull();
    expect(await instance.database.user.count()).toBe(2);
    const credential = new Request('http://localhost/api/v1/play/safety', {
      headers: { authorization: `Bearer ${delivered.delivery.token}` },
    });
    expect(
      await sottoTransaction(instance.database, (database) =>
        resolveSottoRequest(database, credential)
      )
    ).toMatchObject({ userId: delivered.delivery.profile.id });
  });

  it('rejects a known blocked pending candidate while leaving the empty host room available for others', async () => {
    const fixture = await waiting();
    const member = await authority.household('Blocked partner');
    const guest = await playTestActor(instance, member.token);
    const prior = await createStoredPlayRoom(fixture.host, {
      actionId: randomUUID(),
      kind: 'MIXED',
      theme: 'EVERYDAY',
      settings,
    });
    await instance.database.playRoom.update({
      where: { id: prior.id },
      data: { guestUserId: member.id, guestSettings: settings },
    });
    const command = {
      requestId: randomUUID(),
      code: fixture.invitation.code,
      client: 'NATIVE',
      deviceName: 'Phone',
      acceptedConductVersion: 1,
      candidate: { kind: 'EXISTING', expectedProfileId: member.id, settings },
    };
    const proof = newToken();
    await requestPlayEntry(instance.database, command, proof, guest);
    await blockPlayPartner(fixture.host, prior.id, { actionId: randomUUID() });
    await expect(requestPlayEntry(instance.database, command, proof, guest)).rejects.toMatchObject({
      reason: 'PLAY_UNAVAILABLE',
    });
    expect((await readPlayEntryStatus(instance.database, command.requestId, proof)).status).toBe(
      'REVOKED'
    );
    expect((await readStoredPlayRoom(fixture.host, fixture.room.id)).status).toBe('WAITING');
    expect(await readPlayInvitation(fixture.host, fixture.room.id)).toEqual(fixture.invitation);
    expect(await previewPlayInvitation(instance.database, fixture.invitation.code)).toMatchObject({
      roomId: fixture.room.id,
    });
  });
});
