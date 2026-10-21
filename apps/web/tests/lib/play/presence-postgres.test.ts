// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { acceptedPlayTestIdentity } from '../../helpers/play-fixture';
import { newToken, tokenHash, HouseholdProfileService } from 'thesidedoor-core/access';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PLAY_HOST_LEASE_MS } from '@sotto/shared';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { createSottoProfile, prepareSottoProfile } from '@/lib/sidedoor/access/core/profiles';
import { issueSottoPairing, redeemSottoPairing } from '@/lib/sidedoor/access/core/pairing';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { updatePlayPresence } from '@/lib/play/admission/presence';
import { playHostWaiting } from '@/lib/play/storage/room-view';
import { actOnStoredPlayRoom, createStoredPlayRoom } from '@/lib/play/storage/rooms';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;

suite('canonical foreground host leases', () => {
  let instance: SharedTestInstance;
  let authority: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('play_presence');
  });
  beforeEach(async () => {
    authority = await acceptedPlayTestIdentity(instance, await instance.reset());
  });
  afterAll(async () => instance?.close());

  async function actor(headers: HeadersInit) {
    const request = new Request('http://localhost/api/v1/play/rooms', { headers });
    const identity = await sottoTransaction(instance.database, (database) =>
      resolveSottoRequest(database, request)
    );
    if (identity?.kind !== 'content') throw new Error('Test requires canonical content admission');
    return { database: instance.database, request, identity };
  }

  async function hostRoom() {
    const host = await actor({ cookie: `sotto_session=${authority.ownerToken}` });
    const room = await createStoredPlayRoom(host, {
      actionId: randomUUID(),
      kind: 'MIXED',
      theme: 'FOOD',
      settings: { nativeLang: 'en', targetLang: 'de', level: 'A1' },
    });
    return { host, room };
  }

  function waiting(roomId: string, now = new Date()) {
    return sottoTransaction(instance.database, (database) =>
      playHostWaiting(database, roomId, now)
    );
  }

  it('requires an explicit authenticated heartbeat and expires it at server time without a gameplay revision', async () => {
    const { host, room } = await hostRoom();
    const now = new Date();
    const viewNonce = newToken();
    expect(await waiting(room.id, now)).toBe(false);
    const lease = await updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce }, () => now);
    expect(lease).toMatchObject({
      hostWaiting: true,
      expiresAt: new Date(now.getTime() + PLAY_HOST_LEASE_MS).toISOString(),
    });
    expect(await waiting(room.id, new Date(now.getTime() + PLAY_HOST_LEASE_MS - 1))).toBe(true);
    expect(await waiting(room.id, new Date(now.getTime() + PLAY_HOST_LEASE_MS))).toBe(false);
    expect(
      (await instance.database.playRoom.findUniqueOrThrow({ where: { id: room.id } })).revision
    ).toBe(0);
    const stored = await instance.database.playPresenceLease.findFirstOrThrow();
    const encoded = JSON.stringify(stored);
    expect(encoded).not.toContain(authority.ownerToken);
    expect(encoded).not.toContain(viewNonce);
  });

  it('releases only the requesting view and leaves another visible host view active', async () => {
    const { host, room } = await hostRoom();
    const first = newToken(),
      second = newToken();
    await updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce: first });
    await updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce: second });
    expect(
      await updatePlayPresence(host, room.id, { type: 'RELEASE', viewNonce: first })
    ).toMatchObject({ hostWaiting: true, expiresAt: null });
    expect(await instance.database.playPresenceLease.count({ where: { releasedAt: null } })).toBe(
      1
    );
    await updatePlayPresence(host, room.id, { type: 'RELEASE', viewNonce: newToken() });
    expect(await waiting(room.id)).toBe(true);
    expect(
      await updatePlayPresence(host, room.id, { type: 'RELEASE', viewNonce: second })
    ).toMatchObject({ hostWaiting: false });
  });

  it('revokes waiting status immediately when canonical access changes and restores it after renewal', async () => {
    const { host, room } = await hostRoom();
    const command = { type: 'RENEW', viewNonce: newToken() };
    await updatePlayPresence(host, room.id, command);
    await authority.access.enterHousehold('owner password for integration tests');
    expect(await waiting(room.id)).toBe(false);
    await updatePlayPresence(host, room.id, command);
    expect(await waiting(room.id)).toBe(true);
  });

  it('never revives a released view from delayed heartbeats, even before its first renewal', async () => {
    const { host, room } = await hostRoom();
    const viewNonce = newToken(),
      now = new Date();
    await updatePlayPresence(host, room.id, { type: 'RELEASE', viewNonce }, () => now);
    const later = new Date(now.getTime() + 2 * PLAY_HOST_LEASE_MS);
    await expect(
      updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce }, () => later)
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await waiting(room.id, later)).toBe(false);
    const foreground = newToken();
    await updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce: foreground }, () => later);
    await updatePlayPresence(host, room.id, { type: 'RELEASE', viewNonce }, () => later);
    expect(await waiting(room.id, later)).toBe(true);
  });

  it('preserves the release fence when the first heartbeat and background release race', async () => {
    const { host, room } = await hostRoom();
    const viewNonce = newToken();
    const results = await Promise.allSettled([
      updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce }),
      updatePlayPresence(host, room.id, { type: 'RELEASE', viewNonce }),
    ]);
    expect(results[1]?.status).toBe('fulfilled');
    expect(await waiting(room.id)).toBe(false);
    await expect(
      updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce })
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await instance.database.playPresenceLease.count({ where: { releasedAt: null } })).toBe(
      0
    );
  });

  it('invalidates the prior lease when the owner creates a profile through the canonical helper', async () => {
    const { host, room } = await hostRoom();
    const command = { type: 'RENEW', viewNonce: newToken() };
    await updatePlayPresence(host, room.id, command);
    const prepared = prepareSottoProfile('Approved partner');
    await sottoTransaction(instance.database, (database) =>
      createSottoProfile(database, host.request, prepared, null)
    );
    expect(await waiting(room.id)).toBe(false);
    await updatePlayPresence(host, room.id, command);
    expect(await waiting(room.id)).toBe(true);
  });

  it('does not retain presence after logout or accept a revoked browser credential', async () => {
    const { host, room } = await hostRoom();
    const command = { type: 'RENEW', viewNonce: newToken() };
    await updatePlayPresence(host, room.id, command);
    await authority.access.logout(authority.ownerToken);
    expect(await waiting(room.id)).toBe(false);
    await expect(updatePlayPresence(host, room.id, command)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('binds presence to the selected canonical learner rather than a reusable browser cookie', async () => {
    const { host, room } = await hostRoom();
    const other = await authority.household('Other learner');
    const command = { type: 'RENEW', viewNonce: newToken() };
    await updatePlayPresence(host, room.id, command);
    await new HouseholdProfileService(authority.access).select(authority.ownerToken, other.id);
    expect(await waiting(room.id)).toBe(false);
    await expect(updatePlayPresence(host, room.id, command)).rejects.toMatchObject({
      code: 'conflict',
    });
    const changed = await actor({ cookie: `sotto_session=${authority.ownerToken}` });
    await expect(updatePlayPresence(changed, room.id, command)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('caps the lease at the actual browser credential deadline', async () => {
    const { host, room } = await hostRoom();
    const now = new Date();
    const hardExpiry = now.getTime() + 5_000;
    await authority.access.store.transact((state) => {
      const session = state.sessions.find((entry) => entry.id === tokenHash(authority.ownerToken));
      if (!session) throw new Error('Fixture session missing');
      session.expiresAt = hardExpiry;
    });
    const lease = await updatePlayPresence(
      host,
      room.id,
      { type: 'RENEW', viewNonce: newToken() },
      () => now
    );
    expect(lease.expiresAt).toBe(new Date(hardExpiry).toISOString());
    expect(await waiting(room.id, new Date(hardExpiry))).toBe(false);
  });

  it('uses native canonical authentication, caps hard expiry, and detects device revocation', async () => {
    const { room } = await hostRoom();
    const redeemed = await sottoTransaction(instance.database, async (database) => {
      const pairing = await issueSottoPairing(database, authority.ownerToken, 'Host phone', {
        scopes: ['app'],
        defaultProfileId: authority.ownerId,
      });
      return redeemSottoPairing(database, pairing.token);
    });
    const host = await actor({ authorization: `Bearer ${redeemed.token}` });
    const now = new Date(),
      hardExpiry = now.getTime() + 5_000;
    await authority.access.store.transact((state) => {
      const device = state.deviceTokens.find((entry) => entry.id === tokenHash(redeemed.token));
      if (!device) throw new Error('Fixture device missing');
      device.expiresAt = hardExpiry;
    });
    const command = { type: 'RENEW', viewNonce: newToken() };
    expect(await updatePlayPresence(host, room.id, command, () => now)).toMatchObject({
      expiresAt: new Date(hardExpiry).toISOString(),
    });
    expect(await waiting(room.id)).toBe(true);
    await authority.access.store.transact((state) => {
      state.deviceTokens = state.deviceTokens.filter(
        (entry) => entry.id !== tokenHash(redeemed.token)
      );
    });
    expect(await waiting(room.id)).toBe(false);
    await expect(updatePlayPresence(host, room.id, command)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('does not fall back to cookies when a supplied native credential is invalid', async () => {
    const { host, room } = await hostRoom();
    const headers = new Headers(host.request.headers);
    headers.set('authorization', 'Bearer invalid-device-token');
    await expect(
      updatePlayPresence(
        { ...host, request: new Request(host.request.url, { headers }) },
        room.id,
        {
          type: 'RENEW',
          viewNonce: newToken(),
        }
      )
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(await waiting(room.id)).toBe(false);
  });

  it('prevents a different learner from renewing or releasing host presence', async () => {
    const { host, room } = await hostRoom();
    const guest = await actor({
      cookie: `sotto_session=${(await authority.household('Guest')).token}`,
    });
    const viewNonce = newToken();
    await updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce });
    for (const type of ['RENEW', 'RELEASE'])
      await expect(updatePlayPresence(guest, room.id, { type, viewNonce })).rejects.toMatchObject({
        code: 'forbidden',
      });
    expect(await waiting(room.id)).toBe(true);
  });

  it('bounds foreground views and reuses a released slot', async () => {
    const { host, room } = await hostRoom();
    const views = Array.from({ length: 8 }, () => newToken());
    for (const viewNonce of views)
      await updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce });
    const ninth = { type: 'RENEW', viewNonce: newToken() };
    await expect(updatePlayPresence(host, room.id, ninth)).rejects.toMatchObject({
      code: 'rate_limited',
    });
    await updatePlayPresence(host, room.id, { type: 'RELEASE', viewNonce: views[0] });
    expect(await updatePlayPresence(host, room.id, ninth)).toMatchObject({ hostWaiting: true });
  });

  it('cannot leave a live lease behind when renewal races room cancellation', async () => {
    const { host, room } = await hostRoom();
    const results = await Promise.allSettled([
      updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce: newToken() }),
      actOnStoredPlayRoom(host, room.id, {
        actionId: randomUUID(),
        expectedRevision: 0,
        type: 'CANCEL',
      }),
    ]);
    expect(results[1]?.status).toBe('fulfilled');
    expect(await waiting(room.id)).toBe(false);
    expect(await instance.database.playPresenceLease.count()).toBe(0);
    await expect(
      updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce: newToken() })
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});
