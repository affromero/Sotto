import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import type { ClassPreparation } from '@/lib/classes/preparation-state';
import {
  cancelClassPreparation,
  classPreparationStore,
  recordClassPreparationFailure,
  requestClassPreparation,
  readClassPreparation,
  preparationProgress,
} from '@/lib/classes/preparation';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { eraseCompletedClassCleanupReceipts } from '@/lib/classes/help/prerequisite-deletion';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { captureStorageBackend, LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';
import * as storageRuntime from '@/lib/r2';
import * as cleanupRuntime from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';
import {
  StorageBackendRegistry,
  StorageReferenceRegistry,
  StorageCleanupJournal,
  StorageWriteJournal,
  prepareStorageBackend,
  prepareStorageReference,
  prepareStorageWrite,
  prepareStorageCleanup,
  storageBackendBinding,
} from 'thesidedoor-core/storage';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { SharedTestInstance } from '../../../helpers/setup/shared-instance';

interface Context {
  instance: SharedTestInstance;
  courseId: string;
  execution: SottoProviderExecution;
  running: () => Promise<ClassPreparation>;
  lesson: () => Promise<{ id: string }>;
}

export function registerTerminalCleanupTests(context: () => Context) {
  it.each([{}, { sourceUrl: 'https://example.com/article' }, { topic: 'Sustainable travel' }])(
    'restores the exact admitted initial source without persisting projection fields: %j',
    async (source) => {
      const { instance, courseId, execution } = context();
      const operation = await requestClassPreparation(courseId, execution, source);
      const restored = await readClassPreparation(courseId, execution.userId);
      expect(restored && preparationProgress(restored)).toMatchObject({
        operationId: operation.id,
        initialPreparation: { sourceUrl: source.sourceUrl ?? null, topic: source.topic ?? null },
      });
      const stored = await classPreparationStore(instance.database, courseId).read();
      expect(stored).not.toHaveProperty('initialPreparation');
    }
  );

  async function fixture(active = false) {
    const { instance, courseId, running, lesson } = context();
    const operation = await running();
    const cls = await instance.database.courseClass.create({
      data: { courseId, lessonId: (await lesson()).id, order: 1, status: 'GENERATING' },
    });
    const binding = await sottoTransaction(instance.database, async (database) => {
      const current = await classPreparationStore(database, courseId).transact((state) => {
        if (!state) throw new Error('Missing preparation fixture');
        state.classId = cls.id;
        return state;
      });
      const receipt = await sottoJobOutbox(database).read(operation.id);
      if (!receipt) throw new Error('Missing preparation receipt');
      const execution = {
        id: randomUUID(),
        parentId: operation.id,
        fingerprint: receipt.fingerprint,
        executorId: randomUUID(),
      };
      if (active) await sottoJobExecutions(database).begin(execution);
      await recordClassPreparationFailure(database, current, receipt.fingerprint, false);
      return execution;
    });
    return { cls, binding, target: { operationId: operation.id, classId: cls.id } };
  }

  it('removes only the exact unpublished failed class after execution drains and can confirm removal again', async () => {
    const { instance, courseId, execution, lesson } = context();
    const { cls, binding, target } = await fixture(true);
    const other = await instance.database.courseClass.create({
      data: { courseId, lessonId: (await lesson()).id, order: 2, status: 'AVAILABLE' },
    });
    await instance.database.course.update({
      where: { id: courseId },
      data: { activeClassId: cls.id },
    });
    await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/cleanup/i);
    await expect(
      requestClassPreparation(courseId, execution, {
        expectedPreviousPreparation: target,
      })
    ).rejects.toThrow(/cleanup/i);
    expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toMatchObject(
      { status: 'GENERATING' }
    );
    await sottoTransaction(instance.database, (database) =>
      sottoJobExecutions(database).settle(binding)
    );
    for (let confirmation = 0; confirmation < 2; confirmation++) {
      expect(await cancelClassPreparation(courseId, execution, target)).toMatchObject({
        id: target.operationId,
        status: 'FAILED',
      });
      expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toBeNull();
    }
    expect(
      await instance.database.courseClass.findUnique({ where: { id: other.id } })
    ).toMatchObject({ status: 'AVAILABLE' });
    expect(await instance.database.course.findUnique({ where: { id: courseId } })).toMatchObject({
      activeClassId: null,
    });
  });

  it('keeps an unpublished class when its speaking audio ownership cannot be verified', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    const section = await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'SPEAKING',
        status: 'READY',
        seed: 'speaking',
        spec: {},
      },
    });
    const prompt = await instance.database.speakingPrompt.create({
      data: {
        sectionId: section.id,
        order: 1,
        targetPhrase: 'Hola',
        translation: 'Hello',
        referenceTtsUrl: 'https://example.com/unverified-audio.mp3',
      },
    });

    await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/cleanup/i);
    expect(
      await instance.database.courseClass.findUnique({ where: { id: cls.id } })
    ).not.toBeNull();
    expect(
      await instance.database.speakingPrompt.findUnique({ where: { id: prompt.id } })
    ).not.toBeNull();
  });

  it('keeps an unpublished class when its worksheet ownership cannot be verified', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    const worksheetPdfUrl = 'https://example.com/unverified-worksheet.pdf';
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { worksheetPdfUrl },
    });

    await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/cleanup/i);
    expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toMatchObject(
      {
        worksheetPdfUrl,
      }
    );
  });

  it('retires verified speaking audio when removing an unpublished class', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    const section = await instance.database.classSection.create({
      data: { classId: cls.id, skill: 'SPEAKING', status: 'READY', seed: 'speech', spec: {} },
    });
    const prompt = await instance.database.speakingPrompt.create({
      data: { sectionId: section.id, order: 1, targetPhrase: 'Hola', translation: 'Hello' },
    });
    const storage = await captureStorageBackend();
    const key = `speaking-ref/${prompt.id}/${randomUUID()}.mp3`;
    const reference = await storage.writeBuffer(key, Buffer.from('audio'), 'audio/mpeg');
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, storage.descriptor);
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(backend);
      const course = await captureCourseStorage(database, courseId);
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [
          { consumer: `speaking-prompt:${prompt.id}:reference`, previousReference: null },
        ],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference,
          localRoutePrefix: LOCAL_STORAGE_URL_PREFIX,
          target: { backendId: backend.id, binding: backend.binding, key },
          scopes: [
            ...course.scopes,
            { subjectId: `class:${cls.id}`, generation: cls.createdAt.getTime() },
          ],
        }),
      });
      await database.speakingPrompt.update({
        where: { id: prompt.id },
        data: { referenceTtsUrl: reference },
      });
    });

    const cleanupFailure = vi
      .spyOn(storageRuntime, 'captureStorageCleanup')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(
      'storage unavailable'
    );
    cleanupFailure.mockRestore();
    expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toBeNull();
    await expect(cancelClassPreparation(courseId, execution, target)).resolves.toMatchObject({
      id: target.operationId,
      status: 'FAILED',
    });
    expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toBeNull();
    const assets = await instance.database.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM "SidedoorState"
      WHERE state->>'kind' = 'storage_asset' AND state->'consumers' ? ${`speaking-prompt:${prompt.id}:reference`}
    `;
    expect(assets[0]?.count).toBe(0n);
    await expect(cancelClassPreparation(courseId, execution, target)).resolves.toMatchObject({
      id: target.operationId,
      status: 'FAILED',
    });
    await sottoTransaction(instance.database, (database) =>
      eraseCompletedClassCleanupReceipts(database, execution.userId)
    );
    expect(
      await instance.database.sidedoorState.findUnique({
        where: { id: `${SIDEDOOR_STATE_ID}:class-cleanup:${cls.id}` },
      })
    ).toBeNull();
  });

  it('keeps the failed class when a replacement request is invalid', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    await expect(
      requestClassPreparation(courseId, execution, {
        expectedPreviousPreparation: target,
        timeZone: 'Invalid/TimeZone',
      })
    ).rejects.toThrow(/time zone/i);
    expect(
      await instance.database.courseClass.findUnique({ where: { id: cls.id } })
    ).not.toBeNull();
  });

  it('cancels an empty failed class even when storage is unavailable', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    const unavailable = vi
      .spyOn(storageRuntime, 'captureStorageBackend')
      .mockRejectedValue(new Error('storage unavailable'));
    try {
      await expect(cancelClassPreparation(courseId, execution, target)).resolves.toMatchObject({
        id: target.operationId,
        status: 'FAILED',
      });
      expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toBeNull();
      await expect(cancelClassPreparation(courseId, execution, target)).resolves.toMatchObject({
        id: target.operationId,
      });
    } finally {
      unavailable.mockRestore();
    }
  });

  it('keeps the failed class when speech configuration prevents a replacement', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    await instance.database.user.update({
      where: { id: execution.userId },
      data: { preferredTtsProvider: 'invalid-provider' },
    });
    await expect(
      requestClassPreparation(courseId, execution, { expectedPreviousPreparation: target })
    ).rejects.toThrow(/provider is invalid/i);
    expect(
      await instance.database.courseClass.findUnique({ where: { id: cls.id } })
    ).not.toBeNull();
  });

  it('does not replace a failed preparation when missing class media is ambiguous', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    await instance.database.courseClass.delete({ where: { id: cls.id } });
    await instance.database.episode.create({
      data: { userId: execution.userId, title: 'Listening', topic: 'Practice', source: 'CLASS' },
    });
    await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/cleanup/i);
    await expect(requestClassPreparation(courseId, execution)).rejects.toThrow(/cleanup/i);
    expect(await classPreparationStore(instance.database, courseId).read()).toMatchObject({
      id: target.operationId,
    });
  });

  it('allows recovery of a legacy removed class only when no related work or media remains', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    await instance.database.courseClass.delete({ where: { id: cls.id } });
    await expect(cancelClassPreparation(courseId, execution, target)).resolves.toMatchObject({
      id: target.operationId,
      status: 'FAILED',
    });
    const next = await requestClassPreparation(courseId, execution, {
      expectedPreviousPreparation: target,
    });
    expect(next.id).not.toBe(target.operationId);
  });

  it('keeps a legacy preparation when retained storage could belong to its missing class', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    await instance.database.courseClass.delete({ where: { id: cls.id } });
    await instance.database.sidedoorState.create({
      data: {
        id: `legacy-storage-${randomUUID()}`,
        revision: randomUUID(),
        state: {
          kind: 'storage_asset',
          prepared: { scopes: [{ subjectId: `course:${courseId}` }] },
        },
      },
    });
    await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/cleanup/i);
    expect(await classPreparationStore(instance.database, courseId).read()).toMatchObject({
      id: target.operationId,
    });
  });

  it('keeps a legacy preparation when an unscoped retirement has unknown ownership', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    await instance.database.courseClass.delete({ where: { id: cls.id } });
    await instance.database.sidedoorState.create({
      data: {
        id: `legacy-retirement-${randomUUID()}`,
        revision: randomUUID(),
        state: {
          schemaVersion: 1,
          kind: 'storage_reference_retirement',
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          consumer: `speaking-prompt:${randomUUID()}:reference`,
          previousReference: 'https://example.com/unknown.mp3',
          replacementAssetId: null,
          attribution: null,
          status: 'unresolved',
        },
      },
    });
    await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/cleanup/i);
  });

  it('keeps a legacy preparation when a cleanup manifest has no attributable parent', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    await instance.database.courseClass.delete({ where: { id: cls.id } });
    await instance.database.sidedoorState.create({
      data: {
        id: `orphan-manifest-${randomUUID()}`,
        revision: randomUUID(),
        state: {
          kind: 'storage_cleanup_manifest',
          namespace: SIDEDOOR_STATE_ID,
          jobId: randomUUID(),
          entries: [{ key: `speaking-ref/${randomUUID()}/audio.mp3` }],
        },
      },
    });
    await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/cleanup/i);
  });

  it('allows legacy recovery when retained storage is attributed to another course', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    await instance.database.courseClass.delete({ where: { id: cls.id } });
    const storage = await captureStorageBackend();
    const key = `unrelated/${randomUUID()}.mp3`;
    const reference = await storage.writeBuffer(key, Buffer.from('audio'), 'audio/mpeg');
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, storage.descriptor);
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(backend);
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [
          { consumer: 'speaking-prompt:another-prompt:reference', previousReference: null },
        ],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference,
          localRoutePrefix: LOCAL_STORAGE_URL_PREFIX,
          target: { backendId: backend.id, binding: backend.binding, key },
          scopes: [{ subjectId: 'course:another-course', generation: 1 }],
        }),
      });
    });
    await expect(cancelClassPreparation(courseId, execution, target)).resolves.toMatchObject({
      id: target.operationId,
    });
  });

  it('allows legacy recovery after another course completed its manifest cleanup', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    await instance.database.courseClass.delete({ where: { id: cls.id } });
    const storage = await captureStorageBackend();
    const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, storage.descriptor);
    const job = prepareStorageCleanup({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: 'course:another-course',
      generation: 1,
      retentionPolicy: 'job-id-snapshots-v1',
    });
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(backend);
      const journal = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
      await journal.createJob(job);
      await journal.registerCollectors(job.id, job.epoch, [
        {
          id: 'empty',
          kind: 'inventory',
          backendIds: [backend.id],
          scope: `empty/${job.id}`,
          match: 'key',
        },
      ]);
      await journal.recordManifestPage(job.id, job.epoch, {
        id: 'metadata',
        entries: [{ kind: 'non-storage' }],
      });
      await journal.resolveManifest(job.id, job.epoch, 'metadata', {
        resolver: 'test',
        entries: [{ index: 0, kind: 'non_storage', reason: 'No storage reference' }],
      });
    });
    await cleanupRuntime.runSottoStorageCleanup(instance.database, job.id);
    await expect(cancelClassPreparation(courseId, execution, target)).resolves.toMatchObject({
      id: target.operationId,
    });
  });

  it('keeps a legacy preparation if its missing class ID was reused by another course', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    await instance.database.courseClass.delete({ where: { id: cls.id } });
    const other = await instance.database.course.create({
      data: {
        userId: execution.userId,
        curriculumId: course.curriculumId,
        nativeLang: course.nativeLang,
        targetLang: 'fr',
      },
    });
    await instance.database.courseClass.create({
      data: {
        id: cls.id,
        courseId: other.id,
        lessonId: cls.lessonId,
        order: 1,
        status: 'AVAILABLE',
      },
    });
    await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/cleanup/i);
    expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toMatchObject(
      {
        courseId: other.id,
      }
    );
  });

  it('removes an attached listening episode even before its audio URL is published', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    const episode = await instance.database.episode.create({
      data: { userId: execution.userId, title: 'Listening', topic: 'Practice', source: 'CLASS' },
    });
    await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'LISTENING',
        status: 'GENERATING',
        seed: 'listening',
        spec: {},
        episodeId: episode.id,
      },
    });

    await cancelClassPreparation(courseId, execution, target);
    expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toBeNull();
    expect(await instance.database.episode.findUnique({ where: { id: episode.id } })).toBeNull();
  });

  it('waits for an unsettled speaking write before removing the unpublished class', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    const section = await instance.database.classSection.create({
      data: { classId: cls.id, skill: 'SPEAKING', status: 'READY', seed: 'speech', spec: {} },
    });
    const prompt = await instance.database.speakingPrompt.create({
      data: { sectionId: section.id, order: 1, targetPhrase: 'Hola', translation: 'Hello' },
    });
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    const location = {
      kind: 'object' as const,
      endpoint: 'https://storage.example',
      bucket: 'test',
    };
    const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, {
      kind: 'object',
      location,
      binding: storageBackendBinding(location),
    });
    const intent = prepareStorageWrite({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: `course:${courseId}`,
      generation: course.createdAt.getTime(),
      target: {
        backendId: backend.id,
        binding: backend.binding,
        key: `speaking-ref/${prompt.id}/${randomUUID()}`,
      },
    });
    const unrelated = prepareStorageWrite({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: `course:${courseId}`,
      generation: course.createdAt.getTime(),
      target: {
        backendId: backend.id,
        binding: backend.binding,
        key: `speaking-ref/${randomUUID()}/${randomUUID()}`,
      },
    });
    const journal = (database: Prisma.TransactionClient) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      return {
        backends: new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID),
        writes: new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID),
      };
    };
    await sottoTransaction(instance.database, async (database) => {
      await journal(database).backends.register(backend);
      await journal(database).writes.begin(intent, course.createdAt.getTime());
      await journal(database).writes.begin(unrelated, course.createdAt.getTime());
      await journal(database).writes.finish(unrelated, { kind: 'unreferenced' });
    });

    await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/cleanup/i);
    expect(
      await instance.database.courseClass.findUnique({ where: { id: cls.id } })
    ).not.toBeNull();
    await sottoTransaction(instance.database, (database) =>
      journal(database).writes.finish(intent, { kind: 'not_created' })
    );
    await cancelClassPreparation(courseId, execution, target);
    expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toBeNull();
    const remaining = await sottoTransaction(instance.database, (database) =>
      journal(database).writes.list(`course:${courseId}`)
    );
    expect(remaining.intents).toMatchObject([
      { operationId: unrelated.operationId, status: 'settled' },
    ]);
  });

  it('cleans a retained class storage write even when no URL was published', async () => {
    const { instance, courseId, execution } = context();
    const { cls, target } = await fixture();
    const storage = await captureStorageBackend();
    const key = `worksheets/${cls.id}/${randomUUID()}.pdf`;
    await storage.writeBuffer(key, Buffer.from('worksheet'), 'application/pdf');
    const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, storage.descriptor);
    const intent = prepareStorageWrite({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: `class:${cls.id}`,
      generation: cls.createdAt.getTime(),
      target: { backendId: backend.id, binding: backend.binding, key },
    });
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(backend);
      const writes = new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
      await writes.begin(intent, cls.createdAt.getTime());
      await writes.finish(intent, { kind: 'unreferenced' });
    });

    await cancelClassPreparation(courseId, execution, target);
    expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toBeNull();
    expect(await storage.has(key)).toBe(false);
  });

  it.each(['FAILED', 'CANCELLED'] as const)(
    'retries an exact %s initial preparation without retaining its unpublished class',
    async (status) => {
      const { instance, courseId, execution } = context();
      const { cls, target } = await fixture();
      await sottoTransaction(instance.database, (database) =>
        classPreparationStore(database, courseId).transact((state) => {
          if (!state) throw new Error('Missing preparation fixture');
          state.status = status;
        })
      );
      const next = await requestClassPreparation(courseId, execution, {
        expectedPreviousPreparation: target,
      });
      expect(next.id).not.toBe(target.operationId);
      expect(next.status).toBe('QUEUED');
      expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toBeNull();
    }
  );

  it.each(['operation', 'class', 'RUNNING', 'UNRESOLVED', 'published'] as const)(
    'rejects stale or unsafe %s targets without deleting or admitting work',
    async (change) => {
      const { instance, courseId, execution } = context();
      const { cls, target } = await fixture();
      if (change === 'operation') target.operationId = randomUUID();
      else if (change === 'class') target.classId = randomUUID();
      else
        await sottoTransaction(instance.database, (database) =>
          classPreparationStore(database, courseId).transact((state) => {
            if (!state) throw new Error('Missing preparation fixture');
            if (change === 'published') state.result = 'created';
            else state.status = change;
          })
        );
      await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/changed/i);
      await expect(
        requestClassPreparation(courseId, execution, { expectedPreviousPreparation: target })
      ).rejects.toThrow(/changed/i);
      expect(
        await instance.database.courseClass.findUnique({ where: { id: cls.id } })
      ).toMatchObject({ status: 'GENERATING' });
      expect(
        (await instance.database.courseClass.findMany({ where: { courseId } })).map((row) => row.id)
      ).toEqual([cls.id]);
    }
  );

  it('keeps failed regeneration material outside initial preparation cleanup and next admission', async () => {
    const { instance, courseId, execution, lesson } = context();
    const cls = await instance.database.courseClass.create({
      data: { courseId, lessonId: (await lesson()).id, order: 1, status: 'FAILED' },
    });
    const operation = await requestClassPreparation(courseId, execution, {
      intent: { kind: 'REGENERATE', classId: cls.id, expectedAttempt: 1 },
    });
    await sottoTransaction(instance.database, async (database) => {
      const receipt = await sottoJobOutbox(database).read(operation.id);
      if (!receipt) throw new Error('Missing preparation receipt');
      await recordClassPreparationFailure(database, operation, receipt.fingerprint, false);
    });
    const target = { operationId: operation.id, classId: cls.id };
    await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/changed/);
    await expect(
      requestClassPreparation(courseId, execution, { expectedPreviousPreparation: target })
    ).rejects.toThrow(/changed/);
    expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toMatchObject(
      { status: 'GENERATING', attempt: 2 }
    );
    expect(await readClassPreparation(courseId, execution.userId)).not.toHaveProperty(
      'initialPreparation'
    );
  });

  it.each(['AVAILABLE', 'FAILED'] as const)(
    'retains a %s class that is no longer an unpublished generation',
    async (status) => {
      const { instance, courseId, execution } = context();
      const { cls, target } = await fixture();
      await instance.database.courseClass.update({ where: { id: cls.id }, data: { status } });
      await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/cleanup/);
      await expect(
        requestClassPreparation(courseId, execution, { expectedPreviousPreparation: target })
      ).rejects.toThrow(/changed/);
      await expect(requestClassPreparation(courseId, execution)).rejects.toThrow(/cleanup/i);
      expect(
        await instance.database.courseClass.findUnique({ where: { id: cls.id } })
      ).toMatchObject({ status });
    }
  );

  it.each(
    (['REGENERATE', 'REPAIR'] as const).flatMap((kind) =>
      (['FAILED', 'CANCELLED', 'UNRESOLVED'] as const).map((status) => ({ kind, status }))
    )
  )(
    'reconciles $status $kind only after confirmed execution cleanup and preserves its material',
    async ({ kind, status }) => {
      const { instance, courseId, execution, lesson } = context();
      const cls = await instance.database.courseClass.create({
        data: { courseId, lessonId: (await lesson()).id, order: 1, status: 'FAILED' },
      });
      const operation = await requestClassPreparation(courseId, execution, {
        intent: { kind, classId: cls.id, expectedAttempt: 1 },
      });
      const section = await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'GRAMMAR',
          attempt: 2,
          status: 'READY',
          seed: 'retained-worked-example',
          spec: { example: 'Ich finde das gut, weil es hilft.' },
        },
      });
      const binding = await sottoTransaction(instance.database, async (database) => {
        const receipt = await sottoJobOutbox(database).read(operation.id);
        if (!receipt) throw new Error('Missing preparation receipt');
        const active = {
          id: randomUUID(),
          parentId: operation.id,
          fingerprint: receipt.fingerprint,
          executorId: randomUUID(),
        };
        await sottoJobExecutions(database).begin(active);
        await classPreparationStore(database, courseId).transact((state) => {
          if (!state) throw new Error('Missing preparation fixture');
          state.status = status === 'CANCELLED' ? 'CANCELLING' : 'RUNNING';
        });
        await recordClassPreparationFailure(
          database,
          operation,
          receipt.fingerprint,
          status === 'UNRESOLVED'
        );
        return active;
      });
      expect(await readClassPreparation(courseId, execution.userId)).toMatchObject({
        id: operation.id,
        status,
      });
      expect(
        await instance.database.courseClass.findUnique({ where: { id: cls.id } })
      ).toMatchObject({ status: 'GENERATING', attempt: 2 });
      await sottoTransaction(instance.database, (database) =>
        sottoJobExecutions(database).settle(binding)
      );
      expect(await readClassPreparation(courseId, execution.userId)).toMatchObject({
        id: operation.id,
        status,
      });
      expect(
        await instance.database.courseClass.findUnique({ where: { id: cls.id } })
      ).toMatchObject({
        status: status === 'UNRESOLVED' ? 'GENERATING' : 'FAILED',
        attempt: 2,
      });
      expect(
        await instance.database.classSection.findUnique({ where: { id: section.id } })
      ).toMatchObject({
        status: 'READY',
        seed: 'retained-worked-example',
        spec: { example: 'Ich finde das gut, weil es hilft.' },
      });
    }
  );
}
