// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { sottoStateWriteTransaction } from '@/lib/sidedoor/access/state/write-transaction';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null, waiting: () => {} }));
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
vi.mock('@/lib/sidedoor/storage/core/storage-connection', async (original) => {
  const actual = await original<typeof import('@/lib/sidedoor/storage/core/storage-connection')>();
  return {
    ...actual,
    openSottoStorageConnection: async (
      ...args: Parameters<typeof actual.openSottoStorageConnection>
    ) => {
      const connection = await actual.openSottoStorageConnection(...args);
      return {
        ...connection,
        query: async (sql: string, values: readonly unknown[]) => {
          const rows = await connection.query(sql, values);
          if (sql.includes('pg_try_advisory_lock') && rows[0]?.acquired === false)
            boundary.waiting();
          return rows;
        },
      };
    },
  };
});
vi.mock('@/lib/sidedoor/storage/migration/storage-cleanup-runtime', () => ({
  runSottoStorageCleanup: async () => {},
}));

import { deleteCourseCompletely } from '@/lib/course-deletion';
import { factoryReset } from '@/lib/admin/factory-reset';
import { deleteClassForUser } from '@/lib/classes/deletion/class-deletion';
import { maintainMaterialUploads } from '@/lib/course-materials/uploads/cleanup';
import { authorizedLearnerExecution } from '../../../../helpers/runtime/provider-execution';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('learning deletion storage admission', () => {
  let instance: SharedTestInstance;
  beforeAll(async () => {
    instance = await createSharedTestInstance('course_fence');
    boundary.database = instance.database;
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });

  it.each(['course deletion', 'factory reset', 'class deletion', 'upload maintenance'] as const)(
    '%s waits for a storage writer before changing saved data',
    async (operation) => {
      const identity = await instance.reset();
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
      const lesson = await instance.database.lesson.upsert({
        where: { curriculumId_slug: { curriculumId: curriculum.id, slug: 'fence-test' } },
        create: {
          curriculumId: curriculum.id,
          level: 'A1',
          order: 1,
          slug: 'fence-test',
          title: 'Test',
          objective: 'Test',
          grammarPoints: [],
          vocabThemes: [],
          targetVocab: [],
        },
        update: {},
      });
      const cls = await instance.database.courseClass.create({
        data: { courseId: course.id, lessonId: lesson.id, order: 1 },
      });
      let uploadId: string | undefined;
      if (operation === 'upload maintenance') {
        const material = await instance.database.courseMaterial.create({
          data: {
            userId: identity.ownerId,
            courseId: course.id,
            name: 'Test',
            mimeType: 'text/plain',
            byteSize: 1,
            extractedText: '',
            processingStatus: 'UPLOADING',
          },
        });
        const batch = await instance.database.materialUploadBatch.create({
          data: {
            userId: identity.ownerId,
            requestId: 'upload-fence',
            fingerprint: 'test',
            expiresAt: new Date(0),
          },
        });
        const upload = await instance.database.materialUpload.create({
          data: {
            batchId: batch.id,
            materialId: material.id,
            clientId: 'test',
            expiresAt: new Date(0),
          },
        });
        uploadId = upload.id;
      }
      let entered!: () => void;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const writer = sottoStateWriteTransaction(
        instance.database,
        async () => {
          entered();
          await released;
        },
        AbortSignal.timeout(30_000)
      );
      let deletion: Promise<unknown> | undefined;
      try {
        await held;
        const waiting = new Promise<void>((resolve) => {
          boundary.waiting = resolve;
        });
        deletion =
          operation === 'course deletion'
            ? deleteCourseCompletely(course.id)
            : operation === 'factory reset'
              ? factoryReset()
              : operation === 'class deletion'
                ? deleteClassForUser(
                    cls.id,
                    identity.ownerId,
                    authorizedLearnerExecution(identity.ownerId)
                  )
                : maintainMaterialUploads(AbortSignal.timeout(30_000));
        void deletion.catch(() => undefined);
        await Promise.race([
          waiting,
          deletion.then(() => {
            throw new Error('Course was deleted before storage admission');
          }),
        ]);
        if (uploadId)
          expect(
            await instance.database.materialUpload.findUniqueOrThrow({ where: { id: uploadId } })
          ).toMatchObject({ status: 'UPLOADING' });
        else
          expect(
            await instance.database.courseClass.findUnique({ where: { id: cls.id } })
          ).not.toBeNull();
        release();
        await writer;
        await deletion;
        if (uploadId)
          expect(
            await instance.database.materialUpload.findUniqueOrThrow({ where: { id: uploadId } })
          ).toMatchObject({ status: 'EXPIRED' });
        else
          expect(
            await instance.database.courseClass.findUnique({ where: { id: cls.id } })
          ).toBeNull();
      } finally {
        release();
        await Promise.allSettled([writer, ...(deletion ? [deletion] : [])]);
        boundary.waiting = () => {};
      }
    },
    60_000
  );
});
