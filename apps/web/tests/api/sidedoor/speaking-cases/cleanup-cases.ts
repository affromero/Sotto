import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Prisma } from '@/generated/prisma/client';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { processSpeakingGrading } from '@/workers/speaking-grading.worker';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { captureStorageBackend, LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { deleteClassForUser } from '@/lib/class-service';
import { admitPrerequisiteWork } from '@/lib/classes/help/lifecycle/prerequisite-admission';
import {
  failPrerequisiteWork,
  startPrerequisiteWork,
} from '@/lib/classes/help/prerequisite-outcome';
import { eraseCompletedClassCleanupReceipts } from '@/lib/classes/help/prerequisite-deletion';
import { type Job } from 'bullmq';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import {
  StorageReferenceRegistry,
  StorageBackendRegistry,
  prepareStorageBackend,
  prepareStorageReference,
} from 'thesidedoor-core/storage';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../helpers/setup/shared-instance';
import type { createSpeakingRecording } from '@/lib/sidedoor/storage/publication/speaking-recording-upload';

interface SpeakingCleanupContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  classId: string;
  sectionId: string;
  gate: (acknowledged: boolean) => Promise<unknown>;
  upload: () => ReturnType<typeof createSpeakingRecording>;
}

export function registerSpeakingCleanupCases(getContext: () => SpeakingCleanupContext) {
  it('keeps a legacy class when its generation status changed before cancellation', async () => {
    const { instance, identity, classId } = getContext();
    const cls = await instance.database.courseClass.update({
      where: { id: classId },
      data: { status: 'GENERATING' },
    });
    const expected = {
      courseId: cls.courseId,
      createdAt: cls.createdAt.getTime(),
      attempt: cls.attempt,
    };
    const execution = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { status: 'AVAILABLE' },
    });
    await expect(
      deleteClassForUser(classId, identity.ownerId, execution, undefined, expected)
    ).rejects.toThrow();
    expect(
      await instance.database.courseClass.findUnique({ where: { id: classId } })
    ).toMatchObject({
      status: 'AVAILABLE',
    });
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { status: 'GENERATING' },
    });
    await expect(
      deleteClassForUser(classId, identity.ownerId, execution, undefined, expected)
    ).resolves.toBe(true);
    expect(await instance.database.courseClass.findUnique({ where: { id: classId } })).toBeNull();
  });

  it('retries interrupted class listening cleanup and removes the episode audio', async () => {
    const { instance, identity, classId } = getContext();
    const episode = await instance.database.episode.create({
      data: { userId: identity.ownerId, title: 'Listening', topic: 'Practice', source: 'CLASS' },
    });
    await instance.database.classSection.create({
      data: {
        classId,
        skill: 'LISTENING',
        attempt: 1,
        status: 'READY',
        seed: 'listening',
        spec: {},
        episodeId: episode.id,
      },
    });
    const storage = await captureStorageBackend();
    const key = `episodes/${episode.id}/${randomUUID()}.wav`;
    const reference = await storage.writeBuffer(key, Buffer.from('listening'), 'audio/wav');
    const other = await identity.household('Other learner');
    const sharedKey = `episodes/${episode.id}/${randomUUID()}.pdf`;
    const sharedReference = await storage.writeBuffer(
      sharedKey,
      Buffer.from('shared'),
      'application/pdf'
    );
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, storage.descriptor);
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(backend);
      const ownership = await captureEpisodeStorage(database, episode.id);
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [{ consumer: `episode:${episode.id}:audio`, previousReference: null }],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference,
          localRoutePrefix: LOCAL_STORAGE_URL_PREFIX,
          target: { backendId: backend.id, binding: backend.binding, key },
          scopes: ownership.scopes,
        }),
      });
      const otherProfile = await database.user.findUniqueOrThrow({ where: { id: other.id } });
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [
          { consumer: `episode:${episode.id}:transcript`, previousReference: null },
          { consumer: `profile:${other.id}:avatar`, previousReference: null },
        ],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference: sharedReference,
          localRoutePrefix: LOCAL_STORAGE_URL_PREFIX,
          target: { backendId: backend.id, binding: backend.binding, key: sharedKey },
          scopes: [
            ...ownership.scopes,
            { subjectId: `profile:${other.id}`, generation: otherProfile.createdAt.getTime() },
          ],
        }),
      });
      await database.episode.update({
        where: { id: episode.id },
        data: { audioUrl: reference, pdfUrl: sharedReference },
      });
      await database.user.update({ where: { id: other.id }, data: { image: sharedReference } });
    });
    const job = await sottoTransaction(instance.database, async (database) => {
      const ownership = await captureEpisodeStorage(database, episode.id);
      const record = await sottoJobOutbox(database).enqueue(
        prepareJob({
          namespace: SIDEDOOR_STATE_ID,
          handler: 'audio-generation',
          version: 1,
          payload: { episodeId: episode.id },
          scopes: ownership.scopes,
          delivery: { attempts: 1, priority: 0, availableAt: 0 },
        })
      );
      const snapshot = sottoJobSnapshot(database);
      await snapshot.createForJob({ id: record.job.id, fingerprint: record.fingerprint });
      await snapshot.append(record.job.id, record.fingerprint, 0, [{ text: 'Private lesson' }]);
      await snapshot.seal(record.job.id, record.fingerprint);
      await sottoJobOutbox(database).complete(record.job.id, record.fingerprint);
      const transcript = await sottoJobOutbox(database).enqueue(
        prepareJob({
          namespace: SIDEDOOR_STATE_ID,
          handler: 'pdf-generation',
          version: 2,
          payload: {
            episodeId: episode.id,
            requesterId: identity.ownerId,
            storage: ownership,
            delegation: ownership,
            source: {},
          },
          scopes: ownership.scopes,
          delivery: { attempts: 1, priority: 0, availableAt: 0 },
        })
      );
      await sottoJobOutbox(database).complete(transcript.job.id, transcript.fingerprint);
      const effects = [];
      for (const handler of [
        'pdf-generation',
        'waveform-generation',
        'notifications',
        'episode-status',
      ]) {
        const effect = await sottoJobOutbox(database).enqueue(
          prepareJob({
            namespace: SIDEDOOR_STATE_ID,
            handler,
            version: 1,
            payload: { episodeId: episode.id },
            scopes: ownership.scopes,
            delivery: { attempts: 1, priority: 0, availableAt: 0 },
          })
        );
        await sottoJobOutbox(database).complete(effect.job.id, effect.fingerprint);
        effects.push(effect);
      }
      return { record, transcript, effects };
    });
    const runtime = await import('@/lib/sidedoor/storage/migration/storage-cleanup-runtime');
    const { openSottoStorageConnection } =
      await import('@/lib/sidedoor/storage/core/storage-connection');
    const runCleanup = runtime.runSottoStorageCleanup;
    let calls = 0;
    const cleanup = vi
      .spyOn(runtime, 'runSottoStorageCleanup')
      .mockImplementation((database, jobId, options) => {
        calls += 1;
        if (calls === 2) return Promise.reject(new Error('Synthetic cleanup interruption'));
        return runCleanup(database, jobId, {
          ...options,
          openConnection: () =>
            openSottoStorageConnection(process.env.SIDEDOOR_TEST_DATABASE_URL, instance.schema),
        });
      });
    const execution = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    try {
      expect(await deleteClassForUser(classId, identity.ownerId, execution)).toBe(true);
      expect(await instance.database.episode.findUnique({ where: { id: episode.id } })).toBeNull();
      expect(await storage.has(key)).toBe(true);
      await expect(
        sottoTransaction(instance.database, (database) =>
          eraseCompletedClassCleanupReceipts(database, identity.ownerId)
        )
      ).rejects.toThrow('Finish pending class cleanup');
      expect(
        await deleteClassForUser(classId, other.id, {
          userId: other.id,
          authorize: async () => ({ userId: other.id }),
        })
      ).toBe(false);
      expect(await deleteClassForUser(classId, identity.ownerId, execution)).toBe(true);
      expect(await storage.has(key)).toBe(false);
      expect(await storage.has(sharedKey)).toBe(true);
      await sottoTransaction(instance.database, (database) =>
        eraseCompletedClassCleanupReceipts(database, identity.ownerId)
      );
      expect(
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).receipt(job.record.job.id)
        )
      ).toMatchObject({ status: 'erased', fingerprint: job.record.fingerprint });
      expect(
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).receipt(job.transcript.job.id)
        )
      ).toMatchObject({ status: 'erased', fingerprint: job.transcript.fingerprint });
      for (const effect of job.effects)
        expect(
          await sottoTransaction(instance.database, (database) =>
            sottoJobOutbox(database).receipt(effect.job.id)
          )
        ).toMatchObject({ status: 'erased', fingerprint: effect.fingerprint });
      await expect(
        sottoTransaction(instance.database, (database) =>
          sottoJobSnapshot(database).read(job.record.job.id, job.record.fingerprint, 0)
        )
      ).rejects.toThrow();
    } finally {
      cleanup.mockRestore();
    }
  });

  it('recovers interrupted class cleanup after deleting completed speaking audio', async () => {
    const { instance, identity, classId, sectionId, gate, upload } = getContext();
    const directory = await mkdtemp(join(tmpdir(), 'sotto-speaking-class-delete-'));
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
    try {
      await gate(true);
      const recording = await upload();
      const execution = {
        userId: identity.ownerId,
        authorize: async () => ({ userId: identity.ownerId }),
      };
      await expect(deleteClassForUser(classId, identity.ownerId, execution)).rejects.toThrow(
        'active or requires recovery'
      );
      expect(
        await instance.database.courseClass.findUnique({ where: { id: classId } })
      ).not.toBeNull();
      const job = {
        id: recording.operationId,
        name: 'speaking-grading.v2',
        data: { operationId: recording.operationId, fingerprint: recording.fingerprint },
        updateProgress: vi.fn(),
      } as unknown as Job<unknown>;
      await processSpeakingGrading(job);
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { prerequisiteGate: Prisma.DbNull },
      });
      await instance.database.speakingPrompt.createMany({
        data: Array.from({ length: 3 }, (_, index) => ({
          sectionId,
          order: index + 2,
          targetPhrase: `Hola ${index}`,
          translation: 'Hello',
        })),
      });
      for (const skill of ['GRAMMAR', 'READING'] as const) {
        const section = await instance.database.classSection.create({
          data: { classId, skill, attempt: 1, status: 'READY', seed: 'fixture', spec: {} },
        });
        await instance.database.lessonQuestion.createMany({
          data: Array.from({ length: 5 }, (_, index) => ({
            sectionId: section.id,
            skill,
            order: index + 1,
            question: `Question ${index}`,
            options: ['One', 'Two', 'Three', 'Four'],
            correctIndex: 0,
            explanation: 'Explanation',
            ...(skill === 'READING' ? { passageText: 'A short passage.' } : {}),
          })),
        });
      }
      const writing = await instance.database.classSection.create({
        data: { classId, skill: 'WRITING', attempt: 1, status: 'READY', seed: 'fixture', spec: {} },
      });
      await instance.database.writingPrompt.createMany({
        data: Array.from({ length: 3 }, (_, index) => ({
          sectionId: writing.id,
          order: index + 1,
          task: `Write ${index}`,
        })),
      });
      const prerequisite = await sottoTransaction(instance.database, (database) =>
        admitPrerequisiteWork(database, {
          id: randomUUID(),
          revision: randomUUID(),
          classId,
          userId: identity.ownerId,
          expiresAt: Date.now() + 60_000,
          selection: {
            provider: 'fixture',
            model: 'fixture',
            credentialFingerprint: null,
            moderationCredentialFingerprint: null,
          },
          authorize: execution.authorize,
        })
      );
      const operation = { id: prerequisite.job.id, fingerprint: prerequisite.fingerprint };
      await sottoTransaction(instance.database, (database) =>
        startPrerequisiteWork(database, operation)
      );
      await sottoTransaction(instance.database, (database) =>
        failPrerequisiteWork(database, operation, false)
      );
      const retained = await instance.database.speakingRecording.findUniqueOrThrow({
        where: { id: recording.id },
      });
      const storage = await captureStorageBackend();
      expect(await storage.has(storage.normalize(retained.audioUrl))).toBe(true);
      await sottoTransaction(instance.database, async (database) => {
        const registry = new StorageReferenceRegistry(
          {
            query: (sql, values) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          },
          'postgres',
          SIDEDOOR_STATE_ID
        );
        expect(
          await registry.resolve({
            consumer: `recording:${recording.id}:audio`,
            reference: retained.audioUrl,
          })
        ).not.toBeNull();
      });
      const runtime = await import('@/lib/sidedoor/storage/migration/storage-cleanup-runtime');
      const { openSottoStorageConnection } =
        await import('@/lib/sidedoor/storage/core/storage-connection');
      const runCleanup = runtime.runSottoStorageCleanup;
      const cleanup = vi
        .spyOn(runtime, 'runSottoStorageCleanup')
        .mockRejectedValueOnce(new Error('Synthetic cleanup interruption'))
        .mockImplementation((database, jobId, options) =>
          runCleanup(database, jobId, {
            ...options,
            openConnection: () =>
              openSottoStorageConnection(process.env.SIDEDOOR_TEST_DATABASE_URL, instance.schema),
          })
        );
      try {
        expect(await deleteClassForUser(classId, identity.ownerId, execution)).toBe(true);
        expect(await storage.has(storage.normalize(retained.audioUrl))).toBe(true);
        expect(
          await instance.database.courseClass.findUnique({ where: { id: classId } })
        ).toBeNull();
        expect(
          await sottoTransaction(instance.database, (database) =>
            sottoJobOutbox(database).receipt(recording.operationId)
          )
        ).toMatchObject({ status: 'erased', fingerprint: recording.fingerprint });
        expect(await deleteClassForUser(classId, identity.ownerId, execution)).toBe(true);
        expect(await storage.has(storage.normalize(retained.audioUrl))).toBe(false);
      } finally {
        cleanup.mockRestore();
      }
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
