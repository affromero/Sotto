// @vitest-environment node
import { NextRequest } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StorageCleanupJournal,
  StorageWriteJournal,
  StorageReferenceRegistry,
  StorageRelocationRegistry,
  StorageBackendRegistry,
  prepareStorageBackend,
  prepareStorageReference,
  storageBackendBinding,
} from 'thesidedoor-core/storage';
import type { PrismaClient, Prisma } from '@/generated/prisma/client';
import { PATCH, DELETE } from '@/app/api/v1/profiles/[id]/route';
import { GET as cleanupStatus } from '@/app/api/v1/admin/storage-cleanup/route';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../helpers/setup/shared-instance';

const binding = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  afterCapture: null as (() => Promise<void>) | null,
  loseCommit: false,
  afterLostCommit: null as (() => Promise<void>) | null,
}));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = new Proxy(prismaTestBoundary(binding), {
    get(...parameters) {
      if (parameters[1] !== '$transaction') return Reflect.get(...parameters);
      return async (
        operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number }
      ) => {
        if (!binding.database) throw new Error('Test database unavailable');
        const before = binding.loseCommit ? await binding.database.user.count() : null;
        const result = await binding.database.$transaction(operation, options);
        if (before !== null && (await binding.database.user.count()) < before) {
          binding.loseCommit = false;
          await binding.afterLostCommit?.();
          throw new Error('Connection lost after deletion committed');
        }
        if (
          result &&
          typeof result === 'object' &&
          'epoch' in result &&
          'generation' in result &&
          binding.afterCapture
        ) {
          const hook = binding.afterCapture;
          binding.afterCapture = null;
          await hook();
        }
        return result;
      };
    },
  });
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('profile changes and durable deletion with PostgreSQL', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('profile_deletion');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    identity = await instance.reset();
    binding.afterCapture = null;
    binding.loseCommit = false;
    binding.afterLostCommit = null;
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    binding.database = null;
    await instance?.close();
  });
  function request(
    method: string,
    id: string,
    token = identity.ownerToken,
    body?: unknown,
    origin = 'http://localhost:3000'
  ) {
    return new NextRequest(`http://localhost:3000/api/v1/profiles/${id}`, {
      method,
      headers: {
        cookie: `sotto_session=${token}; sotto_profile=${id}`,
        origin,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  function executor(tx: Prisma.TransactionClient = instance.database) {
    return {
      query: (sql: string, values: readonly unknown[]) =>
        tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    };
  }
  function journal(tx: Prisma.TransactionClient = instance.database) {
    return new StorageCleanupJournal(executor(tx), 'postgres', SIDEDOOR_STATE_ID);
  }
  async function assertNoDeletion(id: string) {
    expect(
      await instance.database.user.findUnique({ where: { id }, select: { id: true } })
    ).toEqual({ id });
    expect(
      (await identity.access.store.read()).householdProfiles?.some((profile) => profile.id === id)
    ).toBe(true);
    expect(
      await new StorageWriteJournal(executor(), 'postgres', SIDEDOOR_STATE_ID).tombstone(
        `profile:${id}`
      )
    ).toBeNull();
    expect(
      await instance.database.$queryRawUnsafe(
        `SELECT id FROM "SidedoorState" WHERE state->>'kind' IN ('storage_cleanup','storage_cleanup_manifest')`
      )
    ).toEqual([]);
  }
  it('updates household display metadata and rejects unknown avatar presets', async () => {
    const member = await identity.household('First');
    expect(
      (
        await PATCH(
          request('PATCH', member.id, identity.ownerToken, {
            name: 'Renamed',
            avatarSlug: 'jaguar',
          }),
          context(member.id)
        )
      ).status
    ).toBe(200);
    expect(
      await instance.database.user.findUniqueOrThrow({
        where: { id: member.id },
        select: { name: true, image: true },
      })
    ).toEqual({ name: 'Renamed', image: '/avatars/jaguar.png' });
    const state = await identity.access.store.read();
    expect(state.householdProfiles).toContainEqual(
      expect.objectContaining({ id: member.id, name: 'Renamed' })
    );
    expect(state.principals.find((principal) => principal.id === member.id)?.name).toBe('First');
    expect(
      (
        await PATCH(
          request('PATCH', member.id, identity.ownerToken, { avatarSlug: 'unicorn' }),
          context(member.id)
        )
      ).status
    ).toBe(400);
  });
  it.each(['commit', 'rollback'] as const)(
    'keeps relocated avatar evidence atomic with profile deletion on %s',
    async (outcome) => {
      const member = await identity.household('Relocated');
      const survivor = await identity.household('Survivor');
      const user = await instance.database.user.findUniqueOrThrow({
        where: { id: member.id },
        select: { createdAt: true },
      });
      const survivorUser = await instance.database.user.findUniqueOrThrow({
        where: { id: survivor.id },
        select: { createdAt: true },
      });
      const consumer = `profile:${member.id}:avatar`;
      const survivorConsumer = `profile:${survivor.id}:avatar`;
      const consumers = [consumer, survivorConsumer];
      const scopes = [
        { subjectId: `profile:${member.id}`, generation: user.createdAt.getTime() },
        { subjectId: `profile:${survivor.id}`, generation: survivorUser.createdAt.getTime() },
      ];
      const endpoints = await sottoTransaction(instance.database, async (tx) => {
        const storageInstance = await sottoStorageInstance(tx).read();
        scopes.push({
          subjectId: storageInstance.subjectId,
          generation: storageInstance.generation,
        });
        const registry = new StorageReferenceRegistry(executor(tx), 'postgres', SIDEDOOR_STATE_ID);
        const location = {
          kind: 'object' as const,
          endpoint: 'https://storage.example',
          bucket: 'avatars',
        };
        const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, {
          kind: 'object',
          location,
          binding: storageBackendBinding(location),
          publicUrl: 'https://media.example',
        });
        await new StorageBackendRegistry(executor(tx), 'postgres', SIDEDOOR_STATE_ID).register(
          backend
        );
        const prepared = [randomUUID(), randomUUID()].map((operationId) =>
          prepareStorageReference({
            namespace: SIDEDOOR_STATE_ID,
            operationId,
            reference: `https://media.example/${operationId}.png`,
            target: { backendId: backend.id, binding: backend.binding, key: `${operationId}.png` },
            scopes,
          })
        );
        const source = prepared[0]!;
        const destination = prepared[1]!;
        await registry.replaceMany({
          next: source,
          consumers: consumers.map((consumer) => ({ consumer, previousReference: null })),
        });
        await registry.replaceMany({
          next: destination,
          consumers: consumers.map((consumer) => ({
            consumer,
            previousReference: source.reference,
          })),
        });
        const original = await registry.readReference(source.reference);
        const current = await registry.readReference(destination.reference);
        const content = { sha256: createHash('sha256').update('avatar').digest('hex'), bytes: 6 };
        await new StorageRelocationRegistry(executor(tx), 'postgres', SIDEDOOR_STATE_ID).record({
          operationId: destination.operationId,
          sourceAssetId: original!.asset.id,
          destinationAssetId: current!.asset.id,
          consumers,
          sourceRead: { assetId: original!.asset.id, ...content },
          destinationRead: { assetId: current!.asset.id, ...content },
        });
        await tx.user.updateMany({
          where: { id: { in: [member.id, survivor.id] } },
          data: { image: destination.reference },
        });
        return { source, destination };
      });
      if (outcome === 'rollback') {
        await instance.database.$executeRawUnsafe(
          `CREATE FUNCTION reject_relocation_cascade() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'cascade unavailable'; END $$`
        );
        await instance.database.$executeRawUnsafe(
          `CREATE TRIGGER reject_relocation_cascade BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION reject_relocation_cascade()`
        );
        try {
          expect((await DELETE(request('DELETE', member.id), context(member.id))).status).toBe(503);
          await assertNoDeletion(member.id);
          expect(
            (
              await new StorageRelocationRegistry(
                executor(),
                'postgres',
                SIDEDOOR_STATE_ID
              ).listForSubject(`profile:${member.id}`)
            ).receipts
          ).toHaveLength(1);
          expect(
            (
              await new StorageReferenceRegistry(
                executor(),
                'postgres',
                SIDEDOOR_STATE_ID
              ).readReference(endpoints.destination.reference)
            )?.asset.consumers.sort()
          ).toEqual([...consumers].sort());
        } finally {
          await instance.database.$executeRawUnsafe(
            'DROP TRIGGER reject_relocation_cascade ON "User"'
          );
          await instance.database.$executeRawUnsafe('DROP FUNCTION reject_relocation_cascade()');
        }
        return;
      }
      const response = await DELETE(request('DELETE', member.id), context(member.id));
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(await instance.database.user.findUnique({ where: { id: member.id } })).toBeNull();
      expect(
        await instance.database.user.findUnique({
          where: { id: survivor.id },
          select: { image: true },
        })
      ).toEqual({ image: endpoints.destination.reference });
      expect(
        (
          await new StorageReferenceRegistry(
            executor(),
            'postgres',
            SIDEDOOR_STATE_ID
          ).readReference(endpoints.destination.reference)
        )?.asset.consumers
      ).toEqual([survivorConsumer]);
      const entries: unknown[] = [];
      let cursor: string | null = null;
      do {
        const page = await journal().listManifests(body.cleanup.id, cursor);
        entries.push(...page.pages.flatMap((manifest) => manifest.entries));
        cursor = page.cursor;
      } while (cursor !== null);
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'storage_relocation_dependency',
            role: 'source',
            prepared: endpoints.source,
          }),
          expect.objectContaining({
            kind: 'storage_relocation_dependency',
            role: 'destination',
            prepared: endpoints.destination,
          }),
        ])
      );
      expect(
        (
          await new StorageRelocationRegistry(
            executor(),
            'postgres',
            SIDEDOOR_STATE_ID
          ).listForSubject(`profile:${member.id}`)
        ).receipts
      ).toEqual([]);
      const cleanupJob = await journal().get(body.cleanup.id);
      expect(cleanupJob.phase).toBe('preparing');
      expect(cleanupJob.unresolvedManifests).toBeGreaterThan(0);
    }
  );
  it('rejects invalid admission, foreign origins and deletion of credentialed profiles', async () => {
    const member = await identity.household('Learner');
    expect((await DELETE(request('DELETE', member.id, 'invalid'), context(member.id))).status).toBe(
      401
    );
    expect(
      (
        await DELETE(
          request('DELETE', member.id, identity.ownerToken, undefined, 'https://foreign.example'),
          context(member.id)
        )
      ).status
    ).toBe(403);
    expect(
      (await DELETE(request('DELETE', identity.ownerId), context(identity.ownerId))).status
    ).toBe(403);
    await identity.access.addMember(identity.ownerToken, 'Private', 'private member password');
    const privateId = (await identity.access.store.read()).principals.find(
      (principal) => principal.name === 'Private'
    )!.id;
    expect((await DELETE(request('DELETE', privateId), context(privateId))).status).toBe(403);
    await assertNoDeletion(member.id);
  });
  it('removes authority and owned data without importing unattributed references', async () => {
    const member = await identity.household('Learner');
    const other = await identity.household('Other');
    const unattributed = 'https://unattributed.example/avatar.png';
    await instance.database.user.update({
      where: { id: member.id },
      data: { image: unattributed },
      select: { id: true },
    });
    const episode = await instance.database.episode.create({
      data: {
        userId: member.id,
        title: 'Owned',
        topic: 'Owned',
        audioUrl: 'https://unattributed.example/lesson.mp3',
      },
      select: { id: true },
    });
    const otherEpisode = await instance.database.episode.create({
      data: { userId: other.id, title: 'Other', topic: 'Other' },
      select: { id: true },
    });
    await instance.database.discovery.create({
      data: { userId: member.id, episodeId: otherEpisode.id, focusAreas: [] },
      select: { id: true },
    });
    await instance.database.apiUsageLog.create({
      data: { userId: member.id, service: 'test', category: 'test', totalCost: 1 },
      select: { id: true },
    });
    await instance.database.feedback.create({
      data: { userId: member.id, type: 'GENERAL', subject: 'Owned', message: 'Owned' },
      select: { id: true },
    });
    const response = await DELETE(request('DELETE', member.id, member.token), context(member.id));
    expect(response.status).toBe(202);
    expect(response.headers.get('set-cookie')).toContain('sotto_profile=');
    expect(response.headers.get('set-cookie')).toContain('sotto_theme=');
    const body = await response.json();
    expect(body).toMatchObject({ success: true, cleanup: { phase: 'complete' } });
    expect(await journal().get(body.cleanup.id)).toMatchObject({
      retentionPolicy: 'job-id-snapshots-v1',
    });
    expect(await instance.database.user.findUnique({ where: { id: member.id } })).toBeNull();
    expect(await instance.database.episode.findUnique({ where: { id: episode.id } })).toBeNull();
    expect(
      await instance.database.episode.findUnique({
        where: { id: otherEpisode.id },
        select: { id: true },
      })
    ).toEqual({ id: otherEpisode.id });
    expect(await instance.database.discovery.count({ where: { userId: member.id } })).toBe(0);
    expect(await instance.database.apiUsageLog.count({ where: { userId: member.id } })).toBe(0);
    expect(await instance.database.feedback.count({ where: { userId: member.id } })).toBe(0);
    const state = await identity.access.store.read();
    expect(state.principals.some((principal) => principal.id === member.id)).toBe(false);
    expect(state.sessions.some((session) => session.selectedProfileId === member.id)).toBe(false);
    const entries: unknown[] = [];
    let cursor: string | null = null;
    do {
      const page = await journal().listManifests(body.cleanup.id, cursor);
      for (const manifest of page.pages) entries.push(...manifest.entries);
      cursor = page.cursor;
    } while (cursor !== null);
    expect(JSON.stringify(entries)).not.toContain('unattributed.example');
  });
  it('rolls back authority and snapshots when manifest persistence fails', async () => {
    const member = await identity.household('Learner');
    await instance.database.$executeRawUnsafe(
      `ALTER TABLE "SidedoorState" ADD CONSTRAINT reject_deletion_manifest CHECK (state->>'kind' <> 'storage_cleanup_manifest')`
    );
    try {
      expect((await DELETE(request('DELETE', member.id), context(member.id))).status).toBe(503);
      await assertNoDeletion(member.id);
    } finally {
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "SidedoorState" DROP CONSTRAINT reject_deletion_manifest'
      );
    }
  });
  it('shows queued cleanup only to the owner without exposing historical references', async () => {
    const member = await identity.household('Learner');
    const other = await identity.household('Other');
    const historical = 'https://private-backend.example/secret-path.png';
    await instance.database.user.update({
      where: { id: member.id },
      data: { image: historical },
      select: { id: true },
    });
    const deleted = await DELETE(request('DELETE', member.id), context(member.id));
    expect(deleted.status).toBe(202);
    const deletion = await deleted.json();
    const url = 'http://localhost:3000/api/v1/admin/storage-cleanup';
    for (const [token, status] of [
      ['invalid', 401],
      [other.token, 403],
    ] as const) {
      const response = await cleanupStatus(
        new NextRequest(url, { headers: { cookie: `sotto_session=${token}` } })
      );
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    const response = await cleanupStatus(
      new NextRequest(url, { headers: { cookie: `sotto_session=${identity.ownerToken}` } })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body.cursor).toBeNull();
    expect(body.jobs).toEqual([
      {
        id: deletion.cleanup.id,
        subjectId: `profile:${member.id}`,
        createdAt: expect.any(Number),
        phase: 'complete',
        complete: true,
        blocked: false,
        writerProtocol: 'verified',
        knownPendingFiles: 0,
        deletedFiles: 0,
        unresolvedManifests: 0,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain(historical);
    expect(
      (
        await cleanupStatus(
          new NextRequest(`${url}?after=invalid`, {
            headers: { cookie: `sotto_session=${identity.ownerToken}` },
          })
        )
      ).status
    ).toBe(400);
  });
  it('does not import large unattributed references into cleanup state', async () => {
    const member = await identity.household('Learner');
    const references = Array.from(
      { length: 3 },
      (_, index) => `https://old.example/${index}/${'x'.repeat(600_000)}`
    );
    await instance.database.episode.createMany({
      data: references.map((audioUrl, index) => ({
        id: `bytes-${index}`,
        userId: member.id,
        title: 'Historical',
        topic: 'Historical',
        audioUrl,
      })),
    });
    const response = await DELETE(request('DELETE', member.id), context(member.id));
    expect(response.status).toBe(202);
    const body = await response.json();
    const saved: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await journal().listManifests(body.cleanup.id, cursor);
      for (const manifest of page.pages) {
        expect(Buffer.byteLength(JSON.stringify(manifest.entries))).toBeLessThanOrEqual(
          1024 * 1024
        );
        for (const entry of manifest.entries) {
          if (
            entry &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            entry.source === 'episode'
          ) {
            const refs = entry.references;
            if (
              refs &&
              typeof refs === 'object' &&
              !Array.isArray(refs) &&
              typeof refs.audioUrl === 'string'
            )
              saved.push(refs.audioUrl);
          }
        }
      }
      cursor = page.cursor;
    } while (cursor !== null);
    expect(saved).toEqual([]);
  });
  it('removes a profile even when an unattributed reference exceeds the manifest limit', async () => {
    const member = await identity.household('Learner');
    await instance.database.episode.createMany({
      data: Array.from({ length: 101 }, (_, index) => ({
        id: `limit-${String(index).padStart(3, '0')}`,
        userId: member.id,
        title: 'Historical',
        topic: 'Historical',
        audioUrl:
          index === 100
            ? `https://old.example/${'x'.repeat(1024 * 1024)}`
            : `https://old.example/${index}.mp3`,
      })),
    });
    const response = await DELETE(request('DELETE', member.id), context(member.id));
    expect(response.status).toBe(202);
    expect(await instance.database.user.findUnique({ where: { id: member.id } })).toBeNull();
    expect(await instance.database.episode.count({ where: { userId: member.id } })).toBe(0);
  });
  it('recovers the committed job after a lost deletion response without repeating deletion', async () => {
    const member = await identity.household('Learner');
    binding.loseCommit = true;
    const response = await DELETE(request('DELETE', member.id), context(member.id));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(await journal().get(body.cleanup.id)).toMatchObject({
      subjectId: `profile:${member.id}`,
      phase: expect.stringMatching(/^(complete|preparing)$/),
    });
    expect(await instance.database.user.findUnique({ where: { id: member.id } })).toBeNull();
    const jobs = await instance.database.$queryRawUnsafe<{ id: string }[]>(
      `SELECT state->>'id' AS id FROM "SidedoorState" WHERE state->>'kind' = 'storage_cleanup'`
    );
    expect(jobs).toEqual([{ id: body.cleanup.id }]);
  });
  it('does not disclose a recovered deletion result after the requesting credential is revoked', async () => {
    const member = await identity.household('Learner');
    binding.loseCommit = true;
    binding.afterLostCommit = () => identity.access.logout(identity.ownerToken);
    const response = await DELETE(request('DELETE', member.id), context(member.id));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty('cleanup');
    expect(await instance.database.user.findUnique({ where: { id: member.id } })).toBeNull();
  });
  it('captures retired assets and unresolved retirements beyond unrelated registry pages', async () => {
    const member = await identity.household('Learner');
    const generation = (
      await instance.database.user.findUniqueOrThrow({
        where: { id: member.id },
        select: { createdAt: true },
      })
    ).createdAt.getTime();
    const location = {
      kind: 'object' as const,
      endpoint: 'https://storage.example',
      bucket: 'private',
    };
    const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, {
      kind: 'object',
      location,
      binding: storageBackendBinding(location),
      publicUrl: 'https://media.example',
    });
    const hash = (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const assets = Array.from({ length: 106 }, (_, index) =>
      prepareStorageReference({
        namespace: SIDEDOOR_STATE_ID,
        operationId: randomUUID(),
        reference: `https://media.example/file-${index}.png`,
        target: { backendId: backend.id, binding: backend.binding, key: `file-${index}.png` },
        scopes: [{ subjectId: 'unrelated', generation: 1 }],
      })
    ).sort((left, right) =>
      hash([left.target.binding, left.target.key]).localeCompare(
        hash([right.target.binding, right.target.key])
      )
    );
    const owned = assets[assets.length - 1]!;
    owned.scopes = [{ subjectId: `profile:${member.id}`, generation }];
    const consumer = `profile:${member.id}:avatar`;
    const unrelated = Array.from({ length: 101 }, () => randomUUID());
    const lastUnrelated = unrelated
      .map((operationId) => hash([operationId, 'unrelated']))
      .sort()
      .at(-1)!;
    let operationId: string;
    do {
      operationId = randomUUID();
    } while (hash([operationId, consumer]) <= lastUnrelated);
    const unknown = 'https://unattributed.example/retired.png';
    await sottoTransaction(instance.database, async (tx) => {
      await new StorageBackendRegistry(executor(tx), 'postgres', SIDEDOOR_STATE_ID).register(
        backend
      );
      const registry = new StorageReferenceRegistry(executor(tx), 'postgres', SIDEDOOR_STATE_ID);
      for (const asset of assets)
        await registry.replace({
          consumer: asset === owned ? consumer : 'unrelated',
          previousReference: null,
          next: asset,
        });
      await registry.retire({
        operationId: randomUUID(),
        consumer,
        previousReference: owned.reference,
      });
      for (const id of unrelated)
        await registry.retire({
          operationId: id,
          consumer: 'unrelated',
          previousReference: `https://other.example/${id}`,
        });
      await registry.retire({ operationId, consumer, previousReference: unknown });
    });
    const registry = new StorageReferenceRegistry(executor(), 'postgres', SIDEDOOR_STATE_ID);
    expect(
      (await registry.listAssets()).assets.some(
        (asset) => asset.prepared.reference === owned.reference
      )
    ).toBe(false);
    expect(
      (await registry.listRetirements()).retirements.some(
        (record) => record.previousReference === unknown
      )
    ).toBe(false);
    const response = await DELETE(request('DELETE', member.id), context(member.id));
    expect(response.status).toBe(202);
    const body = await response.json();
    const entries: unknown[] = [];
    let cursor: string | null = null;
    do {
      const page = await journal().listManifests(body.cleanup.id, cursor);
      for (const manifest of page.pages) entries.push(...manifest.entries);
      cursor = page.cursor;
    } while (cursor !== null);
    expect(entries).toContainEqual(
      expect.objectContaining({ kind: 'storage_asset', prepared: owned, consumers: [] })
    );
    expect(JSON.stringify(entries)).not.toContain(unknown);
    expect(JSON.stringify(entries)).not.toContain('https://other.example/');
  });

  it('rolls back the snapshot and authority when the final database deletion fails', async () => {
    const member = await identity.household('Learner');
    await instance.database.$executeRawUnsafe(
      `CREATE FUNCTION reject_profile_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Deletion rejected'; END $$`
    );
    await instance.database.$executeRawUnsafe(
      'CREATE TRIGGER reject_profile_delete BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION reject_profile_delete()'
    );
    try {
      expect((await DELETE(request('DELETE', member.id), context(member.id))).status).toBe(503);
      await assertNoDeletion(member.id);
    } finally {
      await instance.database.$executeRawUnsafe('DROP TRIGGER reject_profile_delete ON "User"');
      await instance.database.$executeRawUnsafe('DROP FUNCTION reject_profile_delete()');
    }
  });
  it('rejects logout and target epoch changes between capture and deletion', async () => {
    const member = await identity.household('Learner');
    binding.afterCapture = async () => {
      await identity.access.logout(identity.ownerToken);
    };
    expect((await DELETE(request('DELETE', member.id), context(member.id))).status).toBe(401);
    await assertNoDeletion(member.id);
    binding.afterCapture = async () => {
      await identity.access.store.transact((state) => {
        state.householdProfiles!.find((profile) => profile.id === member.id)!.epoch++;
      });
    };
    expect(
      (await DELETE(request('DELETE', member.id, member.token), context(member.id))).status
    ).toBe(409);
    await assertNoDeletion(member.id);
  });
});
