// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { AccessService, newToken, tokenHash } from 'thesidedoor-core/access';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAY_HOST_LEASE_MS } from '@sotto/shared';
import { expirePlayAdmissions } from '@/lib/play/storage/maintenance';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import {
  openPlayDelivery,
  sealPlayDelivery,
  type PlayDeliveryBinding,
} from '@/lib/play/admission/delivery-receipt';
import { sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { approvePlayEntry } from '@/lib/play/admission/approvals';
import { claimPlayEntry, acknowledgePlayDelivery } from '@/lib/play/admission/claims';
import { rotatePlayInvitation } from '@/lib/play/admission/invitations';
import { requestPlayEntry } from '@/lib/play/admission/requests';
import { updatePlayPresence } from '@/lib/play/admission/presence';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { createSottoProfile, prepareSottoProfile } from '@/lib/sidedoor/access/core/profiles';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { sottoDeviceService } from '@/lib/sidedoor/access/state/device-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  actOnStoredPlayRoom,
  createStoredPlayRoom,
  readStoredPlayRoom,
} from '@/lib/play/storage/rooms';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const settings = { nativeLang: 'es', targetLang: 'de', level: 'A1' } as const;

suite('atomic guest credentials and exact delivery recovery', () => {
  let instance: SharedTestInstance, authority: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('play_claims');
  });
  beforeEach(async () => {
    authority = await instance.reset();
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => instance?.close());

  async function actor(headers: HeadersInit) {
    const request = new Request('http://localhost/api/v1/play', { headers });
    const identity = await sottoTransaction(instance.database, (database) =>
      resolveSottoRequest(database, request)
    );
    if (identity?.kind !== 'content') throw new Error('Fixture requires admitted content identity');
    return { database: instance.database, request, identity };
  }

  async function waitingHost() {
    const host = await actor({ cookie: `sotto_session=${authority.ownerToken}` });
    const room = await createStoredPlayRoom(host, {
      actionId: randomUUID(),
      kind: 'MIXED',
      theme: 'FOOD',
      settings,
    });
    const viewNonce = newToken();
    await updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce });
    const invite = await rotatePlayInvitation(host, room.id, {
      actionId: randomUUID(),
      expectedRevision: 0,
    });
    return { host, room, invite, viewNonce };
  }

  async function approved(client: 'NATIVE' | 'BROWSER' = 'NATIVE') {
    const fixture = await waitingHost();
    const requestId = randomUUID(),
      proof = newToken();
    await requestPlayEntry(
      instance.database,
      {
        requestId,
        code: fixture.invite.code,
        client,
        deviceName: 'Guest device',
        candidate: { kind: 'NEW', name: 'Partner', settings, consentToProfile: true },
      },
      proof,
      null
    );
    const approval = await approvePlayEntry(fixture.host, requestId, {
      actionId: randomUUID(),
      expectedRevision: 1,
      type: 'APPROVE_PROFILE',
    });
    return { ...fixture, requestId, proof, approval };
  }

  async function renewed(client: 'NATIVE' | 'BROWSER' = 'NATIVE') {
    const fixture = await approved(client);
    await updatePlayPresence(fixture.host, fixture.room.id, {
      type: 'RENEW',
      viewNonce: fixture.viewNonce,
    });
    return fixture;
  }

  // Fault injection stays at the database boundary and rolls the real first transaction back.
  function retryingDatabase(onRetry: () => void): PrismaClient {
    let interrupt = true;
    return new Proxy(instance.database, {
      get(target, property) {
        if (property !== '$transaction') {
          const value = target[property as keyof PrismaClient];
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return <Result>(
          operation: (database: Prisma.TransactionClient) => Promise<Result>,
          options?: {
            isolationLevel?: Prisma.TransactionIsolationLevel;
            timeout?: number;
            maxWait?: number;
          }
        ) =>
          instance.database.$transaction(async (database) => {
            const result = await operation(database);
            if (interrupt) {
              interrupt = false;
              onRetry();
              await database.$executeRawUnsafe(
                "DO $$ BEGIN RAISE EXCEPTION 'fixture serialization conflict' USING ERRCODE = '40001'; END $$"
              );
            }
            return result;
          }, options);
      },
    });
  }

  it('requires the live host again after owner approval changes canonical access', async () => {
    const fixture = await approved();
    await expect(
      claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null)
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await instance.database.apiKey.count()).toBe(0);
    expect(
      (await instance.database.playRoom.findUniqueOrThrow({ where: { id: fixture.room.id } }))
        .guestUserId
    ).toBeNull();
    await updatePlayPresence(fixture.host, fixture.room.id, {
      type: 'RENEW',
      viewNonce: fixture.viewNonce,
    });
    expect(
      (await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null)).delivery
        .kind
    ).toBe('NATIVE');
  });

  it('issues one app-only principal device and prevents selecting another profile or creating a learner', async () => {
    const fixture = await renewed();
    const result = await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null);
    if (result.delivery.kind !== 'NATIVE') throw new Error('Fixture requires native delivery');
    const delivery = result.delivery;
    expect(result.browserSessionToken).toBeNull();
    expect(delivery.profile.id).toBe(fixture.approval.profileId);
    const guest = await actor({ authorization: `Bearer ${delivery.token}` });
    expect(guest.identity).toMatchObject({
      userId: delivery.profile.id,
      principalId: delivery.profile.id,
      isOwner: false,
    });
    expect((await readStoredPlayRoom(guest, fixture.room.id)).ownSeat).toBe('GUEST');
    const state = await authority.access.store.read();
    expect(state.sessions.filter((session) => session.principalId === delivery.profile.id)).toEqual(
      []
    );
    expect(
      state.deviceTokens.find((device) => device.id === tokenHash(delivery.token))
    ).toMatchObject({ principalId: delivery.profile.id, scopes: ['app'] });
    expect(
      state.deviceTokens.find((device) => device.id === tokenHash(delivery.token))?.defaultProfileId
    ).toBeUndefined();
    const headers = new Headers(guest.request.headers);
    headers.set('x-sotto-profile-id', authority.ownerId);
    expect(
      await sottoTransaction(instance.database, (database) =>
        resolveSottoRequest(database, new Request(guest.request.url, { headers }))
      )
    ).toBeNull();
    const prepared = prepareSottoProfile('Unauthorized learner');
    await expect(
      sottoTransaction(instance.database, (database) =>
        createSottoProfile(database, guest.request, prepared, null)
      )
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await instance.database.user.count()).toBe(2);
    expect(await instance.database.apiKey.count()).toBe(1);
  });

  it.each(['NATIVE', 'BROWSER'] as const)(
    'recovers the exact %s credential after START and the waiting lease expires',
    async (client) => {
      const fixture = await renewed(client);
      const first = await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null);
      const room = await readStoredPlayRoom(fixture.host, fixture.room.id);
      await actOnStoredPlayRoom(fixture.host, room.id, {
        actionId: randomUUID(),
        expectedRevision: room.revision,
        type: 'START',
      });
      const recovered = await claimPlayEntry(
        instance.database,
        fixture.requestId,
        fixture.proof,
        null,
        () => new Date(Date.now() + PLAY_HOST_LEASE_MS + 1)
      );
      expect(recovered).toEqual(first);
      expect(await instance.database.user.count()).toBe(2);
      expect(await instance.database.apiKey.count()).toBe(client === 'NATIVE' ? 1 : 0);
      if (client === 'BROWSER') {
        expect(first.browserSessionToken).not.toBeNull();
        expect(JSON.stringify(first.delivery)).not.toContain(first.browserSessionToken!);
        expect(
          (await actor({ cookie: `sotto_session=${first.browserSessionToken}` })).identity
        ).toMatchObject({
          userId: first.delivery.profile.id,
          principalId: first.delivery.profile.id,
          isOwner: false,
        });
      }
      const stored = await instance.database.playJoinRequest.findUniqueOrThrow({
        where: { id: fixture.requestId },
      });
      if (first.delivery.kind === 'NATIVE')
        expect(JSON.stringify(stored)).not.toContain(first.delivery.token);
      if (first.browserSessionToken)
        expect(JSON.stringify(stored)).not.toContain(first.browserSessionToken);
    }
  );

  it('coalesces concurrent native claims without issuing another device or temporary session', async () => {
    const fixture = await renewed();
    const [first, second] = await Promise.all([
      claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null),
      claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null),
    ]);
    expect(first).toEqual(second);
    expect(await instance.database.apiKey.count()).toBe(1);
    const state = await authority.access.store.read();
    expect(
      state.deviceTokens.filter((device) => device.principalId === first.delivery.profile.id)
    ).toHaveLength(1);
    expect(
      state.sessions.filter((session) => session.principalId === first.delivery.profile.id)
    ).toEqual([]);
  });

  it('rechecks the host deadline after a real transaction rollback and retry', async () => {
    const fixture = await renewed();
    let current = new Date();
    const expired = new Date(current.getTime() + PLAY_HOST_LEASE_MS + 1);
    const database = retryingDatabase(() => {
      current = expired;
    });
    await expect(
      claimPlayEntry(database, fixture.requestId, fixture.proof, null, () => current)
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await instance.database.apiKey.count()).toBe(0);
    expect(
      (await instance.database.playRoom.findUniqueOrThrow({ where: { id: fixture.room.id } }))
        .guestUserId
    ).toBeNull();
    expect((await authority.access.store.read()).deviceTokens).toEqual([]);
  });

  it('rechecks receipt expiry on a retried recovery and commits its erasure', async () => {
    const fixture = await renewed();
    await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null);
    const candidate = await instance.database.playJoinRequest.findUniqueOrThrow({
      where: { id: fixture.requestId },
    });
    if (!candidate.deliveryExpiresAt) throw new Error('Fixture requires receipt expiry');
    let current = new Date();
    const expired = new Date(candidate.deliveryExpiresAt.getTime() + 1);
    const database = retryingDatabase(() => {
      current = expired;
    });
    await expect(
      claimPlayEntry(database, fixture.requestId, fixture.proof, null, () => current)
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(
      (
        await instance.database.playJoinRequest.findUniqueOrThrow({
          where: { id: fixture.requestId },
        })
      ).deliveryState
    ).toBeNull();
    expect(await instance.database.apiKey.count()).toBe(1);
  });

  it('uses current canonical browser-session expiry after a recovery retry', async () => {
    const fixture = await renewed('BROWSER');
    const first = await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null);
    const candidate = await instance.database.playJoinRequest.findUniqueOrThrow({
      where: { id: fixture.requestId },
    });
    if (!candidate.provisionedUserId || !candidate.deliveryId || !first.browserSessionToken)
      throw new Error('Fixture requires browser delivery');
    const instanceId = (
      await sottoTransaction(instance.database, (database) => sottoStorageInstance(database).read())
    ).instanceId;
    const binding: PlayDeliveryBinding = {
      version: 1,
      instanceId,
      roomId: fixture.room.id,
      requestId: candidate.id,
      profileId: candidate.provisionedUserId,
      deliveryId: candidate.deliveryId,
      claimantProofHash: candidate.proofHash,
      enrollmentGeneration: candidate.enrollmentGeneration,
    };
    const envelope = openPlayDelivery(binding, candidate.deliveryState);
    let current = new Date();
    const hardExpiry = current.getTime() + 5_000;
    await authority.access.store.transact((state) => {
      const session = state.sessions.find((entry) => entry.id === envelope.credentialId);
      if (!session) throw new Error('Fixture browser session missing');
      session.expiresAt = hardExpiry;
    });
    envelope.response.expiresAt = new Date(hardExpiry).toISOString();
    await instance.database.playJoinRequest.update({
      where: { id: candidate.id },
      data: { deliveryState: sealPlayDelivery(binding, envelope) },
    });
    const database = retryingDatabase(() => {
      current = new Date(hardExpiry + 1);
    });
    await expect(
      claimPlayEntry(database, fixture.requestId, fixture.proof, null, () => current)
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(
      (await instance.database.playJoinRequest.findUniqueOrThrow({ where: { id: candidate.id } }))
        .deliveryState
    ).toBeNull();
  });

  it('does not erase a valid receipt for a wrong claimant or a temporarily missing encryption key', async () => {
    const fixture = await renewed();
    const first = await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null);
    await expect(
      claimPlayEntry(instance.database, fixture.requestId, newToken(), null)
    ).rejects.toMatchObject({ code: 'unauthorized' });
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '');
    await expect(
      claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null)
    ).rejects.toThrow();
    vi.unstubAllEnvs();
    expect(await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null)).toEqual(
      first
    );
    expect(await instance.database.apiKey.count()).toBe(1);
  });

  it('rolls initial credential issuance back when encrypted delivery cannot commit', async () => {
    const fixture = await renewed();
    const before = await authority.access.store.read();
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '');
    await expect(
      claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null)
    ).rejects.toThrow();
    expect(await authority.access.store.read()).toEqual(before);
    expect(await instance.database.apiKey.count()).toBe(0);
    expect(
      await instance.database.playRoom.findUniqueOrThrow({ where: { id: fixture.room.id } })
    ).toMatchObject({ guestUserId: null });
    expect(
      await instance.database.playJoinRequest.findUniqueOrThrow({
        where: { id: fixture.requestId },
      })
    ).toMatchObject({ status: 'ACCEPTED', deliveryState: null });
    vi.unstubAllEnvs();
    expect(
      (await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null)).delivery
        .kind
    ).toBe('NATIVE');
    expect(await instance.database.apiKey.count()).toBe(1);
  });

  it('serializes a claim against host foreground release and denies any later first admission', async () => {
    const fixture = await renewed();
    const [claim, release] = await Promise.allSettled([
      claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null),
      updatePlayPresence(fixture.host, fixture.room.id, {
        type: 'RELEASE',
        viewNonce: fixture.viewNonce,
      }),
    ]);
    expect(release.status).toBe('fulfilled');
    expect((await readStoredPlayRoom(fixture.host, fixture.room.id)).hostWaiting).toBe(false);
    const room = await instance.database.playRoom.findUniqueOrThrow({
      where: { id: fixture.room.id },
    });
    if (claim.status === 'fulfilled') {
      expect(room.guestUserId).toBe(claim.value.delivery.profile.id);
      expect(
        await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null)
      ).toEqual(claim.value);
      expect(await instance.database.apiKey.count()).toBe(1);
    } else {
      expect(room.guestUserId).toBeNull();
      expect(await instance.database.apiKey.count()).toBe(0);
      await expect(
        claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null)
      ).rejects.toMatchObject({ code: 'conflict' });
    }
  });

  it('revokes every retained delivery after cancellation races with a claim', async () => {
    const fixture = await renewed();
    const room = await readStoredPlayRoom(fixture.host, fixture.room.id);
    const [claim, cancel] = await Promise.allSettled([
      claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null),
      actOnStoredPlayRoom(fixture.host, room.id, {
        actionId: randomUUID(),
        expectedRevision: room.revision,
        type: 'CANCEL',
      }),
    ]);
    if (cancel.status === 'rejected') {
      expect(claim.status).toBe('fulfilled');
      const current = await readStoredPlayRoom(fixture.host, room.id);
      await actOnStoredPlayRoom(fixture.host, room.id, {
        actionId: randomUUID(),
        expectedRevision: current.revision,
        type: 'CANCEL',
      });
    }
    expect(
      await instance.database.playRoom.findUniqueOrThrow({ where: { id: room.id } })
    ).toMatchObject({ status: 'CANCELLED', invitationHash: null });
    expect(
      await instance.database.playJoinRequest.findUniqueOrThrow({
        where: { id: fixture.requestId },
      })
    ).toMatchObject({ status: 'REVOKED', deliveryState: null });
    await expect(
      claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null)
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('clears an acknowledged delivery, accepts ACK retry and never remints on claim retry', async () => {
    const fixture = await renewed();
    const first = await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null);
    if (first.delivery.kind === 'EXISTING') throw new Error('Fixture requires credential delivery');
    for (let retry = 0; retry < 2; retry++)
      expect(
        await acknowledgePlayDelivery(
          instance.database,
          fixture.requestId,
          fixture.proof,
          first.delivery.deliveryId
        )
      ).toEqual({ acknowledged: true });
    expect(
      (
        await instance.database.playJoinRequest.findUniqueOrThrow({
          where: { id: fixture.requestId },
        })
      ).deliveryState
    ).toBeNull();
    await expect(
      claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null)
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(await instance.database.apiKey.count()).toBe(1);
    expect(await instance.database.user.count()).toBe(2);
  });

  it('commits expired receipt erasure even though recovery returns an error', async () => {
    const fixture = await renewed();
    await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null);
    const stored = await instance.database.playJoinRequest.findUniqueOrThrow({
      where: { id: fixture.requestId },
    });
    if (!stored.deliveryExpiresAt) throw new Error('Fixture requires delivery expiry');
    await expect(
      claimPlayEntry(
        instance.database,
        fixture.requestId,
        fixture.proof,
        null,
        () => new Date(stored.deliveryExpiresAt!.getTime() + 1)
      )
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(
      (
        await instance.database.playJoinRequest.findUniqueOrThrow({
          where: { id: fixture.requestId },
        })
      ).deliveryState
    ).toBeNull();
    expect(await instance.database.apiKey.count()).toBe(1);
  });

  it('erases expired delivery secrets in maintenance while preserving the learner and credential', async () => {
    const fixture = await renewed();
    const first = await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null);
    if (first.delivery.kind !== 'NATIVE') throw new Error('Fixture requires native delivery');
    const candidate = await instance.database.playJoinRequest.findUniqueOrThrow({
      where: { id: fixture.requestId },
    });
    if (!candidate.deliveryExpiresAt) throw new Error('Fixture requires delivery expiry');
    const expired = new Date(candidate.deliveryExpiresAt.getTime() + 1);
    expect(await expirePlayAdmissions(instance.database, () => expired)).toMatchObject({
      deliveries: 1,
    });
    expect(
      (await instance.database.playJoinRequest.findUniqueOrThrow({ where: { id: candidate.id } }))
        .deliveryState
    ).toBeNull();
    expect((await actor({ authorization: `Bearer ${first.delivery.token}` })).identity.userId).toBe(
      first.delivery.profile.id
    );
    expect(await instance.database.user.count()).toBe(2);
    expect(await expirePlayAdmissions(instance.database, () => expired)).toMatchObject({
      deliveries: 0,
    });
  });

  it('expires unclaimed approvals without deleting their owner-approved profile', async () => {
    const fixture = await approved();
    const candidate = await instance.database.playJoinRequest.findUniqueOrThrow({
      where: { id: fixture.requestId },
    });
    const expired = new Date(candidate.expiresAt.getTime() + 1);
    await expirePlayAdmissions(instance.database, () => expired);
    expect(
      await instance.database.playJoinRequest.findUniqueOrThrow({ where: { id: candidate.id } })
    ).toMatchObject({ status: 'EXPIRED', provisionedUserId: fixture.approval.profileId });
    expect(await instance.database.user.count()).toBe(2);
    expect(await instance.database.apiKey.count()).toBe(0);
    await expect(
      claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null, () => expired)
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rejects revoked native delivery and erases its retained ciphertext', async () => {
    const fixture = await renewed();
    const first = await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null);
    if (first.delivery.kind !== 'NATIVE') throw new Error('Fixture requires native delivery');
    const token = first.delivery.token;
    await sottoTransaction(instance.database, async (database) => {
      const access = new AccessService({ store: await sottoAccessStore(database) });
      await sottoDeviceService(access).revoke(authority.ownerToken, tokenHash(token));
    });
    await expect(
      claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null)
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(
      (
        await instance.database.playJoinRequest.findUniqueOrThrow({
          where: { id: fixture.requestId },
        })
      ).deliveryState
    ).toBeNull();
    expect((await authority.access.store.read()).deviceTokens).toEqual([]);
  });

  it.each(['owner', 'pending-owner'] as const)(
    'never recovers an ordinary guest credential after promotion to %s',
    async (role) => {
      const fixture = await renewed();
      const first = await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null);
      await authority.access.store.transact((state) => {
        const member = state.principals.find(
          (principal) => principal.id === first.delivery.profile.id
        );
        if (!member) throw new Error('Fixture member missing');
        if (role === 'owner') member.role = 'owner';
        else member.pendingRole = 'owner';
      });
      await expect(
        claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null)
      ).rejects.toMatchObject({ code: 'unauthorized' });
      expect(
        (
          await instance.database.playJoinRequest.findUniqueOrThrow({
            where: { id: fixture.requestId },
          })
        ).deliveryState
      ).toBeNull();
    }
  );

  it('denies recovery when the sponsoring owner loses their server role', async () => {
    const fixture = await renewed();
    await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null);
    const other = await authority.household('Successor');
    await authority.access.store.transact((state) => {
      const owner = state.principals.find((principal) => principal.id === authority.ownerId);
      const successor = state.principals.find((principal) => principal.id === other.id);
      if (!owner || !successor) throw new Error('Fixture owner missing');
      successor.role = 'owner';
      owner.role = 'member';
    });
    await expect(
      claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null)
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(
      (
        await instance.database.playJoinRequest.findUniqueOrThrow({
          where: { id: fixture.requestId },
        })
      ).deliveryState
    ).toBeNull();
  });

  it('revokes recovery when the host cancels the game', async () => {
    const fixture = await renewed();
    await claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null);
    const room = await readStoredPlayRoom(fixture.host, fixture.room.id);
    await actOnStoredPlayRoom(fixture.host, room.id, {
      actionId: randomUUID(),
      expectedRevision: room.revision,
      type: 'CANCEL',
    });
    await expect(
      claimPlayEntry(instance.database, fixture.requestId, fixture.proof, null)
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(
      (
        await instance.database.playJoinRequest.findUniqueOrThrow({
          where: { id: fixture.requestId },
        })
      ).deliveryState
    ).toBeNull();
    expect(await instance.database.apiKey.count()).toBe(1);
  });

  it('keeps an existing player on their current credential and requires it on every retry', async () => {
    const fixture = await waitingHost();
    const member = await authority.household('Existing partner');
    const guest = await actor({ cookie: `sotto_session=${member.token}` });
    const proof = newToken(),
      requestId = randomUUID();
    await requestPlayEntry(
      instance.database,
      {
        requestId,
        code: fixture.invite.code,
        client: 'BROWSER',
        deviceName: 'Existing browser',
        candidate: { kind: 'EXISTING', settings },
      },
      proof,
      guest
    );
    await updatePlayPresence(fixture.host, fixture.room.id, {
      type: 'RENEW',
      viewNonce: fixture.viewNonce,
    });
    await approvePlayEntry(fixture.host, requestId, {
      actionId: randomUUID(),
      expectedRevision: 1,
      type: 'ACCEPT',
    });
    await expect(claimPlayEntry(instance.database, requestId, proof, null)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    const before = await authority.access.store.read();
    const result = await claimPlayEntry(instance.database, requestId, proof, guest);
    expect(result).toMatchObject({
      delivery: { kind: 'EXISTING', roomId: fixture.room.id, profile: { id: member.id } },
      browserSessionToken: null,
    });
    expect(await authority.access.store.read()).toEqual(before);
    expect(await instance.database.apiKey.count()).toBe(0);
    expect(await claimPlayEntry(instance.database, requestId, proof, guest)).toEqual(result);
    await authority.access.logout(member.token);
    await expect(claimPlayEntry(instance.database, requestId, proof, guest)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });
});
