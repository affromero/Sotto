// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobRetentionCleanup } from 'thesidedoor-core/runtime/outbox';
import {
  prepareStorageCleanup,
  prepareStorageBackend,
  prepareStorageReference,
  StorageBackendRegistry,
  StorageCleanupJournal,
  StorageReferenceRegistry,
  StorageWriteJournal,
  CleanupExecutionJournal,
  storageBackendBinding,
  prepareStorageWrite,
} from 'thesidedoor-core/storage';
import type { PrismaClient } from '@/generated/prisma/client';
import { captureStorageBackend } from '@/lib/r2';
import { setSiteConfig } from '@/lib/site-config';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { openSottoStorageConnection } from '@/lib/sidedoor/storage/core/storage-connection';
import { runSottoStorageCleanup } from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { registerSharedWriteCase } from './ownership/shared-write-case';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => {
  const database = new Proxy(
    {},
    {
      get(_target, property) {
        if (!boundary.database) throw new Error('Test database is not initialized');
        const value = boundary.database[property as keyof PrismaClient];
        return typeof value === 'function' ? value.bind(boundary.database) : value;
      },
    }
  );
  return { prisma: database, prismaUnfiltered: database };
});

const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('durable local storage cleanup', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  const roots: string[] = [];

  beforeAll(async () => {
    instance = await createSharedTestInstance('local_cleanup');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  it('cleans a prefix inventory spanning more than one page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sotto-cleanup-pages-'));
    roots.push(root);
    await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
    const local = await captureStorageBackend();
    const prepared = prepareStorageBackend(SIDEDOOR_STATE_ID, local.descriptor);
    const job = prepareStorageCleanup({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: `profile:${identity.ownerId}`,
      generation: Date.now(),
    });
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(prepared);
      const cleanup = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
      await cleanup.createJob(job);
      await cleanup.registerCollectors(job.id, job.epoch, [
        {
          id: 'large-prefix',
          kind: 'inventory',
          backendIds: [prepared.id],
          scope: 'pages/',
          match: 'prefix',
        },
      ]);
    });
    const objects = new Set(Array.from({ length: 1001 }, (_, index) => `pages/${index}.bin`));
    const storage = await import('@/lib/r2');
    const capture = vi.spyOn(storage, 'captureStorageCleanup').mockResolvedValue({
      descriptor: prepared.descriptor,
      normalize: local.normalize,
      async *list() {
        yield* objects;
      },
      has: async (key) => objects.has(key),
      delete: async (key) => {
        objects.delete(key);
      },
    });
    try {
      await runSottoStorageCleanup(instance.database, job.id, {
        openConnection: () => openSottoStorageConnection(databaseUrl, instance.schema),
      });
      expect(objects.size).toBe(0);
    } finally {
      capture.mockRestore();
    }
  }, 60_000);

  it('does not settle an earlier unresolved cleanup execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sotto-cleanup-prior-execution-'));
    roots.push(root);
    await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
    const backend = await captureStorageBackend();
    const prepared = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
    const job = prepareStorageCleanup({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: `profile:${identity.ownerId}`,
      generation: Date.now(),
    });
    const prior = {
      executionId: randomUUID(),
      executorId: randomUUID(),
      jobId: job.id,
      backendBinding: prepared.binding,
    };
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(prepared);
      const cleanup = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
      await cleanup.createJob(job);
      await cleanup.registerCollectors(job.id, job.epoch, [
        {
          id: 'empty',
          kind: 'inventory',
          backendIds: [prepared.id],
          scope: '__test/empty',
          match: 'key',
        },
      ]);
      const executions = new CleanupExecutionJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
      await executions.begin(prior);
      await executions.markUnconfirmed(prior);
    });
    await expect(
      runSottoStorageCleanup(instance.database, job.id, {
        openConnection: () => openSottoStorageConnection(databaseUrl, 'public'),
      })
    ).rejects.toThrow('Storage state relation could not be identified');
    await expect(
      runSottoStorageCleanup(instance.database, job.id, {
        openConnection: () => openSottoStorageConnection(databaseUrl, instance.schema),
      })
    ).rejects.toThrow('Backend has an unresolved cleanup execution');
    const current = await sottoTransaction(instance.database, (database) =>
      new CleanupExecutionJournal(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      ).current(prepared.binding)
    );
    expect(current).toMatchObject({ ...prior, status: 'unconfirmed' });
  });

  it('records settled local I/O before retrying a failed inventory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sotto-cleanup-local-retry-'));
    roots.push(root);
    await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
    const backend = await captureStorageBackend();
    const prepared = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
    const job = prepareStorageCleanup({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: `profile:${identity.ownerId}`,
      generation: Date.now(),
    });
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(prepared);
      const cleanup = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
      await cleanup.createJob(job);
      await cleanup.registerCollectors(job.id, job.epoch, [
        {
          id: 'empty',
          kind: 'inventory',
          backendIds: [prepared.id],
          scope: '__test/empty',
          match: 'key',
        },
      ]);
    });
    const storage = await import('@/lib/r2');
    const captured = await storage.captureStorageCleanup(prepared.descriptor);
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let fail = true;
    const capture = vi.spyOn(storage, 'captureStorageCleanup').mockResolvedValue({
      ...captured,
      has: async (key, signal) => {
        if (fail) {
          started.resolve();
          await release.promise;
        }
        const result = await captured.has(key, signal);
        if (fail) {
          fail = false;
          throw new Error('Local inventory failed');
        }
        return result;
      },
    });
    try {
      const options = {
        openConnection: () => openSottoStorageConnection(databaseUrl, instance.schema),
      };
      const first = runSottoStorageCleanup(instance.database, job.id, options).then(
        () => null,
        (error: unknown) => error
      );
      await started.promise;
      try {
        await expect(runSottoStorageCleanup(instance.database, job.id, options)).rejects.toThrow(
          'owned by another cleanup connection'
        );
      } finally {
        release.resolve();
      }
      expect(await first).toMatchObject({ message: 'Local inventory failed' });
      const current = await sottoTransaction(instance.database, (database) =>
        new CleanupExecutionJournal(
          {
            query: (sql, values) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          },
          'postgres',
          SIDEDOOR_STATE_ID
        ).current(prepared.binding)
      );
      expect(current).toMatchObject({
        jobId: job.id,
        status: 'settled',
        resolution: { kind: 'remote-operations-settled', id: expect.any(String) },
      });
      await runSottoStorageCleanup(instance.database, job.id, options);
      const completed = await sottoTransaction(instance.database, (database) =>
        new StorageCleanupJournal(
          {
            query: (sql, values) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          },
          'postgres',
          SIDEDOOR_STATE_ID
        ).get(job.id)
      );
      expect(completed.phase).toBe('complete');
    } finally {
      capture.mockRestore();
    }
  });

  it('keeps local cleanup unresolved when retention has already begun', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sotto-cleanup-local-retention-'));
    roots.push(root);
    await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
    const backend = await captureStorageBackend();
    const prepared = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
    const job = prepareStorageCleanup({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: `profile:${identity.ownerId}`,
      generation: Date.now(),
      retentionPolicy: 'job-id-snapshots-v1',
    });
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(prepared);
      const cleanup = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
      await cleanup.createJob(job);
      await cleanup.registerCollectors(job.id, job.epoch, [
        {
          id: 'empty',
          kind: 'inventory',
          backendIds: [prepared.id],
          scope: '__test/empty',
          match: 'key',
        },
      ]);
      const waiting = await cleanup.transition(job.id, job.epoch);
      await cleanup.recordDrainedIntents(job.id, waiting.epoch, null);
      await new JobRetentionCleanup(executor, 'postgres', SIDEDOOR_STATE_ID).step(job.id);
    });
    const storage = await import('@/lib/r2');
    const captured = await storage.captureStorageCleanup(prepared.descriptor);
    const capture = vi.spyOn(storage, 'captureStorageCleanup').mockResolvedValue({
      ...captured,
      has: async (key, signal) => {
        await captured.has(key, signal);
        throw new Error('Local inventory failed');
      },
    });
    try {
      const options = {
        openConnection: () => openSottoStorageConnection(databaseUrl, instance.schema),
      };
      const failure: unknown = await runSottoStorageCleanup(
        instance.database,
        job.id,
        options
      ).then(
        () => null,
        (error: unknown) => error
      );
      expect(failure).toMatchObject({
        message: 'Storage cleanup failed and local settlement could not be confirmed',
        errors: [
          expect.objectContaining({ message: 'Local inventory failed' }),
          expect.objectContaining({
            message: expect.stringContaining('requires reviewed recovery'),
          }),
        ],
      });
      const current = await sottoTransaction(instance.database, (database) =>
        new CleanupExecutionJournal(
          {
            query: (sql, values) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          },
          'postgres',
          SIDEDOOR_STATE_ID
        ).current(prepared.binding)
      );
      expect(current).toMatchObject({ jobId: job.id, status: 'unconfirmed' });
      await expect(runSottoStorageCleanup(instance.database, job.id, options)).rejects.toThrow(
        'Backend has an unresolved cleanup execution'
      );
    } finally {
      capture.mockRestore();
    }
  });

  it('leaves a failed object-storage execution unresolved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sotto-cleanup-object-gate-'));
    roots.push(root);
    await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
    const local = await captureStorageBackend();
    const location = {
      kind: 'object' as const,
      endpoint: 'https://storage.example',
      bucket: 'fixture',
    };
    const prepared = prepareStorageBackend(SIDEDOOR_STATE_ID, {
      kind: 'object',
      location,
      binding: storageBackendBinding(location),
      publicUrl: null,
    });
    const job = prepareStorageCleanup({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: `profile:${identity.ownerId}`,
      generation: Date.now(),
    });
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(prepared);
      const cleanup = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
      await cleanup.createJob(job);
      await cleanup.registerCollectors(job.id, job.epoch, [
        {
          id: 'object',
          kind: 'inventory',
          backendIds: [prepared.id],
          scope: 'fixture/item',
          match: 'key',
        },
      ]);
    });
    const storage = await import('@/lib/r2');
    const capture = vi.spyOn(storage, 'captureStorageCleanup').mockResolvedValue({
      descriptor: prepared.descriptor,
      normalize: local.normalize,
      list: local.list,
      has: async () => {
        throw new Error('Object request outcome unknown');
      },
      delete: local.delete,
    });
    try {
      await expect(
        runSottoStorageCleanup(instance.database, job.id, {
          openConnection: () => openSottoStorageConnection(databaseUrl, instance.schema),
        })
      ).rejects.toThrow('Object request outcome unknown');
    } finally {
      capture.mockRestore();
    }
    const current = await sottoTransaction(instance.database, (database) =>
      new CleanupExecutionJournal(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      ).current(prepared.binding)
    );
    expect(current).toMatchObject({ jobId: job.id, status: 'unconfirmed' });
  });

  it.each([
    { cancellation: false, localStatus: 'settled' },
    { cancellation: true, localStatus: 'unconfirmed' },
  ])(
    'retains the right mixed-backend gates when cancellation is $cancellation',
    async ({ cancellation, localStatus }) => {
      const root = await mkdtemp(join(tmpdir(), 'sotto-cleanup-mixed-gate-'));
      roots.push(root);
      await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
      const local = await captureStorageBackend();
      const localBackend = prepareStorageBackend(SIDEDOOR_STATE_ID, local.descriptor);
      const location = {
        kind: 'object' as const,
        endpoint: 'https://storage.example',
        bucket: 'fixture',
      };
      const objectBackend = prepareStorageBackend(SIDEDOOR_STATE_ID, {
        kind: 'object',
        location,
        binding: storageBackendBinding(location),
        publicUrl: null,
      });
      const job = prepareStorageCleanup({
        namespace: SIDEDOOR_STATE_ID,
        subjectId: `profile:${identity.ownerId}`,
        generation: Date.now(),
      });
      await sottoTransaction(instance.database, async (database) => {
        const executor = {
          query: (sql: string, values: readonly unknown[]) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        };
        const registry = new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID);
        await registry.register(localBackend);
        await registry.register(objectBackend);
        const cleanup = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
        await cleanup.createJob(job);
        await cleanup.registerCollectors(job.id, job.epoch, [
          {
            id: 'a-local',
            kind: 'inventory',
            backendIds: [localBackend.id],
            scope: 'fixture/local',
            match: 'key',
          },
          {
            id: 'b-object',
            kind: 'inventory',
            backendIds: [objectBackend.id],
            scope: 'fixture/object',
            match: 'key',
          },
        ]);
      });
      const storage = await import('@/lib/r2');
      const controller = new AbortController();
      const capture = vi
        .spyOn(storage, 'captureStorageCleanup')
        .mockImplementation(async (descriptor) => ({
          descriptor: descriptor!,
          normalize: local.normalize,
          list: local.list,
          has: async (key, signal) => {
            if (descriptor?.kind === 'object') {
              if (cancellation) controller.abort(new Error('Mixed cleanup cancelled'));
              throw new Error('Mixed cleanup failed');
            }
            return local.has(key, signal);
          },
          delete: local.delete,
        }));
      try {
        await expect(
          runSottoStorageCleanup(instance.database, job.id, {
            signal: controller.signal,
            openConnection: () => openSottoStorageConnection(databaseUrl, instance.schema),
          })
        ).rejects.toThrow('Mixed cleanup failed');
      } finally {
        capture.mockRestore();
      }
      const statuses = await sottoTransaction(instance.database, async (database) => {
        const executions = new CleanupExecutionJournal(
          {
            query: (sql, values) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          },
          'postgres',
          SIDEDOOR_STATE_ID
        );
        return Promise.all([
          executions.current(localBackend.binding),
          executions.current(objectBackend.binding),
        ]);
      });
      expect(statuses).toEqual([
        expect.objectContaining({ jobId: job.id, status: localStatus }),
        expect.objectContaining({ jobId: job.id, status: 'unconfirmed' }),
      ]);
    }
  );

  it('preserves profile avatars when resetting learning data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sotto-reset-avatar-'));
    roots.push(root);
    await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
    const curriculum = await instance.database.curriculum.create({
      data: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
    });
    const course = await instance.database.course.create({
      data: {
        userId: identity.ownerId,
        curriculumId: curriculum.id,
        nativeLang: 'es',
        targetLang: 'ru',
      },
    });
    const profile = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const backend = await captureStorageBackend();
    const key = `avatars/${identity.ownerId}/${randomUUID()}.png`;
    const reference = await backend.writeBuffer(key, Buffer.from('avatar'), 'image/png');
    const [job] = await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const registered = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
        registered
      );
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [{ consumer: `profile:${identity.ownerId}:avatar`, previousReference: null }],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference,
          localRoutePrefix: '/api/v1/storage',
          target: { backendId: registered.id, binding: registered.binding, key },
          scopes: [
            { subjectId: `profile:${identity.ownerId}`, generation: profile.createdAt.getTime() },
          ],
        }),
      });
      await database.user.update({ where: { id: identity.ownerId }, data: { image: reference } });
      const jobs = await admitLearningStorageDeletion({
        database,
        scope: { kind: 'instance' },
        subjects: [{ subjectId: `course:${course.id}`, generation: course.createdAt.getTime() }],
        currentBackend: backend,
      });
      await database.course.delete({ where: { id: course.id } });
      return jobs;
    });
    if (!job) throw new Error('Missing cleanup job');
    await runSottoStorageCleanup(instance.database, job.id, {
      openConnection: () => openSottoStorageConnection(databaseUrl, instance.schema),
    });
    expect(await readFile(join(root, key), 'utf8')).toBe('avatar');
    expect(
      await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })
    ).toMatchObject({ image: reference });
  });

  it('preserves a course when its saved asset has no matching deletion scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sotto-cleanup-unattributed-'));
    roots.push(root);
    await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
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
    const focus = await instance.database.learnerFocusTarget.create({
      data: { courseId: course.id, kind: 'WORD', text: 'чай', normalizedText: 'чай' },
    });
    const profile = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const backend = await captureStorageBackend();
    const key = `visual-cues/${randomUUID()}.png`;
    const reference = await backend.writeBuffer(key, new TextEncoder().encode('kept'), 'image/png');
    const consumer = `focus-target:${focus.id}:visual`;
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const registered = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
        registered
      );
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [{ consumer, previousReference: null }],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference,
          localRoutePrefix: '/api/v1/storage',
          target: { backendId: registered.id, binding: registered.binding, key },
          scopes: [
            { subjectId: `profile:${identity.ownerId}`, generation: profile.createdAt.getTime() },
          ],
        }),
      });
      await database.learnerFocusTarget.update({
        where: { id: focus.id },
        data: { visualCueUrl: reference },
      });
    });
    await expect(
      sottoTransaction(instance.database, async (database) => {
        await admitLearningStorageDeletion({
          database,
          scope: { kind: 'course', id: course.id, episodeIds: [] },
          subjects: [{ subjectId: `course:${course.id}`, generation: course.createdAt.getTime() }],
          currentBackend: backend,
        });
        await database.course.delete({ where: { id: course.id } });
      })
    ).rejects.toThrow(`Storage reference ${consumer} has no matching deletion scope`);
    expect(await instance.database.course.findUnique({ where: { id: course.id } })).not.toBeNull();
    expect(await readFile(join(root, key), 'utf8')).toBe('kept');
  });

  it('deletes published files and retained unreferenced writes after application rows commit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sotto-local-cleanup-'));
    roots.push(root);
    await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
    const curriculum = await instance.database.curriculum.create({
      data: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
    });
    const course = await instance.database.course.create({
      data: {
        userId: identity.ownerId,
        curriculumId: curriculum.id,
        nativeLang: 'en',
        targetLang: 'es',
      },
    });
    const focus = await instance.database.learnerFocusTarget.create({
      data: {
        courseId: course.id,
        kind: 'WORD',
        text: 'hola',
        normalizedText: 'hola',
      },
    });
    const backend = await captureStorageBackend();
    const key = `visual-cues/${randomUUID()}.png`;
    const reference = await backend.writeBuffer(
      key,
      new TextEncoder().encode('image'),
      'image/png'
    );
    const unreferencedKey = `visual-cues/${randomUUID()}.png`;
    await backend.writeBuffer(
      unreferencedKey,
      new TextEncoder().encode('unreferenced image'),
      'image/png'
    );
    const job = await sottoTransaction(instance.database, async (database) => {
      const preparedBackend = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
      const prepared = prepareStorageReference({
        namespace: SIDEDOOR_STATE_ID,
        operationId: randomUUID(),
        reference,
        localRoutePrefix: '/api/v1/storage',
        target: {
          backendId: preparedBackend.id,
          binding: preparedBackend.binding,
          key,
        },
        scopes: [{ subjectId: `course:${course.id}`, generation: course.createdAt.getTime() }],
      });
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
        preparedBackend
      );
      const writes = new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
      const intent = prepareStorageWrite({
        namespace: SIDEDOOR_STATE_ID,
        subjectId: `course:${course.id}`,
        generation: course.createdAt.getTime(),
        target: {
          backendId: preparedBackend.id,
          binding: preparedBackend.binding,
          key: unreferencedKey,
        },
      });
      await writes.begin(intent, course.createdAt.getTime());
      await writes.finish(intent, { kind: 'unreferenced' });
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [{ consumer: `focus-target:${focus.id}:visual`, previousReference: null }],
        next: prepared,
      });
      await database.learnerFocusTarget.update({
        where: { id: focus.id },
        data: { visualCueUrl: reference },
      });
      const [admitted] = await admitLearningStorageDeletion({
        database,
        scope: { kind: 'course', id: course.id, episodeIds: [] },
        subjects: [{ subjectId: `course:${course.id}`, generation: course.createdAt.getTime() }],
        currentBackend: backend,
      });
      if (!admitted) throw new Error('Expected cleanup admission');
      await database.course.delete({ where: { id: course.id } });
      return admitted;
    });

    expect(await readFile(join(root, key), 'utf8')).toBe('image');
    await runSottoStorageCleanup(instance.database, job.id, {
      openConnection: () => openSottoStorageConnection(databaseUrl, instance.schema),
    });
    await expect(readFile(join(root, key))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, unreferencedKey))).rejects.toMatchObject({ code: 'ENOENT' });
    const status = await sottoTransaction(instance.database, (database) =>
      new StorageCleanupJournal(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      ).get(job.id)
    );
    expect(status).toMatchObject({ phase: 'complete', deleted: 2, pending: 0 });
  });

  it('keeps a referenced file when an erased scope still has a live consumer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sotto-local-survivor-'));
    roots.push(root);
    await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
    const backend = await captureStorageBackend();
    const key = `profile-assets/${randomUUID()}.png`;
    const reference = await backend.writeBuffer(
      key,
      new TextEncoder().encode('shared image'),
      'image/png'
    );
    const scope = `profile:${identity.ownerId}`;
    const job = prepareStorageCleanup({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: scope,
      generation: Date.now(),
    });
    await sottoTransaction(instance.database, async (database) => {
      const preparedBackend = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
      const prepared = prepareStorageReference({
        namespace: SIDEDOOR_STATE_ID,
        operationId: randomUUID(),
        reference,
        localRoutePrefix: '/api/v1/storage',
        target: {
          backendId: preparedBackend.id,
          binding: preparedBackend.binding,
          key,
        },
        scopes: [{ subjectId: scope, generation: job.generation }],
      });
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
        preparedBackend
      );
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [{ consumer: `profile:${identity.ownerId}:avatar`, previousReference: null }],
        next: prepared,
      });
      const journal = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
      await journal.createJob(job);
      await journal.registerCollectors(job.id, job.epoch, [
        {
          id: 'live-reference-check',
          kind: 'references',
          backendIds: [preparedBackend.id],
          scope,
        },
        {
          id: 'empty-inventory-check',
          kind: 'inventory',
          backendIds: [preparedBackend.id],
          scope: `erased/${job.id}`,
          match: 'key',
        },
      ]);
    });

    await runSottoStorageCleanup(instance.database, job.id, {
      openConnection: () => openSottoStorageConnection(databaseUrl, instance.schema),
    });

    expect(await readFile(join(root, key), 'utf8')).toBe('shared image');
    const status = await sottoTransaction(instance.database, (database) =>
      new StorageCleanupJournal(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      ).get(job.id)
    );
    expect(status).toMatchObject({ phase: 'complete', deleted: 0, pending: 0 });
  });

  it('refuses a persisted exact cleanup target while an asset still has a live consumer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sotto-cleanup-old-target-'));
    roots.push(root);
    await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
    const backend = await captureStorageBackend();
    const key = `profile-assets/${randomUUID()}.png`;
    const reference = await backend.writeBuffer(
      key,
      new TextEncoder().encode('retained'),
      'image/png'
    );
    const scope = `profile:${identity.ownerId}`;
    const job = prepareStorageCleanup({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: scope,
      generation: Date.now(),
    });
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const registered = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
        registered
      );
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [{ consumer: `profile:${identity.ownerId}:avatar`, previousReference: null }],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference,
          localRoutePrefix: '/api/v1/storage',
          target: { backendId: registered.id, binding: registered.binding, key },
          scopes: [{ subjectId: scope, generation: job.generation }],
        }),
      });
      const journal = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
      await journal.createJob(job);
      await journal.registerCollectors(job.id, job.epoch, [
        {
          id: 'old-target',
          kind: 'inventory',
          backendIds: [registered.id],
          scope: key,
          match: 'key',
        },
      ]);
    });
    await expect(
      runSottoStorageCleanup(instance.database, job.id, {
        openConnection: () => openSottoStorageConnection(databaseUrl, instance.schema),
      })
    ).rejects.toThrow('live consumers');
    expect(await readFile(join(root, key), 'utf8')).toBe('retained');
  });

  registerSharedWriteCase(() => ({ instance, identity, roots }));
});
