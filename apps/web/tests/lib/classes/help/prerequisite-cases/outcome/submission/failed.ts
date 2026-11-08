import { expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  LocalStorageCleanup,
  StorageBackendRegistry,
  StorageCleanupJournal,
  StorageReferenceRegistry,
  prepareStorageBackend,
  prepareStorageCleanup,
} from 'thesidedoor-core/storage';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { readPrerequisiteSource } from '@/lib/classes/help/content/prerequisite-source';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { admitAssessmentWork } from '@/lib/learning/classes/generation/assessment-admission';
import { AssessmentFenceConflict } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { readAssessmentStatus } from '@/lib/learning/classes/lifecycle/assessment-status';
import { capturedLocalBackend } from '@/lib/storage/sidedoor/captured-local';
import { LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { authorizedLearnerExecution } from '../../../../../../helpers/runtime/provider-execution';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';
import type { submitAssessment } from '@/lib/learning/classes/lifecycle/assessment-submission';
import type { captureFailedAssessmentReceipt } from '@/lib/learning/classes/history/assessment-failed-receipt';
import type { readVerifiedHistoricalAssessmentGeneration } from '@/lib/learning/classes/lifecycle/assessment-outcome';

interface FailedSubmissionContext {
  failedReceipt: () => ReturnType<typeof captureFailedAssessmentReceipt>;
  fence: ReturnType<typeof assessmentWorkSchema.parse>['fence'];
  first: Awaited<ReturnType<typeof submitAssessment>>;
  mode: 'submission_fail' | 'submission_speaking_fail';
  instance: SharedTestInstance;
  cls: { courseId: string; attempt: number };
  identity: SharedTestIdentity;
  selectedMode: string;
  root: string;
  classId: string;
  execution: SottoProviderExecution;
  submitAssessment: typeof submitAssessment;
  submission: Parameters<typeof submitAssessment>[0];
  changedChoices: Array<{ itemId: string; selectedIndex: number }>;
  other: { id: string };
  history: Awaited<ReturnType<typeof readVerifiedHistoricalAssessmentGeneration>>;
  assessmentArchiveId: typeof import('@/lib/learning/classes/history/assessment-archive').assessmentArchiveId;
  operation: { id: string; fingerprint: string };
  priorQuestion: { id: string };
  captureFailedAssessmentReceipt: typeof captureFailedAssessmentReceipt;
  scored: { id: string };
}

export async function checkFailedAssessmentSubmission({
  failedReceipt,
  fence,
  first,
  mode,
  instance,
  cls,
  identity,
  selectedMode,
  root,
  classId,
  execution,
  submitAssessment,
  submission,
  changedChoices,
  other,
  history,
  assessmentArchiveId,
  operation,
  priorQuestion,
  captureFailedAssessmentReceipt,
  scored,
}: FailedSubmissionContext) {
  let relocatedSourcePath: string | null = null;
  let migratedCopyId: string | null = null;

  expect(await failedReceipt()).toMatchObject({
    assessmentId: fence.assessmentId,
    assessmentAttempt: fence.assessmentAttempt,
    operation,
    failedSkills: first.sections
      .filter((section) => !section.passed)
      .map((section) => section.skill),
  });
  if (mode === 'submission_speaking_fail') {
    const {
      eraseAssessmentSpeakingForDeletion,
      inspectAssessmentSpeakingForDeletion,
      reconcileAssessmentSpeakingDeletionScopes,
      verifyAssessmentSpeakingForDeletion,
    } = await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-deletion');
    const saved = await instance.database.classAssessmentProductiveEvidence.findFirstOrThrow({
      where: { assessmentId: fence.assessmentId, speakingRecordingId: { not: null } },
    });
    if (!saved.speakingRecordingId) throw new Error('Missing speaking recording');
    const verification = {
      classId,
      courseId: cls.courseId,
      userId: identity.ownerId,
      assessmentId: fence.assessmentId,
      recordingId: saved.speakingRecordingId,
      operationId: saved.operationId,
      fingerprint: saved.operationFingerprint,
    };
    await expect(
      sottoTransaction(instance.database, (tx) =>
        verifyAssessmentSpeakingForDeletion(tx, verification)
      )
    ).resolves.toBeUndefined();
    await expect(
      sottoTransaction(instance.database, (tx) =>
        verifyAssessmentSpeakingForDeletion(tx, {
          ...verification,
          recordingId: randomUUID(),
        })
      )
    ).rejects.toThrow();
    if (selectedMode.startsWith('submission_speaking_retry')) {
      const failed = await instance.database.speakingRecording.findFirstOrThrow({
        where: {
          assessmentSection: { assessmentId: fence.assessmentId },
          status: 'FAILED',
        },
      });
      if (!failed.gradingOperationId) throw new Error('Missing failed speaking operation');
      const failedOperationId = failed.gradingOperationId;
      const failedJob = await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).read(failedOperationId)
      );
      if (!failedJob) throw new Error('Missing failed speaking job');
      const failedVerification = {
        ...verification,
        recordingId: failed.id,
        operationId: failedOperationId,
        fingerprint: failedJob.fingerprint,
      };
      await expect(
        sottoTransaction(instance.database, (tx) =>
          verifyAssessmentSpeakingForDeletion(tx, failedVerification)
        )
      ).resolves.toBeUndefined();
      if (selectedMode === 'submission_speaking_retry_profile') {
        relocatedSourcePath = join(
          root,
          decodeURIComponent(failed.audioUrl.slice(LOCAL_STORAGE_URL_PREFIX.length + 1))
        );
        const { inspectStorageMigrationConsumer } =
          await import('@/lib/sidedoor/storage/migration/storage-migration-plan');
        await sottoTransaction(instance.database, async (tx) => {
          const registry = new StorageReferenceRegistry(
            {
              query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
            },
            'postgres',
            SIDEDOOR_STATE_ID
          );
          const consumer = `recording:${failed.id}:audio`;
          const reference = await registry.resolve({
            consumer,
            reference: failed.audioUrl,
          });
          if (!reference) throw new Error('Missing failed recording asset');
          expect(
            (await inspectStorageMigrationConsumer(tx, consumer, reference.prepared)).reason
          ).toBeNull();
        });
        const { resolveSottoRequest } = await import('@/lib/sidedoor/access/core/request-identity');
        const { readStorageMigrationAssetPage } =
          await import('@/lib/sidedoor/storage/migration/storage-migration-plan');
        const { admitSottoStorageCopy, executeSottoStorageCopy } =
          await import('@/lib/sidedoor/storage/migration/storage-migration-copy');
        const migrationRequest = new Request('http://localhost/api/v1/admin/storage/migrate', {
          headers: { cookie: `sotto_session=${identity.ownerToken}` },
        });
        const migrationAdmission = await sottoTransaction(instance.database, (tx) =>
          resolveSottoRequest(tx, migrationRequest)
        );
        if (!migrationAdmission || migrationAdmission.kind !== 'content')
          throw new Error('Missing storage migration owner');
        const target = await capturedLocalBackend(
          await LocalStorageCleanup.capture(root),
          root,
          LOCAL_STORAGE_URL_PREFIX,
          () => {}
        );
        let cursor: string | null = null;
        let entry:
          Awaited<ReturnType<typeof readStorageMigrationAssetPage>>['entries'][number] | undefined;
        do {
          const page = await sottoTransaction(instance.database, (database) =>
            readStorageMigrationAssetPage({
              database,
              request: migrationRequest,
              admission: migrationAdmission,
              after: cursor,
            })
          );
          entry = page.entries.find((item) =>
            item.claims.some((claim) => claim.consumer === `recording:${failed.id}:audio`)
          );
          cursor = page.cursor;
        } while (!entry && cursor);
        if (!entry) throw new Error('Missing assessment recording migration candidate');
        const copyId = randomUUID();
        migratedCopyId = copyId;
        const copy = await sottoTransaction(instance.database, (tx) =>
          admitSottoStorageCopy(tx, {
            request: migrationRequest,
            admission: migrationAdmission,
            operationId: copyId,
            entry,
            target: target.descriptor,
            timeoutMs: 30_000,
          })
        );
        await executeSottoStorageCopy({
          database: instance.database,
          request: migrationRequest,
          admission: migrationAdmission,
          operationId: copyId,
          fingerprint: copy.fingerprint,
          target,
        });
        await expect(
          sottoTransaction(instance.database, (tx) =>
            verifyAssessmentSpeakingForDeletion(tx, failedVerification)
          )
        ).resolves.toBeUndefined();
      }
      await expect(
        sottoTransaction(instance.database, async (tx) => {
          await tx.sidedoorState.delete({
            where: { id: `${SIDEDOOR_STATE_ID}:speaking-grant:${failedOperationId}` },
          });
          await expect(
            verifyAssessmentSpeakingForDeletion(tx, failedVerification)
          ).rejects.toThrow();
          throw new Error('Roll back missing grant');
        })
      ).rejects.toThrow('Roll back missing grant');
    }
    const speakingJobs = await sottoTransaction(instance.database, (tx) =>
      inspectAssessmentSpeakingForDeletion(tx, {
        classId,
        courseId: cls.courseId,
        userId: identity.ownerId,
      })
    );
    await instance.database.$transaction(async (tx) => {
      await expect(
        inspectAssessmentSpeakingForDeletion(tx, {
          classId,
          courseId: cls.courseId,
          userId: identity.ownerId,
        })
      ).rejects.toThrow('requires a Serializable transaction');
    });
    expect(speakingJobs).toContainEqual({
      id: saved.operationId,
      fingerprint: saved.operationFingerprint,
    });
    const job = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).read(saved.operationId)
    );
    if (!job) throw new Error('Missing speaking job');
    const broaderScopes = job.job.scopes.filter(
      (scope) =>
        scope.subjectId === `course:${cls.courseId}` ||
        scope.subjectId === `profile:${identity.ownerId}`
    );
    expect(broaderScopes).toHaveLength(2);
    for (const scope of broaderScopes) {
      await expect(
        sottoTransaction(instance.database, (tx) =>
          reconcileAssessmentSpeakingDeletionScopes(tx, [scope], speakingJobs)
        )
      ).resolves.toEqual(speakingJobs.map((item) => ({ ...item, scope })));
      await expect(
        sottoTransaction(instance.database, (tx) =>
          reconcileAssessmentSpeakingDeletionScopes(tx, [scope], [])
        )
      ).rejects.toThrow();
    }
    const scope = broaderScopes.find((item) => item.subjectId === `course:${cls.courseId}`);
    if (!scope) throw new Error('Missing course scope');
    const { admitLearningStorageDeletion } =
      await import('@/lib/sidedoor/access/deletion/learning-deletion');
    const deletionBackend = await capturedLocalBackend(
      await LocalStorageCleanup.capture(root),
      root,
      LOCAL_STORAGE_URL_PREFIX,
      () => {}
    );
    for (const deletionScope of broaderScopes) {
      await expect(
        sottoTransaction(instance.database, async (tx) => {
          const isCourse = deletionScope.subjectId === scope.subjectId;
          await admitLearningStorageDeletion({
            database: tx,
            scope: isCourse
              ? { kind: 'course', id: cls.courseId, episodeIds: [] }
              : { kind: 'profile', id: identity.ownerId },
            subjects: [deletionScope],
            currentBackend: deletionBackend,
          });
          if (isCourse) await tx.course.delete({ where: { id: cls.courseId } });
          else await tx.user.delete({ where: { id: identity.ownerId } });
          expect(await sottoJobOutbox(tx).receipt(saved.operationId)).toMatchObject({
            status: 'erased',
          });
          throw new Error('Roll back speaking storage deletion');
        })
      ).rejects.toThrow('Roll back speaking storage deletion');
    }
    const retirement = speakingJobs.map((item) => ({ ...item, scope }));
    await expect(
      sottoTransaction(instance.database, (tx) =>
        eraseAssessmentSpeakingForDeletion(tx, retirement)
      )
    ).rejects.toThrow();
    await expect(
      sottoTransaction(instance.database, async (tx) => {
        const executor = {
          query: (sql: string, values: readonly unknown[]) =>
            tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        };
        const captured = await capturedLocalBackend(
          await LocalStorageCleanup.capture(root),
          root,
          LOCAL_STORAGE_URL_PREFIX,
          () => {}
        );
        const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, captured.descriptor);
        await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(backend);
        const cleanup = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
        const cleanupJob = prepareStorageCleanup({
          namespace: SIDEDOOR_STATE_ID,
          ...scope,
          retentionPolicy: 'job-id-snapshots-v1',
        });
        await cleanup.createJob(cleanupJob);
        await cleanup.registerCollectors(cleanupJob.id, cleanupJob.epoch, [
          {
            id: 'empty',
            kind: 'inventory',
            backendIds: [backend.id],
            scope: `__test/${cleanupJob.id}`,
            match: 'key',
          },
        ]);
        await cleanup.recordManifestPage(cleanupJob.id, cleanupJob.epoch, {
          id: 'write-protocol',
          entries: [{ kind: 'write_protocol' }],
        });
        await cleanup.resolveManifest(cleanupJob.id, cleanupJob.epoch, 'write-protocol', {
          resolver: 'test',
          entries: [{ index: 0, kind: 'non_storage', reason: 'write protocol' }],
        });
        await eraseAssessmentSpeakingForDeletion(tx, retirement);
        expect(await sottoJobOutbox(tx).receipt(saved.operationId)).toMatchObject({
          status: 'erased',
        });
        throw new Error('Roll back speaking retirement');
      })
    ).rejects.toThrow('Roll back speaking retirement');
    expect(
      await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).receipt(saved.operationId)
      )
    ).toMatchObject({ status: 'complete' });
    expect(
      await instance.database.speakingRecording.findUnique({
        where: { id: saved.speakingRecordingId },
      })
    ).not.toBeNull();
    await expect(
      sottoTransaction(instance.database, (tx) =>
        reconcileAssessmentSpeakingDeletionScopes(
          tx,
          [broaderScopes[0]!, broaderScopes[0]!],
          speakingJobs
        )
      )
    ).rejects.toThrow();
    await expect(
      sottoTransaction(instance.database, async (tx) => {
        await tx.speakingRecording.update({
          where: { id: saved.speakingRecordingId! },
          data: { gradingOperationId: null },
        });
        await expect(
          inspectAssessmentSpeakingForDeletion(tx, {
            classId,
            courseId: cls.courseId,
            userId: identity.ownerId,
          })
        ).rejects.toThrow();
        throw new Error('Roll back orphaned recording');
      })
    ).rejects.toThrow('Roll back orphaned recording');
  }
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      const { assessmentFenceBackend, assessmentFenceStore } =
        await import('@/lib/learning/classes/lifecycle/assessment-fence');
      await tx.courseClass.update({
        where: { id: classId },
        data: { status: 'IN_PROGRESS' },
      });
      await assessmentFenceStore(assessmentFenceBackend(tx, classId)).transact((state) => {
        state.current = null;
      });
      await expect(readAssessmentStatus(tx, classId, execution)).rejects.toThrow();
      await expect(
        admitAssessmentWork(tx, {
          id: randomUUID(),
          revision: randomUUID(),
          assessmentId: randomUUID(),
          classId,
          classAttempt: cls.attempt,
          assessmentAttempt: 2,
          expiresAt: Date.now() + 120_000,
          selection: fence.selection,
          execution,
        })
      ).rejects.toThrow();
      throw new Error('Roll back reopened assessment');
    })
  ).rejects.toThrow('Roll back reopened assessment');
  await instance.database.courseClass.update({
    where: { id: classId },
    data: { status: 'IN_PROGRESS' },
  });
  try {
    await expect(submitAssessment(submission)).resolves.toEqual(first);
    await expect(submitAssessment({ ...submission, choices: changedChoices })).rejects.toThrow();
    await expect(
      submitAssessment({
        ...submission,
        execution: authorizedLearnerExecution(other.id),
      })
    ).rejects.toThrow();
  } finally {
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { status: 'FAILED' },
    });
  }
  await instance.database.courseClass.update({
    where: { id: classId },
    data: { attempt: cls.attempt + 1 },
  });
  try {
    await expect(submitAssessment(submission)).rejects.toThrow();
  } finally {
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { attempt: cls.attempt },
    });
  }
  if (mode === 'submission_speaking_fail') {
    const saved = await instance.database.speakingRecording.findFirstOrThrow({
      where: {
        assessmentSection: { assessmentId: fence.assessmentId },
        status: 'SCORED',
      },
    });
    await instance.database.speakingRecording.update({
      where: { id: saved.id },
      data: { feedback: 'Changed after submission' },
    });
    try {
      await expect(failedReceipt()).rejects.toThrow();
    } finally {
      await instance.database.speakingRecording.update({
        where: { id: saved.id },
        data: { feedback: saved.feedback },
      });
    }
  }
  const failedClass = await instance.database.courseClass.findUniqueOrThrow({
    where: { id: classId },
  });
  const { claimClassRegenerationInTransaction } =
    await import('@/lib/learning/classes/formative/class-generation-state');
  await expect(
    sottoTransaction(instance.database, (tx) =>
      claimClassRegenerationInTransaction(tx, execution, classId, failedClass, fence.requirements)
    )
  ).rejects.toThrow('assessment work');
  expect(
    await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } })
  ).toMatchObject({ status: 'FAILED', attempt: failedClass.attempt });
  await expect(failedReceipt()).resolves.toMatchObject({
    assessmentId: fence.assessmentId,
  });
  const { capturePriorAssessmentExposure } =
    await import('@/lib/learning/classes/history/assessment-prior-exposure');
  const exposure = await sottoTransaction(instance.database, (tx) =>
    capturePriorAssessmentExposure(tx, {
      classId,
      courseId: cls.courseId,
      userId: identity.ownerId,
      classAttempt: cls.attempt,
      assessmentAttempt: 2,
    })
  );
  expect(exposure).toHaveLength(1);
  expect(exposure[0]).toMatchObject({
    assessmentId: fence.assessmentId,
    classAttempt: cls.attempt,
    assessmentAttempt: 1,
    submissionId: expect.any(String),
    requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  const outcomeModule = await import('@/lib/learning/classes/lifecycle/assessment-outcome');
  const legacy = vi
    .spyOn(outcomeModule, 'readVerifiedHistoricalAssessmentGeneration')
    .mockResolvedValueOnce({ ...history, reviewSource: undefined });
  try {
    await expect(
      sottoTransaction(instance.database, (tx) =>
        capturePriorAssessmentExposure(tx, {
          classId,
          courseId: cls.courseId,
          userId: identity.ownerId,
          classAttempt: cls.attempt,
          assessmentAttempt: 2,
        })
      )
    ).rejects.toThrow();
  } finally {
    legacy.mockRestore();
  }
  await expect(
    sottoTransaction(instance.database, (tx) =>
      capturePriorAssessmentExposure(tx, {
        classId,
        courseId: cls.courseId,
        userId: other.id,
        classAttempt: cls.attempt,
        assessmentAttempt: 2,
      })
    )
  ).rejects.toThrow();
  const source = await sottoTransaction(instance.database, (tx) =>
    readPrerequisiteSource(tx, classId, identity.ownerId)
  );
  const { authorAssessmentSection } =
    await import('@/lib/learning/classes/generation/assessment-authoring');
  const grammar = fence.requirements.skills.GRAMMAR;
  if (grammar.state !== 'REQUIRED') throw new Error('Grammar must be required');
  await authorAssessmentSection(
    {
      source: source.source,
      prerequisite: null,
      requirements: fence.requirements,
      skill: 'GRAMMAR',
      priorTasks: exposure.map((item) => item.tasks),
    },
    async (request) => {
      const payload = JSON.parse(request.payload) as { priorTasks: unknown };
      expect(payload.priorTasks).toEqual(exposure.map((item) => item.tasks));
      expect(JSON.stringify(payload.priorTasks)).not.toMatch(
        /correctIndex|privateRubric|privateGuidance|explanation/
      );
      return JSON.stringify({
        skill: 'GRAMMAR',
        items: Array.from({ length: grammar.expectedCount }, (_, index) => ({
          question: `New independent question ${index}`,
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 1,
          explanation: 'Reason',
        })),
      });
    }
  );
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await tx.courseClass.update({
        where: { id: classId },
        data: { attempt: cls.attempt + 1 },
      });
      const afterRepair = await capturePriorAssessmentExposure(tx, {
        classId,
        courseId: cls.courseId,
        userId: identity.ownerId,
        classAttempt: cls.attempt + 1,
        assessmentAttempt: 1,
      });
      expect(afterRepair).toEqual(exposure);
      throw new Error('Rollback simulated class repair');
    })
  ).rejects.toThrow('Rollback simulated class repair');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await tx.courseClass.update({
        where: { id: classId },
        data: { attempt: cls.attempt + 1 },
      });
      await tx.sidedoorState.delete({
        where: { id: assessmentArchiveId(operation.id) },
      });
      await expect(
        capturePriorAssessmentExposure(tx, {
          classId,
          courseId: cls.courseId,
          userId: identity.ownerId,
          classAttempt: cls.attempt + 1,
          assessmentAttempt: 1,
        })
      ).rejects.toThrow();
      throw new Error('Rollback missing prior assessment history');
    })
  ).rejects.toThrow('Rollback missing prior assessment history');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await tx.courseClass.update({
        where: { id: classId },
        data: { attempt: cls.attempt + 101 },
      });
      await tx.classAssessment.createMany({
        data: Array.from({ length: 100 }, (_, index) => ({
          classId,
          courseId: cls.courseId,
          userId: identity.ownerId,
          classAttempt: cls.attempt + index + 1,
          assessmentAttempt: 1,
          requirements: fence.requirements,
          formativeRevision: fence.formativeRevision,
        })),
      });
      await expect(
        capturePriorAssessmentExposure(tx, {
          classId,
          courseId: cls.courseId,
          userId: identity.ownerId,
          classAttempt: cls.attempt + 101,
          assessmentAttempt: 1,
        })
      ).rejects.toBeInstanceOf(AssessmentFenceConflict);
      throw new Error('Rollback excessive assessment history');
    })
  ).rejects.toThrow('Rollback excessive assessment history');
  expect(JSON.stringify(exposure)).not.toMatch(
    /correctIndex|privateRubric|privateGuidance|PRIVATE_DRAFT/
  );
  await expect(
    sottoTransaction(instance.database, (tx) =>
      capturePriorAssessmentExposure(tx, {
        classId,
        courseId: cls.courseId,
        userId: identity.ownerId,
        classAttempt: cls.attempt,
        assessmentAttempt: 3,
      })
    )
  ).rejects.toThrow();
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await tx.lessonQuestion.update({
        where: { id: priorQuestion.id },
        data: { question: 'Later practice revision' },
      });
      expect(
        await captureFailedAssessmentReceipt(tx, {
          classId,
          assessmentId: fence.assessmentId,
          execution,
        })
      ).toMatchObject({ assessmentId: fence.assessmentId });
      throw new Error('Roll back changed practice');
    })
  ).rejects.toThrow('Roll back changed practice');
  const retainedWriting =
    await instance.database.classAssessmentProductiveEvidence.findFirstOrThrow({
      where: { assessmentId: fence.assessmentId },
    });
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await tx.sidedoorState.delete({
        where: {
          id: `${SIDEDOOR_STATE_ID}:assessment-writing-launch:${retainedWriting.operationId}`,
        },
      });
      await expect(
        captureFailedAssessmentReceipt(tx, {
          classId,
          assessmentId: fence.assessmentId,
          execution,
        })
      ).rejects.toThrow();
      throw new Error('Roll back missing writing launch');
    })
  ).rejects.toThrow('Roll back missing writing launch');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await tx.writingResponse.update({
        where: { id: scored.id },
        data: { overallScore: 0.1 },
      });
      await expect(
        captureFailedAssessmentReceipt(tx, {
          classId,
          assessmentId: fence.assessmentId,
          execution,
        })
      ).rejects.toThrow();
      await expect(
        capturePriorAssessmentExposure(tx, {
          classId,
          courseId: cls.courseId,
          userId: identity.ownerId,
          classAttempt: cls.attempt,
          assessmentAttempt: 2,
        })
      ).rejects.toThrow();
      throw new Error('Roll back altered writing grade');
    })
  ).rejects.toThrow('Roll back altered writing grade');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await tx.classSubmission.update({
        where: { classId },
        data: { overallScore: 1 },
      });
      await expect(
        captureFailedAssessmentReceipt(tx, {
          classId,
          assessmentId: fence.assessmentId,
          execution,
        })
      ).rejects.toThrow();
      await expect(
        capturePriorAssessmentExposure(tx, {
          classId,
          courseId: cls.courseId,
          userId: identity.ownerId,
          classAttempt: cls.attempt,
          assessmentAttempt: 2,
        })
      ).rejects.toThrow();
      throw new Error('Roll back altered failed receipt');
    })
  ).rejects.toThrow('Roll back altered failed receipt');
  const answer = await instance.database.classAssessmentAnswer.findFirstOrThrow({
    where: { assessmentId: fence.assessmentId },
    include: { question: true },
  });
  if (!Array.isArray(answer.question.options) || answer.question.options.length < 2)
    throw new Error('Assessment answer has no alternative');
  const selectedIndex = (answer.selectedIndex + 1) % answer.question.options.length;
  await expect(
    instance.database.classAssessmentAnswer.update({
      where: { id: answer.id },
      data: {
        selectedIndex,
        isCorrect: selectedIndex === answer.question.correctIndex,
      },
    })
  ).rejects.toThrow('Assessment receipt and answers cannot change');
  expect(await failedReceipt()).toMatchObject({ assessmentId: fence.assessmentId });
  await expect(
    sottoTransaction(instance.database, (tx) =>
      captureFailedAssessmentReceipt(tx, {
        classId,
        assessmentId: fence.assessmentId,
        execution: authorizedLearnerExecution(other.id),
      })
    )
  ).rejects.toThrow();
  const { assessmentFenceBackend, assessmentFenceStore } =
    await import('@/lib/learning/classes/lifecycle/assessment-fence');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await assessmentFenceStore(assessmentFenceBackend(tx, classId)).transact((state) => {
        if (!state.current) throw new Error('Assessment fence missing');
        state.current.formativeRevision = '0'.repeat(64);
      });
      await expect(
        captureFailedAssessmentReceipt(tx, {
          classId,
          assessmentId: fence.assessmentId,
          execution,
        })
      ).rejects.toThrow();
      throw new Error('Roll back altered current fence');
    })
  ).rejects.toThrow('Roll back altered current fence');

  return { relocatedSourcePath, migratedCopyId };
}
