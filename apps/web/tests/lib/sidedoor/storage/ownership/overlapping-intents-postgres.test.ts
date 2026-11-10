// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  prepareStorageBackend,
  prepareStorageWrite,
  StorageBackendRegistry,
  StorageCleanupJournal,
  StorageWriteJournal,
} from 'thesidedoor-core/storage';
import type { PrismaClient } from '@/generated/prisma/client';
import { captureStorageBackend } from '@/lib/r2';
import { setSiteConfig } from '@/lib/site-config';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { openSottoStorageConnection } from '@/lib/sidedoor/storage/core/storage-connection';
import { runSottoStorageCleanup } from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';

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
suite('overlapping storage cleanup intents', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  const roots: string[] = [];
  beforeAll(async () => {
    instance = await createSharedTestInstance('overlapping_cleanup');
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

  it.each(['profile-first', 'episode-first', 'three-forward', 'three-reverse'] as const)(
    'cleans a target recorded by multiple scopes with %s',
    async (order) => {
      const root = await mkdtemp(join(tmpdir(), 'sotto-overlap-'));
      roots.push(root);
      await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
      const member = await identity.household('Learner');
      const profile = await instance.database.user.findUniqueOrThrow({ where: { id: member.id } });
      const episode = await instance.database.episode.create({
        data: { userId: member.id, title: 'Lesson', topic: 'Lesson' },
      });
      const backend = await captureStorageBackend();
      const key = `overlap/${randomUUID()}.bin`;
      await backend.writeBuffer(key, Buffer.from('shared intent'), 'application/octet-stream');
      const subjects = [
        { subjectId: `profile:${member.id}`, generation: profile.createdAt.getTime() },
        { subjectId: `episode:${episode.id}`, generation: episode.createdAt.getTime() },
      ];
      if (order.startsWith('three-')) {
        const curriculum = await instance.database.curriculum.upsert({
          where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
          update: {},
          create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
        });
        const course = await instance.database.course.create({
          data: {
            userId: member.id,
            curriculumId: curriculum.id,
            nativeLang: 'es',
            targetLang: 'ru',
          },
        });
        subjects.push({ subjectId: `course:${course.id}`, generation: course.createdAt.getTime() });
      }
      const jobs = await sottoTransaction(instance.database, async (tx) => {
        const executor = {
          query: (sql: string, values: readonly unknown[]) =>
            tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        };
        const prepared = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
        await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
          prepared
        );
        const writes = new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
        for (const subject of subjects) {
          const intent = prepareStorageWrite({
            namespace: SIDEDOOR_STATE_ID,
            ...subject,
            target: { backendId: prepared.id, binding: prepared.binding, key },
          });
          await writes.begin(intent, subject.generation);
          await writes.finish(intent, { kind: 'unreferenced' });
        }
        const admitted = await admitLearningStorageDeletion({
          database: tx,
          scope: { kind: 'profile', id: member.id },
          subjects,
          currentBackend: backend,
        });
        await tx.user.delete({ where: { id: member.id } });
        return admitted;
      });
      expect(jobs).toHaveLength(subjects.length);
      for (const job of order === 'profile-first' || order === 'three-forward'
        ? jobs
        : [...jobs].reverse())
        await runSottoStorageCleanup(instance.database, job.id, {
          openConnection: () => openSottoStorageConnection(databaseUrl, instance.schema),
        });
      await expect(stat(join(root, key))).rejects.toMatchObject({ code: 'ENOENT' });
      const journal = new StorageCleanupJournal(
        {
          query: (sql, values) =>
            instance.database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      for (const job of jobs) expect((await journal.get(job.id)).phase).toBe('complete');
    }
  );
});
