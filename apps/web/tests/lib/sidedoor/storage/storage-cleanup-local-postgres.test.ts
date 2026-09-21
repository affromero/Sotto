// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  prepareStorageCleanup,
  prepareStorageBackend,
  prepareStorageReference,
  StorageBackendRegistry,
  StorageCleanupJournal,
  StorageReferenceRegistry,
} from 'thesidedoor-core/storage';
import type { PrismaClient } from '@/generated/prisma/client';
import { captureStorageBackend } from '@/lib/r2';
import { setSiteConfig } from '@/lib/site-config';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { openSottoStorageConnection } from '@/lib/sidedoor/storage/core/storage-connection';
import { runSottoStorageCleanup } from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
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

  it('deletes an attributed file and completes its journal after application rows commit', async () => {
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
    expect(status).toMatchObject({ phase: 'complete', deleted: 1, pending: 0 });
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
});
