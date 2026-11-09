// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  LocalStorageCleanup,
  StorageBackendRegistry,
  StorageReferenceRegistry,
  StorageRelocationRegistry,
  prepareStorageBackend,
  prepareStorageReference,
} from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { capturedLocalBackend } from '@/lib/storage/sidedoor/captured-local';
import { LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';
import {
  admitSottoStorageCopy,
  executeSottoStorageCopy,
  verifyStorageCopyForDeletion,
} from '@/lib/sidedoor/storage/migration/storage-migration-copy';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { openSottoStorageConnection } from '@/lib/sidedoor/storage/core/storage-connection';
import { runSottoStorageCleanup } from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';
import { readStorageMigrationAssetPage } from '@/lib/sidedoor/storage/migration/storage-migration-plan';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('storage copy publication with PostgreSQL and local files', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  const roots: string[] = [];
  beforeAll(async () => {
    instance = await createSharedTestInstance('storage_migration_copy');
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterAll(async () => {
    await instance?.close();
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });
  async function backend() {
    const root = await mkdtemp(join(tmpdir(), 'sotto-copy-test-'));
    roots.push(root);
    return capturedLocalBackend(
      await LocalStorageCleanup.capture(root),
      root,
      LOCAL_STORAGE_URL_PREFIX,
      () => {}
    );
  }
  async function fixture(episodeId?: string, shared = false) {
    const source = await backend();
    const target = await backend();
    const other = shared ? await identity.household('Other learner') : null;
    const bytes = Buffer.from('A complete immutable avatar');
    const key = `${randomUUID()}.png`;
    const reference = await source.writeBuffer(key, bytes, 'image/png');
    await sottoTransaction(instance.database, async (tx) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const captured = prepareStorageBackend(SIDEDOOR_STATE_ID, source.descriptor);
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(captured);
      const current = await sottoStorageInstance(tx).read();
      const owner = await tx.user.findUniqueOrThrow({ where: { id: identity.ownerId } });
      const otherUser = other ? await tx.user.findUniqueOrThrow({ where: { id: other.id } }) : null;
      const scopes = episodeId
        ? (await captureEpisodeStorage(tx, episodeId)).scopes
        : [
            { subjectId: current.subjectId, generation: current.generation },
            { subjectId: `profile:${owner.id}`, generation: owner.createdAt.getTime() },
            ...(otherUser
              ? [
                  {
                    subjectId: `profile:${otherUser.id}`,
                    generation: otherUser.createdAt.getTime(),
                  },
                ]
              : []),
          ];
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [
          {
            consumer: episodeId ? `episode:${episodeId}:audio` : `profile:${owner.id}:avatar`,
            previousReference: null,
          },
          ...(otherUser
            ? [{ consumer: `profile:${otherUser.id}:avatar`, previousReference: null }]
            : []),
        ],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference,
          localRoutePrefix: LOCAL_STORAGE_URL_PREFIX,
          target: { backendId: captured.id, binding: captured.binding, key },
          scopes,
        }),
      });
      if (episodeId)
        await tx.episode.update({ where: { id: episodeId }, data: { audioUrl: reference } });
      else {
        await tx.user.update({ where: { id: owner.id }, data: { image: reference } });
        if (otherUser)
          await tx.user.update({ where: { id: otherUser.id }, data: { image: reference } });
      }
    });
    const request = new Request('http://localhost/api/v1/admin/storage/migrate', {
      headers: { cookie: `${SHARED_SESSION_COOKIE}=${identity.ownerToken}` },
    });
    const admission = await sottoTransaction(instance.database, (tx) =>
      resolveSottoRequest(tx, request)
    );
    if (!admission || admission.kind !== 'content') throw new Error('Missing owner admission');
    const page = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, request, admission })
    );
    const entry = page.entries[0];
    if (!entry || page.issues.length) throw new Error('Missing copy candidate');
    const operationId = randomUUID();
    const parent = await sottoTransaction(instance.database, (tx) =>
      admitSottoStorageCopy(tx, {
        request,
        admission,
        operationId,
        entry,
        target: target.descriptor,
        timeoutMs: 30_000,
      })
    );
    return {
      bytes,
      reference,
      source,
      target,
      other,
      options: {
        database: instance.database,
        request,
        admission,
        operationId,
        fingerprint: parent.fingerprint,
        target,
      },
    };
  }
  it('copies identical bytes and replays the sealed publication without storage I/O', async () => {
    const test = await fixture();
    const outcome = await executeSottoStorageCopy(test.options);
    expect(outcome.reference).not.toBe(test.reference);
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })).image
    ).toBe(outcome.reference);
    const root = await mkdtemp(join(tmpdir(), 'sotto-copy-read-'));
    roots.push(root);
    const path = join(root, 'result');
    await test.target.downloadToFile(outcome.reference, path);
    expect(await readFile(path)).toEqual(test.bytes);
    const rejectIo = async (): Promise<never> => {
      throw new Error('Replay attempted storage I/O');
    };
    expect(
      await executeSottoStorageCopy({
        ...test.options,
        target: { ...test.target, writeStream: rejectIo, downloadToFile: rejectIo },
      })
    ).toEqual(outcome);
  });
  it.each([null, '/avatars/capybara.png'])(
    'cleans a migrated avatar after replacement with %s',
    async (replacement) => {
      const test = await fixture();
      const outcome = await executeSottoStorageCopy(test.options);
      const owner = await instance.database.user.findUniqueOrThrow({
        where: { id: identity.ownerId },
      });
      const scope = { subjectId: `profile:${owner.id}`, generation: owner.createdAt.getTime() };
      await sottoTransaction(instance.database, async (tx) => {
        const registry = new StorageReferenceRegistry(
          { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
          'postgres',
          SIDEDOOR_STATE_ID
        );
        await registry.retire({
          operationId: randomUUID(),
          consumer: `profile:${owner.id}:avatar`,
          previousReference: outcome.reference,
        });
        await tx.user.update({ where: { id: owner.id }, data: { image: replacement } });
      });
      const wrongScope = { ...scope, generation: scope.generation + 1 };
      await expect(
        sottoTransaction(instance.database, (tx) =>
          verifyStorageCopyForDeletion(tx, {
            id: test.options.operationId,
            fingerprint: test.options.fingerprint,
            scope,
            subjects: [wrongScope],
            consumers: new Map(),
          })
        )
      ).rejects.toThrow('outside the deletion scope');
      await expect(
        sottoTransaction(instance.database, async (tx) => {
          await admitLearningStorageDeletion({
            database: tx,
            scope: { kind: 'profile', id: owner.id },
            subjects: [scope],
            currentBackend: test.target,
          });
          await tx.user.delete({ where: { id: owner.id } });
          throw new Error('Simulated final deletion failure');
        })
      ).rejects.toThrow('Simulated final deletion failure');
      expect(
        await instance.database.user.findUniqueOrThrow({ where: { id: owner.id } })
      ).toMatchObject({
        image: replacement,
      });
      expect(
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).receipt(test.options.operationId)
        )
      ).toMatchObject({ status: 'complete' });
      const remaining = await sottoTransaction(instance.database, (tx) =>
        new StorageRelocationRegistry(
          { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
          'postgres',
          SIDEDOOR_STATE_ID
        ).listForSubject(scope.subjectId)
      );
      expect(remaining.receipts).toHaveLength(1);
      const rollbackRoot = await mkdtemp(join(tmpdir(), 'sotto-copy-rollback-read-'));
      roots.push(rollbackRoot);
      const rollbackPath = join(rollbackRoot, 'target');
      await test.target.downloadToFile(outcome.reference, rollbackPath);
      expect(await readFile(rollbackPath)).toEqual(test.bytes);
      const rollbackSource = join(rollbackRoot, 'source');
      await test.source.downloadToFile(test.reference, rollbackSource);
      expect(await readFile(rollbackSource)).toEqual(test.bytes);
      const [cleanup] = await sottoTransaction(instance.database, (tx) =>
        admitLearningStorageDeletion({
          database: tx,
          scope: { kind: 'profile', id: owner.id },
          subjects: [scope],
          currentBackend: test.target,
        })
      );
      if (!cleanup) throw new Error('Missing profile cleanup');
      await runSottoStorageCleanup(instance.database, cleanup.id, {
        openConnection: () =>
          openSottoStorageConnection(process.env.SIDEDOOR_TEST_DATABASE_URL, instance.schema),
      });
      const root = await mkdtemp(join(tmpdir(), 'sotto-retired-copy-read-'));
      roots.push(root);
      await expect(
        test.source.downloadToFile(test.reference, join(root, 'source'))
      ).rejects.toThrow();
      await expect(
        test.target.downloadToFile(outcome.reference, join(root, 'target'))
      ).rejects.toThrow();
      expect(
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).receipt(test.options.operationId)
        )
      ).toMatchObject({ status: 'erased' });
    }
  );
  it('keeps copied media when the avatar changed without retirement evidence', async () => {
    const test = await fixture();
    const outcome = await executeSottoStorageCopy(test.options);
    const owner = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const scope = { subjectId: `profile:${owner.id}`, generation: owner.createdAt.getTime() };
    await instance.database.user.update({ where: { id: owner.id }, data: { image: null } });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        verifyStorageCopyForDeletion(tx, {
          id: test.options.operationId,
          fingerprint: test.options.fingerprint,
          scope,
          subjects: [scope],
          consumers: new Map(),
        })
      )
    ).rejects.toThrow('ownership changed');
    const root = await mkdtemp(join(tmpdir(), 'sotto-unretired-copy-read-'));
    roots.push(root);
    const path = join(root, 'target');
    await test.target.downloadToFile(outcome.reference, path);
    expect(await readFile(path)).toEqual(test.bytes);
  });
  it('does not recreate missing relocation evidence while admitting deletion', async () => {
    const test = await fixture();
    const outcome = await executeSottoStorageCopy(test.options);
    const owner = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const scope = { subjectId: `profile:${owner.id}`, generation: owner.createdAt.getTime() };
    await sottoTransaction(instance.database, async (tx) => {
      await tx.$executeRaw`DELETE FROM "SidedoorState" WHERE state->>'kind' IN ('storage_relocation', 'storage_relocation_allocation')`;
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        verifyStorageCopyForDeletion(tx, {
          id: test.options.operationId,
          fingerprint: test.options.fingerprint,
          scope,
          subjects: [scope],
          consumers: new Map([[`profile:${owner.id}:avatar`, outcome.reference]]),
        })
      )
    ).rejects.toThrow('cannot modify evidence');
    const rows = await instance.database.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM "SidedoorState"
      WHERE state->>'kind' IN ('storage_relocation', 'storage_relocation_allocation')
    `;
    expect(rows[0]?.count).toBe(0n);
  });
  it('rejects retirement when the consumer remains attached to another asset', async () => {
    const test = await fixture();
    const outcome = await executeSottoStorageCopy(test.options);
    const owner = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const scope = { subjectId: `profile:${owner.id}`, generation: owner.createdAt.getTime() };
    const consumer = `profile:${owner.id}:avatar`;
    await sottoTransaction(instance.database, async (tx) => {
      const registry = new StorageReferenceRegistry(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      await registry.retire({
        operationId: randomUUID(),
        consumer,
        previousReference: outcome.reference,
      });
      await tx.user.update({ where: { id: owner.id }, data: { image: null } });
      const changed = await tx.$executeRaw`
        UPDATE "SidedoorState"
        SET state = jsonb_set(state, '{consumers}', jsonb_build_array(${consumer}::text))
        WHERE state->>'kind' = 'storage_asset' AND state->'prepared'->>'reference' = ${test.reference}
      `;
      if (changed !== 1) throw new Error('Missing original asset fixture');
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        verifyStorageCopyForDeletion(tx, {
          id: test.options.operationId,
          fingerprint: test.options.fingerprint,
          scope,
          subjects: [scope],
          consumers: new Map(),
        })
      )
    ).rejects.toThrow('still attached');
  });
  it('keeps retired non-avatar migration history fenced during profile deletion', async () => {
    const episode = await instance.database.episode.create({
      data: { userId: identity.ownerId, title: 'Episode', topic: 'Topic' },
    });
    const test = await fixture(episode.id);
    const outcome = await executeSottoStorageCopy(test.options);
    const owner = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const scope = { subjectId: `profile:${owner.id}`, generation: owner.createdAt.getTime() };
    await sottoTransaction(instance.database, async (tx) => {
      const registry = new StorageReferenceRegistry(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      await registry.retire({
        operationId: randomUUID(),
        consumer: `episode:${episode.id}:audio`,
        previousReference: outcome.reference,
      });
      await tx.episode.update({ where: { id: episode.id }, data: { audioUrl: null } });
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        verifyStorageCopyForDeletion(tx, {
          id: test.options.operationId,
          fingerprint: test.options.fingerprint,
          scope,
          subjects: [scope],
          consumers: new Map(),
        })
      )
    ).rejects.toThrow('outside the deleted profile');
  });
  it('preserves a surviving learner’s retired episode linked to another profile’s course', async () => {
    const survivor = await identity.household('Survivor');
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      update: {},
    });
    const course = await instance.database.course.create({
      data: {
        userId: identity.ownerId,
        curriculumId: curriculum.id,
        nativeLang: 'es',
        targetLang: 'ru',
      },
    });
    const episode = await instance.database.episode.create({
      data: { userId: survivor.id, title: 'Episode', topic: 'Topic' },
    });
    await instance.database.practiceSession.create({
      data: {
        courseId: course.id,
        episodeId: episode.id,
        kind: 'LISTENING',
        items: [],
        seed: 'test',
      },
    });
    const test = await fixture(episode.id);
    const outcome = await executeSottoStorageCopy(test.options);
    const owner = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const scope = { subjectId: `profile:${owner.id}`, generation: owner.createdAt.getTime() };
    await sottoTransaction(instance.database, async (tx) => {
      const registry = new StorageReferenceRegistry(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      await registry.retire({
        operationId: randomUUID(),
        consumer: `episode:${episode.id}:audio`,
        previousReference: outcome.reference,
      });
      await tx.episode.update({ where: { id: episode.id }, data: { audioUrl: null } });
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitLearningStorageDeletion({
          database: tx,
          scope: { kind: 'profile', id: owner.id },
          subjects: [scope],
          currentBackend: test.target,
        })
      )
    ).rejects.toThrow('outside the deleted profile');
    expect(
      await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })
    ).toMatchObject({ userId: survivor.id, audioUrl: null });
    expect(
      await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).receipt(test.options.operationId)
      )
    ).toMatchObject({ status: 'complete' });
    const remaining = await sottoTransaction(instance.database, (tx) =>
      new StorageRelocationRegistry(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        SIDEDOOR_STATE_ID
      ).listForSubject(`profile:${survivor.id}`)
    );
    expect(remaining.receipts).toHaveLength(1);
  });
  it('preserves shared migrated media when another owner remains', async () => {
    const test = await fixture(undefined, true);
    if (!test.other) throw new Error('Missing shared owner');
    const outcome = await executeSottoStorageCopy(test.options);
    const owner = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const scope = { subjectId: `profile:${owner.id}`, generation: owner.createdAt.getTime() };
    await expect(
      sottoTransaction(instance.database, (tx) =>
        verifyStorageCopyForDeletion(tx, {
          id: test.options.operationId,
          fingerprint: test.options.fingerprint,
          scope,
          subjects: [scope],
          consumers: new Map([[`profile:${owner.id}:avatar`, outcome.reference]]),
        })
      )
    ).rejects.toThrow('outside the deletion scope');
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitLearningStorageDeletion({
          database: tx,
          scope: { kind: 'profile', id: owner.id },
          subjects: [scope],
          currentBackend: test.target,
        })
      )
    ).rejects.toThrow('outside the deletion scope');
    expect(
      await instance.database.user.findUniqueOrThrow({ where: { id: test.other.id } })
    ).toMatchObject({ image: outcome.reference });
    const root = await mkdtemp(join(tmpdir(), 'sotto-shared-copy-read-'));
    roots.push(root);
    const path = join(root, 'target');
    await test.target.downloadToFile(outcome.reference, path);
    expect(await readFile(path)).toEqual(test.bytes);
  });
  it('rejects a changed destination before copying and retains the original reference', async () => {
    const test = await fixture();
    await expect(
      executeSottoStorageCopy({ ...test.options, target: await backend() })
    ).rejects.toThrow('destination or requester changed');
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })).image
    ).toBe(test.reference);
  });
  it.each(['pending', 'completed'] as const)(
    'rejects %s copy replay after a parent change within the same course',
    async (state) => {
      const curriculum = await instance.database.curriculum.upsert({
        where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'es' } },
        create: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
        update: {},
      });
      const course = await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'es',
        },
      });
      const episode = await instance.database.episode.create({
        data: { userId: identity.ownerId, title: 'Lesson', topic: 'Topic' },
      });
      const previous = await instance.database.practiceSession.create({
        data: {
          courseId: course.id,
          episodeId: episode.id,
          kind: 'LISTENING',
          items: [],
          seed: 'previous',
        },
      });
      const test = await fixture(episode.id);
      const before = await sottoTransaction(instance.database, (tx) =>
        captureEpisodeStorage(tx, episode.id)
      );
      const reference =
        state === 'completed'
          ? (await executeSottoStorageCopy(test.options)).reference
          : test.reference;
      await instance.database.practiceSession.update({
        where: { id: previous.id },
        data: { episodeId: null },
      });
      await instance.database.practiceSession.create({
        data: {
          courseId: course.id,
          episodeId: episode.id,
          kind: 'LISTENING',
          items: [],
          seed: 'replacement',
        },
      });
      const after = await sottoTransaction(instance.database, (tx) =>
        captureEpisodeStorage(tx, episode.id)
      );
      expect(after.scopes).toEqual(before.scopes);
      expect(after.associations).not.toEqual(before.associations);
      const replay = executeSottoStorageCopy(test.options);
      if (state === 'pending')
        await expect(replay).rejects.toMatchObject({
          errors: expect.arrayContaining([
            expect.objectContaining({ message: 'Storage copy consumer ownership changed' }),
          ]),
        });
      else await expect(replay).rejects.toThrow('Storage copy consumer ownership changed');
      expect(
        (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).audioUrl
      ).toBe(reference);
    }
  );
  it('recovers an accepted publication after the database loses its commit response', async () => {
    const test = await fixture();
    let lostResponse = false;
    const database = new Proxy(instance.database, {
      get(target, property, receiver) {
        if (property !== '$transaction') return Reflect.get(target, property, receiver);
        return async (
          operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options?: Parameters<PrismaClient['$transaction']>[1]
        ) => {
          const result = await target.$transaction(operation, options);
          if (!lostResponse) {
            const parent = await sottoTransaction(instance.database, (tx) =>
              sottoJobOutbox(tx).read(test.options.operationId)
            );
            if (parent?.complete) {
              lostResponse = true;
              throw new Error('Connection lost after publication COMMIT');
            }
          }
          return result;
        };
      },
    });
    const target = {
      ...test.target,
      writeStream: async (...args: Parameters<typeof test.target.writeStream>) => {
        if (lostResponse) throw new Error('Recovery attempted another upload');
        return test.target.writeStream(...args);
      },
      downloadToFile: async (...args: Parameters<typeof test.target.downloadToFile>) => {
        if (lostResponse) throw new Error('Recovery attempted another readback');
        return test.target.downloadToFile(...args);
      },
    };
    const outcome = await executeSottoStorageCopy({ ...test.options, database, target });
    expect(lostResponse).toBe(true);
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })).image
    ).toBe(outcome.reference);
    expect(await executeSottoStorageCopy({ ...test.options, database, target })).toEqual(outcome);
  });
  it('rejects completed replay after the original owner logs out', async () => {
    const test = await fixture();
    const outcome = await executeSottoStorageCopy(test.options);
    await identity.access.logout(identity.ownerToken);
    await expect(executeSottoStorageCopy(test.options)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })).image
    ).toBe(outcome.reference);
  });
  it('verifies the original copy after the asset is relocated again', async () => {
    const test = await fixture();
    const first = await executeSottoStorageCopy(test.options);
    const { request, admission } = test.options;
    const page = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, request, admission })
    );
    const entry = page.entries[0];
    if (!entry || page.entries.length !== 1 || page.issues.length)
      throw new Error('Missing second copy candidate');
    const target = await backend();
    const operationId = randomUUID();
    const parent = await sottoTransaction(instance.database, (tx) =>
      admitSottoStorageCopy(tx, {
        request,
        admission,
        operationId,
        entry,
        target: target.descriptor,
        timeoutMs: 30_000,
      })
    );
    const second = await executeSottoStorageCopy({
      ...test.options,
      target,
      operationId,
      fingerprint: parent.fingerprint,
    });
    expect(second.reference).not.toBe(first.reference);
    expect(await executeSottoStorageCopy(test.options)).toEqual(first);
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })).image
    ).toBe(second.reference);
  });
  it('rejects mismatched readback bytes without publishing the new reference', async () => {
    const test = await fixture();
    const target = {
      ...test.target,
      downloadToFile: async (...args: Parameters<typeof test.target.downloadToFile>) => {
        const content = await test.target.downloadToFile(...args);
        return { ...content, bytes: content.bytes + 1 };
      },
    };
    await expect(executeSottoStorageCopy({ ...test.options, target })).rejects.toThrow(
      'readback does not match source bytes'
    );
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })).image
    ).toBe(test.reference);
  });
});
