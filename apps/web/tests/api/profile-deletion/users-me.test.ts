// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { acceptedPlayTestIdentity } from '../../helpers/play-fixture';
import { NextRequest } from 'next/server';
import { HouseholdProfileService, newToken, tokenHash } from 'thesidedoor-core/access';
import { StorageCleanupJournal, StorageWriteJournal } from 'thesidedoor-core/storage';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { DELETE } from '@/app/api/v1/users/me/route';
import { DELETE as deleteManagedProfile } from '@/app/api/v1/profiles/[id]/route';
import { authenticateRequest } from '@/lib/api-keys';
import { approvePlayEntry } from '@/lib/play/admission/approvals';
import { claimPlayEntry } from '@/lib/play/admission/claims';
import { rotatePlayInvitation } from '@/lib/play/admission/invitations';
import { updatePlayPresence } from '@/lib/play/admission/presence';
import { requestPlayEntry } from '@/lib/play/admission/requests';
import { createStoredPlayRoom } from '@/lib/play/storage/rooms';
import { issueSottoPairing, redeemSottoPairing } from '@/lib/sidedoor/access/core/pairing';
import { sottoDeviceService } from '@/lib/sidedoor/access/state/device-identity';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  afterAuthentication: null as (() => Promise<void>) | null,
  afterCapture: null as (() => Promise<void>) | null,
  loseCommit: false,
  afterLostCommit: null as (() => Promise<void>) | null,
}));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = new Proxy(prismaTestBoundary(boundary), {
    get(...parameters) {
      if (parameters[1] !== '$transaction') return Reflect.get(...parameters);
      return async (
        operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number }
      ) => {
        if (!boundary.database) throw new Error('Test database unavailable');
        const before = boundary.loseCommit ? await boundary.database.user.count() : null;
        const result = await boundary.database.$transaction(operation, options);
        if (before !== null && (await boundary.database.user.count()) < before) {
          boundary.loseCommit = false;
          await boundary.afterLostCommit?.();
          throw new Error('Connection lost after deletion committed');
        }
        if (result && typeof result === 'object') {
          const key =
            'epoch' in result && 'generation' in result
              ? 'afterCapture'
              : 'kind' in result && result.kind === 'content'
                ? 'afterAuthentication'
                : null;
          if (key && boundary[key]) {
            const hook = boundary[key];
            boundary[key] = null;
            await hook();
          }
        }
        return result;
      };
    },
  });
  return { prisma: database, prismaUnfiltered: database };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const origin = 'http://localhost:3000';
const settings = { nativeLang: 'es', targetLang: 'de', level: 'A1' } as const;
type Learner = { id: string; token: string; client: 'BROWSER' | 'NATIVE' };

suite('self profile deletion with canonical PostgreSQL authority', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('self_deletion');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('DATABASE_URL', process.env.SIDEDOOR_TEST_DATABASE_URL!);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'isolated-self-profile-deletion-test-key');
    identity = await acceptedPlayTestIdentity(instance, await instance.reset());
    boundary.afterAuthentication = null;
    boundary.afterCapture = null;
    boundary.loseCommit = false;
    boundary.afterLostCommit = null;
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });

  function request(learner?: Learner, body = JSON.stringify({ confirm: 'DELETE' })) {
    return new NextRequest(`${origin}/api/v1/users/me`, {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        ...(learner?.client === 'NATIVE'
          ? { authorization: `Bearer ${learner.token}` }
          : { origin, ...(learner ? { cookie: `sotto_session=${learner.token}` } : {}) }),
        ...(learner ? { 'x-sotto-expected-profile-id': learner.id } : {}),
      },
      body,
    });
  }
  function executor(tx: Prisma.TransactionClient = instance.database) {
    return {
      query: (sql: string, values: readonly unknown[]) =>
        tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    };
  }
  function journal() {
    return new StorageCleanupJournal(executor(), 'postgres', SIDEDOOR_STATE_ID);
  }
  async function assertIntact(id: string) {
    expect(
      await instance.database.user.findUnique({ where: { id }, select: { id: true } })
    ).toEqual({
      id,
    });
    expect((await identity.access.store.read()).principals.some((item) => item.id === id)).toBe(
      true
    );
    expect(
      await new StorageWriteJournal(executor(), 'postgres', SIDEDOOR_STATE_ID).tombstone(
        `profile:${id}`
      )
    ).toBeNull();
    expect((await journal().listJobs()).jobs).toEqual([]);
  }
  async function household(client: Learner['client']): Promise<Learner> {
    const member = await identity.household('Household learner');
    if (client === 'BROWSER') return { ...member, client };
    const issued = await sottoTransaction(instance.database, async (tx) => {
      const pairing = await issueSottoPairing(tx, member.token, 'Household phone', {
        scopes: ['app'],
      });
      return redeemSottoPairing(tx, pairing.token);
    });
    return { id: member.id, token: issued.token, client };
  }
  async function invited(client: Learner['client']): Promise<Learner> {
    const owner: Learner = { id: identity.ownerId, token: identity.ownerToken, client: 'BROWSER' };
    const hostRequest = request(owner);
    const hostIdentity = await authenticateRequest(hostRequest);
    if (!hostIdentity) throw new Error('Owner fixture must be authenticated');
    const host = { database: instance.database, request: hostRequest, identity: hostIdentity };
    const room = await createStoredPlayRoom(host, {
      actionId: randomUUID(),
      kind: 'MIXED',
      theme: 'FOOD',
      settings,
    });
    const viewNonce = newToken();
    await updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce });
    const invitation = await rotatePlayInvitation(host, room.id, {
      actionId: randomUUID(),
      expectedRevision: room.revision,
    });
    const requestId = randomUUID(),
      proof = newToken();
    const browserContext = { request: new Request(origin), expectedProfileId: null };
    await requestPlayEntry(
      instance.database,
      {
        requestId,
        code: invitation.code,
        client,
        deviceName: 'Invited learner',
        acceptedConductVersion: 1,
        candidate: { kind: 'NEW', name: 'Invited learner', settings, consentToProfile: true },
      },
      proof,
      null,
      undefined,
      client === 'BROWSER' ? browserContext : undefined
    );
    await approvePlayEntry(host, requestId, {
      actionId: randomUUID(),
      expectedRevision: 1,
      type: 'APPROVE_PROFILE',
    });
    await updatePlayPresence(host, room.id, { type: 'RENEW', viewNonce });
    const result = await claimPlayEntry(
      instance.database,
      requestId,
      proof,
      null,
      undefined,
      client === 'BROWSER' ? browserContext : undefined
    );
    const token =
      result.delivery.kind === 'NATIVE' ? result.delivery.token : result.browserSessionToken;
    if (!token) throw new Error('Invited fixture requires its delivered credential');
    return { id: result.delivery.profile.id, token, client };
  }

  it.each(['BROWSER', 'NATIVE'] as const)(
    'deletes the invited %s learner and revokes its authority while preserving other credentials',
    async (client) => {
      const learner = await invited(client);
      const other = await household('NATIVE');
      const session = await identity.household('Another learner');
      const otherPairing = await sottoTransaction(instance.database, async (tx) => {
        return issueSottoPairing(tx, session.token, 'Unrelated pending phone', { scopes: ['app'] });
      });
      const owned = await instance.database.episode.create({
        data: { userId: learner.id, title: 'Owned lesson', topic: 'Owned lesson' },
        select: { id: true },
      });
      const kept = await instance.database.episode.create({
        data: { userId: other.id, title: 'Other lesson', topic: 'Other lesson' },
        select: { id: true },
      });
      const response = await DELETE(
        request(learner, JSON.stringify({ confirm: 'DELETE', userId: other.id }))
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const body = await response.json();
      expect(body).toMatchObject({ success: true, cleanup: { phase: 'complete' } });
      expect(await journal().get(body.cleanup.id)).toMatchObject({
        subjectId: `profile:${learner.id}`,
      });
      expect(await instance.database.user.findUnique({ where: { id: learner.id } })).toBeNull();
      expect(await instance.database.episode.findUnique({ where: { id: owned.id } })).toBeNull();
      expect(
        await instance.database.episode.findUnique({ where: { id: kept.id }, select: { id: true } })
      ).toEqual(kept);
      expect(await authenticateRequest(request(learner))).toBeNull();
      expect(await authenticateRequest(request(other))).toMatchObject({ userId: other.id });
      expect((await identity.access.authenticate(identity.ownerToken, true)).principal?.id).toBe(
        identity.ownerId
      );
      expect(
        await sottoTransaction(instance.database, (tx) =>
          redeemSottoPairing(tx, otherPairing.token)
        )
      ).toHaveProperty('token');
      expect(response.headers.getSetCookie()).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^sotto_session=;/),
          expect.stringMatching(/^sotto_profile=;/),
        ])
      );
    }
  );

  it.each(['BROWSER', 'NATIVE'] as const)(
    'retains canonical household %s self deletion',
    async (client) => {
      const learner = await household(client);
      expect((await DELETE(request(learner))).status).toBe(200);
      expect(await instance.database.user.findUnique({ where: { id: learner.id } })).toBeNull();
      expect(await authenticateRequest(request(learner))).toBeNull();
    }
  );

  it.each(['afterAuthentication', 'afterCapture'] as const)(
    'rejects browser selection changes at %s without deleting either learner',
    async (phase) => {
      const learner = await household('BROWSER');
      const other = await identity.household('Other');
      boundary[phase] = () =>
        new HouseholdProfileService(identity.access).select(learner.token, other.id);
      expect((await DELETE(request(learner))).status).toBe(409);
      await assertIntact(learner.id);
      await assertIntact(other.id);
    }
  );

  it('rejects a household device default change between capture and deletion', async () => {
    const learner = await household('NATIVE');
    const other = await identity.household('Other');
    boundary.afterCapture = () =>
      identity.access.store.transact((state) => {
        const device = state.deviceTokens.find((item) => item.id === tokenHash(learner.token));
        const profile = state.householdProfiles!.find((item) => item.id === other.id);
        if (!device || !profile) throw new Error('Fixture requires a bound device and profile');
        device.defaultProfileId = profile.id;
        device.defaultProfileEpoch = profile.epoch;
      });
    expect((await DELETE(request(learner))).status).toBe(409);
    await assertIntact(learner.id);
    await assertIntact(other.id);
  });

  it.each(['BROWSER', 'NATIVE'] as const)(
    'rejects revoked invited %s admission before final mutation',
    async (client) => {
      const learner = await invited(client);
      boundary.afterCapture = async () => {
        if (client === 'BROWSER') await identity.access.logout(learner.token);
        else
          await sottoDeviceService(identity.access).revoke(
            identity.ownerToken,
            tokenHash(learner.token)
          );
      };
      expect((await DELETE(request(learner))).status).toBe(401);
      await assertIntact(learner.id);
    }
  );

  it.each(['profile-epoch', 'pending-owner'] as const)(
    'rechecks canonical %s protection at application',
    async (change) => {
      const learner = await invited('BROWSER');
      boundary.afterCapture = () =>
        identity.access.store.transact((state) => {
          if (change === 'profile-epoch')
            state.householdProfiles!.find((item) => item.id === learner.id)!.epoch++;
          else state.principals.find((item) => item.id === learner.id)!.pendingRole = 'owner';
        });
      expect((await DELETE(request(learner))).status).toBe(change === 'profile-epoch' ? 409 : 403);
      await assertIntact(learner.id);
    }
  );

  it.each(['BROWSER', 'NATIVE'] as const)(
    'keeps the %s owner profile protected',
    async (client) => {
      let token = identity.ownerToken;
      if (client === 'NATIVE') {
        token = (
          await sottoTransaction(instance.database, async (tx) => {
            const pairing = await issueSottoPairing(tx, token, 'Owner phone');
            return redeemSottoPairing(tx, pairing.token);
          })
        ).token;
      }
      const owner: Learner = { id: identity.ownerId, token, client };
      expect((await DELETE(request(owner))).status).toBe(403);
      await assertIntact(owner.id);
    }
  );

  it('never enables the manager route for invited members', async () => {
    const learner = await invited('NATIVE');
    const other = await identity.household('Other');
    for (const id of [learner.id, other.id]) {
      expect(
        (await deleteManagedProfile(request(learner), { params: Promise.resolve({ id }) })).status
      ).toBe(403);
      await assertIntact(id);
    }
  });

  it.each(['manifest', 'user'] as const)(
    'rolls back authority and cleanup after a %s persistence failure',
    async (failure) => {
      const learner = await invited('NATIVE');
      if (failure === 'manifest')
        await instance.database.$executeRawUnsafe(
          `ALTER TABLE "SidedoorState" ADD CONSTRAINT reject_self_manifest CHECK (state->>'kind' <> 'storage_cleanup_manifest')`
        );
      else {
        await instance.database.$executeRawUnsafe(
          `CREATE FUNCTION reject_self_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Deletion rejected'; END $$`
        );
        await instance.database.$executeRawUnsafe(
          'CREATE TRIGGER reject_self_delete BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION reject_self_delete()'
        );
      }
      try {
        expect((await DELETE(request(learner))).status).toBe(503);
        await assertIntact(learner.id);
        expect(await authenticateRequest(request(learner))).toMatchObject({ userId: learner.id });
      } finally {
        if (failure === 'manifest')
          await instance.database.$executeRawUnsafe(
            'ALTER TABLE "SidedoorState" DROP CONSTRAINT reject_self_manifest'
          );
        else {
          await instance.database.$executeRawUnsafe('DROP TRIGGER reject_self_delete ON "User"');
          await instance.database.$executeRawUnsafe('DROP FUNCTION reject_self_delete()');
        }
      }
    }
  );

  it.each(['BROWSER', 'NATIVE'] as const)(
    'retains uncertainty after committed %s self deletion loses its response',
    async (client) => {
      const learner = await invited(client);
      boundary.loseCommit = true;
      const response = await DELETE(request(learner));
      expect(response.status).toBe(503);
      expect(await response.json()).not.toHaveProperty('cleanup');
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await instance.database.user.findUnique({ where: { id: learner.id } })).toBeNull();
      expect((await journal().listJobs()).jobs).toEqual([
        expect.objectContaining({ subjectId: `profile:${learner.id}` }),
      ]);
      expect(await authenticateRequest(request(learner))).toBeNull();
    }
  );

  it('does not recover a self deletion through a different surviving household selection', async () => {
    const learner = await household('BROWSER');
    const other = await identity.household('Other');
    boundary.loseCommit = true;
    boundary.afterLostCommit = () =>
      new HouseholdProfileService(identity.access).select(learner.token, other.id);
    const response = await DELETE(request(learner));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty('cleanup');
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await instance.database.user.findUnique({ where: { id: learner.id } })).toBeNull();
    expect(await authenticateRequest(request({ ...learner, id: other.id }))).toMatchObject({
      userId: other.id,
    });
  });

  it.each([
    { name: 'missing confirmation', body: '{}' },
    { name: 'malformed JSON', body: '{' },
    {
      name: 'canonical 64 kB body limit',
      body: JSON.stringify({ confirm: 'DELETE', padding: 'x'.repeat(70_000) }),
    },
  ])('rejects $name before mutation', async ({ body, name }) => {
    const learner = await household('BROWSER');
    const response = await DELETE(request(learner, body));
    expect(response.status).toBe(400);
    if (name === 'canonical 64 kB body limit')
      expect(await response.json()).toMatchObject({ error: 'invalid' });
    await assertIntact(learner.id);
  });

  it('rejects absent admission, foreign browser origins and invalid exclusive bearers', async () => {
    const learner = await household('BROWSER');
    expect((await DELETE(request())).status).toBe(401);
    const foreign = request(learner);
    foreign.headers.set('origin', 'https://foreign.example');
    expect((await DELETE(foreign)).status).toBe(403);
    const invalidBearer = request(learner);
    invalidBearer.headers.set('authorization', 'Bearer invalid');
    expect((await DELETE(invalidBearer)).status).toBe(401);
    await assertIntact(learner.id);
  });
});
