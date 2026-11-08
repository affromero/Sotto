import { expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  LocalStorageCleanup,
  StorageBackendRegistry,
  StorageCleanupJournal,
  StorageReferenceRegistry,
  StorageWriteJournal,
  prepareStorageBackend,
  prepareStorageReference,
} from 'thesidedoor-core/storage';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import { Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { assessmentFenceStateId } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { capturedLocalBackend } from '@/lib/storage/sidedoor/captured-local';
import { LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { authorizedLearnerExecution } from '../../../../../helpers/runtime/provider-execution';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';

interface OutcomeDeletionContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  classId: string;
  cls: { courseId: string };
  fence: ReturnType<typeof assessmentWorkSchema.parse>['fence'];
  operation: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  mode: string;
  root: string;
  assessmentArchiveId: typeof import('@/lib/learning/classes/history/assessment-archive').assessmentArchiveId;
}

export async function checkAssessmentOutcomeDeletion({
  instance,
  identity,
  classId,
  cls,
  fence,
  operation,
  execution,
  mode,
  root,
  assessmentArchiveId,
}: OutcomeDeletionContext) {
  const { inspectPrerequisiteDeletion } = await import('@/lib/classes/help/prerequisite-deletion');
  const { admitLearningStorageDeletion } =
    await import('@/lib/sidedoor/access/deletion/learning-deletion');
  const heldOut = await instance.database.writingPrompt.findFirstOrThrow({
    where: { assessmentSection: { assessmentId: fence.assessmentId } },
  });
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const stale = instance.database
    .$transaction(
      async (tx) => {
        await tx.classAssessment.findUniqueOrThrow({ where: { id: fence.assessmentId } });
        started();
        await gate;
        return inspectPrerequisiteDeletion(tx, classId, cls.courseId, identity.ownerId);
      },
      { isolationLevel: 'Serializable', timeout: 15000 }
    )
    .then(
      () => null,
      (error: unknown) => error
    );
  await ready;
  let response;
  try {
    response = await instance.database.writingResponse.create({
      data: {
        promptId: heldOut.id,
        assessmentSectionId: heldOut.assessmentSectionId,
        userId: identity.ownerId,
        text: 'Respuesta',
      },
    });
  } finally {
    release();
  }
  expect(isSerializationConflict(await stale)).toBe(true);
  await expect(
    sottoTransaction(instance.database, (tx) =>
      inspectPrerequisiteDeletion(tx, classId, cls.courseId, identity.ownerId)
    )
  ).rejects.toThrow('active or requires recovery');
  await instance.database.writingResponse.delete({ where: { id: response.id } });
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await sottoJobOutbox(tx).enqueue(
        prepareJob({
          id: randomUUID(),
          namespace: SIDEDOOR_STATE_ID,
          handler: 'learning-writing',
          version: 1,
          payload: { promptId: heldOut.id },
          scopes: fence.ownership.scopes,
          delivery: { attempts: 1, priority: 0, availableAt: 0 },
        })
      );
      await expect(
        inspectPrerequisiteDeletion(tx, classId, cls.courseId, identity.ownerId)
      ).rejects.toThrow('active or requires recovery');
      throw new Error('Roll back retained writing job fixture');
    })
  ).rejects.toThrow('Roll back retained writing job fixture');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await sottoJobOutbox(tx).enqueue(
        prepareJob({
          id: randomUUID(),
          namespace: SIDEDOOR_STATE_ID,
          handler: 'interactions',
          version: 6,
          payload: {},
          scopes: fence.ownership.scopes,
          delivery: { attempts: 1, priority: 0, availableAt: 0 },
        })
      );
      await expect(
        inspectPrerequisiteDeletion(tx, classId, cls.courseId, identity.ownerId)
      ).rejects.toThrow('active or requires recovery');
      throw new Error('Roll back orphan assessment job fixture');
    })
  ).rejects.toThrow('Roll back orphan assessment job fixture');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      const section = await tx.classAssessmentSection.findFirstOrThrow({
        where: { assessmentId: fence.assessmentId },
      });
      await tx.episode.create({
        data: {
          userId: identity.ownerId,
          title: 'Unlinked assessment audio',
          topic: 'Test',
          assessmentAudioAssessmentId: fence.assessmentId,
          assessmentAudioSectionId: section.id,
          assessmentAudioOperationId: operation.id,
        },
      });
      await expect(
        inspectPrerequisiteDeletion(tx, classId, cls.courseId, identity.ownerId)
      ).rejects.toThrow('active or requires recovery');
      throw new Error('Roll back orphan assessment audio fixture');
    })
  ).rejects.toThrow('Roll back orphan assessment audio fixture');
  const course = await instance.database.course.findUniqueOrThrow({
    where: { id: cls.courseId },
  });
  const owner = await instance.database.user.findUniqueOrThrow({
    where: { id: identity.ownerId },
  });
  const backend = await capturedLocalBackend(
    await LocalStorageCleanup.capture(root),
    root,
    LOCAL_STORAGE_URL_PREFIX,
    () => {}
  );
  if (mode === 'class_deletion') {
    const storage = await import('@/lib/r2');
    const capture = vi.spyOn(storage, 'captureStorageBackend').mockResolvedValue(backend);
    const runtime = await import('@/lib/sidedoor/storage/migration/storage-cleanup-runtime');
    const cleanup = vi
      .spyOn(runtime, 'runSottoStorageCleanup')
      .mockRejectedValueOnce(new Error('Cleanup acknowledgement lost'));
    try {
      const { deleteClassForUser } = await import('@/lib/class-service');
      const worksheetKey = `worksheets/${classId}/fixture.pdf`;
      const worksheetReference = await backend.writeBuffer(
        worksheetKey,
        Buffer.from('worksheet fixture'),
        'application/pdf'
      );
      const worksheetConsumer = `class:${classId}:worksheet`;
      const worksheetRegistry = (tx: Prisma.TransactionClient) => {
        const executor = {
          query: (sql: string, values: readonly unknown[]) =>
            tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        };
        return {
          backends: new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID),
          references: new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID),
        };
      };
      await sottoTransaction(instance.database, async (tx) => {
        const registry = worksheetRegistry(tx);
        const registered = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
        await registry.backends.register(registered);
        const ownership = await captureCourseStorage(tx, course.id);
        await registry.references.replaceMany({
          consumers: [{ consumer: worksheetConsumer, previousReference: null }],
          next: prepareStorageReference({
            namespace: SIDEDOOR_STATE_ID,
            operationId: randomUUID(),
            reference: worksheetReference,
            localRoutePrefix: LOCAL_STORAGE_URL_PREFIX,
            target: {
              backendId: registered.id,
              binding: registered.binding,
              key: worksheetKey,
            },
            scopes: ownership.scopes,
          }),
        });
        await tx.courseClass.update({
          where: { id: classId },
          data: { worksheetPdfUrl: worksheetReference },
        });
      });
      await expect(deleteClassForUser(classId, owner.id, execution)).rejects.toThrow(
        'worksheet that requires complete media cleanup'
      );
      expect(await backend.has(worksheetKey)).toBe(true);
      await sottoTransaction(instance.database, async (tx) => {
        const registry = worksheetRegistry(tx).references;
        expect(
          await registry.resolve({
            consumer: worksheetConsumer,
            reference: worksheetReference,
          })
        ).not.toBeNull();
        await registry.retire({
          operationId: randomUUID(),
          consumer: worksheetConsumer,
          previousReference: worksheetReference,
        });
        await tx.courseClass.update({
          where: { id: classId },
          data: { worksheetPdfUrl: null },
        });
      });
      const formativeSection = await instance.database.classSection.findFirstOrThrow({
        where: { classId, skill: 'GRAMMAR' },
      });
      const formativePrompt = await instance.database.speakingPrompt.create({
        data: {
          sectionId: formativeSection.id,
          order: 1,
          targetPhrase: 'Привет',
          translation: 'Hola',
          referenceTtsUrl: '/api/storage/formative-reference',
        },
      });
      await expect(deleteClassForUser(classId, owner.id, execution)).rejects.toThrow(
        'speaking audio that requires complete media cleanup'
      );
      await instance.database.speakingPrompt.update({
        where: { id: formativePrompt.id },
        data: { referenceTtsUrl: null },
      });
      const recording = await instance.database.speakingRecording.create({
        data: {
          sectionId: formativeSection.id,
          promptId: formativePrompt.id,
          userId: owner.id,
          audioUrl: '/api/storage/formative-recording',
        },
      });
      await expect(deleteClassForUser(classId, owner.id, execution)).rejects.toThrow(
        'speaking audio that requires complete media cleanup'
      );
      expect(
        await instance.database.speakingRecording.findUnique({
          where: { id: recording.id },
        })
      ).not.toBeNull();
      await instance.database.speakingRecording.delete({ where: { id: recording.id } });
      const externalPrompt = await instance.database.speakingPrompt.create({
        data: { order: 0, targetPhrase: 'Спасибо', translation: 'Gracias' },
      });
      const crossLinked = await instance.database.speakingRecording.create({
        data: {
          sectionId: formativeSection.id,
          promptId: externalPrompt.id,
          userId: owner.id,
          audioUrl: '/api/storage/cross-linked-recording',
        },
      });
      await expect(deleteClassForUser(classId, owner.id, execution)).rejects.toThrow(
        'speaking audio that requires complete media cleanup'
      );
      expect(
        await instance.database.speakingRecording.findUnique({
          where: { id: crossLinked.id },
        })
      ).not.toBeNull();
      await instance.database.speakingRecording.delete({ where: { id: crossLinked.id } });
      await instance.database.speakingPrompt.delete({ where: { id: externalPrompt.id } });
      await instance.database.speakingPrompt.delete({
        where: { id: formativePrompt.id },
      });
      expect(await deleteClassForUser(classId, owner.id, execution)).toBe(true);
      expect(await instance.database.courseClass.findUnique({ where: { id: classId } })).toBeNull();
      expect(
        await instance.database.classAssessment.findUnique({
          where: { id: fence.assessmentId },
        })
      ).toBeNull();
      expect(
        await instance.database.course.findUnique({ where: { id: course.id } })
      ).not.toBeNull();
      expect(
        await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).receipt(operation.id))
      ).toMatchObject({ status: 'erased', fingerprint: operation.fingerprint });
      expect(
        await instance.database.sidedoorState.findUnique({
          where: { id: `${SIDEDOOR_STATE_ID}:assessment-grant:${operation.id}` },
        })
      ).toBeNull();
      expect(
        await instance.database.sidedoorState.findUnique({
          where: { id: assessmentFenceStateId(classId) },
        })
      ).toBeNull();
      expect(
        await instance.database.sidedoorState.findUnique({
          where: { id: assessmentArchiveId(operation.id) },
        })
      ).toBeNull();
      const cleanupPhase = () =>
        sottoTransaction(instance.database, async (tx) => {
          const executor = {
            query: (sql: string, values: readonly unknown[]) =>
              tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          };
          const tombstone = await new StorageWriteJournal(
            executor,
            'postgres',
            SIDEDOOR_STATE_ID
          ).tombstone(`class:${classId}`);
          if (!tombstone) throw new Error('Class cleanup tombstone missing');
          return (
            await new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID).get(
              tombstone.jobId
            )
          ).phase;
        });
      expect(await cleanupPhase()).not.toBe('complete');
      expect(await deleteClassForUser(classId, owner.id, execution)).toBe(true);
      expect(await cleanupPhase()).toBe('complete');
      const other = await identity.household('Another learner');
      expect(
        await deleteClassForUser(classId, other.id, authorizedLearnerExecution(other.id))
      ).toBe(false);
    } finally {
      cleanup.mockRestore();
      capture.mockRestore();
    }
    return;
  }
  await sottoTransaction(instance.database, async (tx) => {
    await admitLearningStorageDeletion({
      database: tx,
      scope:
        mode === 'profile_deletion'
          ? { kind: 'profile', id: owner.id }
          : { kind: 'course', id: course.id, episodeIds: [] },
      subjects: [
        mode === 'profile_deletion'
          ? { subjectId: `profile:${owner.id}`, generation: owner.createdAt.getTime() }
          : { subjectId: `course:${course.id}`, generation: course.createdAt.getTime() },
      ],
      currentBackend: backend,
    });
    if (mode === 'profile_deletion') await tx.user.delete({ where: { id: owner.id } });
    else await tx.course.delete({ where: { id: course.id } });
  });
  expect(await instance.database.course.findUnique({ where: { id: course.id } })).toBeNull();
  expect(
    await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).receipt(operation.id))
  ).toMatchObject({ status: 'erased', fingerprint: operation.fingerprint });
  expect(
    await instance.database.sidedoorState.findUnique({
      where: { id: `${SIDEDOOR_STATE_ID}:assessment-grant:${operation.id}` },
    })
  ).toBeNull();
  expect(
    await instance.database.sidedoorState.findUnique({
      where: { id: assessmentArchiveId(operation.id) },
    })
  ).toBeNull();
  return;
}
