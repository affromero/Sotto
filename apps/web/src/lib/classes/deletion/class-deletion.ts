import { prerequisiteFenceStateId } from '@/lib/classes/help/lifecycle/prerequisite-fence';
import {
  inspectClassListeningDeletion,
  requireClassWorksheetOwnership,
  inspectLegacyWorksheetDeletion,
} from '@/lib/classes/help/listening-deletion';
import {
  admitPrerequisiteClassDeletion,
  backfillDeletionJobScopes,
  inspectPrerequisiteDeletion,
  PrerequisiteDeletionConflict,
  recordPrerequisiteClassDeletion,
  recoverPrerequisiteClassDeletion,
} from '@/lib/classes/help/prerequisite-deletion';
import { logger } from '@/lib/logger';
import { prismaUnfiltered } from '@/lib/prisma';
import { captureStorageBackend } from '@/lib/r2';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoStateWriteTransaction } from '@/lib/sidedoor/access/state/write-transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  inspectClassSpeakingMedia,
  inspectSpeakingGradingDeletion,
  requireLegacySpeakingClassDeletionSafe,
} from '@/lib/sidedoor/jobs/stitch/speaking-grading-deletion';
import { runSottoStorageCleanup } from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import {
  CLASS_PREPARATION_QUEUE,
  classPreparationStore,
  classPreparationPayload,
  validateClassPreparation,
} from '@/lib/classes/preparation/runtime';
import { classPreparationGrant } from '@/lib/classes/preparation-grant';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { hasUnsettledClassSpeakingReferenceWrites } from '@/lib/classes/speaking/speaking-write-settlement';
import { hasClassStorageWrites } from './storage-writes';

export async function deleteClassForUser(
  classId: string,
  userId: string,
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution,
  expectedPreparation?: {
    operationId: string;
    courseId: string;
    createdAt: number;
    attempt: number;
  },
  expectedLegacy?: { courseId: string; createdAt: number; attempt: number }
): Promise<boolean> {
  const existing = await prismaUnfiltered.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    select: { id: true, createdAt: true, courseId: true },
  });
  if (!existing) {
    if (expectedLegacy) return false;
    const recovered = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        const actor = await execution.authorize(database);
        if (actor.userId !== userId) throw new PrerequisiteDeletionConflict();
        if (expectedPreparation) {
          const operation = await validateClassPreparation(
            database,
            expectedPreparation.courseId,
            expectedPreparation.operationId,
            true
          );
          if (
            operation.userId !== userId ||
            operation.classId !== classId ||
            operation.intent ||
            operation.result === 'created' ||
            !['FAILED', 'CANCELLED'].includes(operation.status)
          )
            throw new PrerequisiteDeletionConflict();
        }
        try {
          return await recoverPrerequisiteClassDeletion(
            database,
            classId,
            userId,
            expectedPreparation
          );
        } catch (error) {
          if (isSerializationConflict(error) || execution.signal?.aborted) throw error;
          logger.error('Class prerequisite cleanup proof could not be verified', {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      },
      { signal: execution.signal, timeoutMs: 60_000 }
    );
    if (!recovered) return false;
    for (const cleanup of [recovered, ...recovered.episodeJobs]) {
      if (cleanup.phase === 'complete' || !cleanup.id) continue;
      try {
        await runSottoStorageCleanup(prismaUnfiltered, cleanup.id, { signal: execution.signal });
      } catch (error) {
        if (expectedPreparation) throw error;
        logger.error('Class prerequisite cleanup remains pending', {
          classId,
          jobId: cleanup.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return true;
  }
  const savedFence = await prismaUnfiltered.sidedoorState.findUnique({
    where: { id: prerequisiteFenceStateId(classId) },
    select: { id: true },
  });
  const classJobs = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== userId) throw new PrerequisiteDeletionConflict();
      await backfillDeletionJobScopes(database);
      const course = await captureCourseStorage(database, existing.courseId);
      const courseScope = course.scopes.find(
        (scope) => scope.subjectId === `course:${existing.courseId}`
      );
      if (!courseScope) throw new PrerequisiteDeletionConflict();
      const legacy = await inspectLegacyWorksheetDeletion(
        database,
        courseScope,
        classId,
        existing.courseId
      );
      const jobs = await sottoJobOutbox(database).listForScope(
        `class:${classId}`,
        existing.createdAt.getTime()
      );
      return { jobs: jobs.jobs, legacy, hasWrites: await hasClassStorageWrites(database, classId) };
    },
    { timeoutMs: 60_000, signal: execution.signal }
  );
  const promptReferences = await prismaUnfiltered.speakingPrompt.count({
    where: { section: { classId }, referenceTtsUrl: { not: null } },
  });
  const listeningReferences = await prismaUnfiltered.classSection.count({
    where: { classId, episodeId: { not: null } },
  });
  const backend =
    savedFence ||
    classJobs.jobs.length ||
    classJobs.legacy.length ||
    classJobs.hasWrites ||
    promptReferences ||
    listeningReferences
      ? await captureStorageBackend()
      : null;

  const result = await sottoStateWriteTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== userId) throw new PrerequisiteDeletionConflict();
      if (expectedPreparation || expectedLegacy)
        await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
      const cls = await database.courseClass.findFirst({
        where: { id: classId, course: { userId } },
        select: {
          id: true,
          createdAt: true,
          courseId: true,
          status: true,
          attempt: true,
          worksheetPdfUrl: true,
          course: { select: { activeClassId: true } },
        },
      });
      if (!cls) return null;
      if (cls.createdAt.getTime() !== existing.createdAt.getTime())
        throw new PrerequisiteDeletionConflict();
      if (expectedLegacy) {
        if (
          cls.courseId !== expectedLegacy.courseId ||
          cls.createdAt.getTime() !== expectedLegacy.createdAt ||
          cls.status !== 'GENERATING' ||
          cls.attempt !== expectedLegacy.attempt ||
          (await classPreparationStore(database, cls.courseId).read()) ||
          (await hasUnsettledClassSpeakingReferenceWrites(database, cls.courseId, classId))
        )
          throw new PrerequisiteDeletionConflict();
      }
      if (expectedPreparation) {
        if (
          cls.courseId !== expectedPreparation.courseId ||
          cls.createdAt.getTime() !== expectedPreparation.createdAt ||
          cls.status !== 'GENERATING' ||
          cls.attempt !== expectedPreparation.attempt
        )
          throw new PrerequisiteDeletionConflict();
        const operation = await validateClassPreparation(
          database,
          cls.courseId,
          expectedPreparation.operationId,
          true
        );
        if (
          operation.userId !== userId ||
          operation.classId !== classId ||
          operation.intent ||
          operation.result === 'created' ||
          !['FAILED', 'CANCELLED'].includes(operation.status)
        )
          throw new PrerequisiteDeletionConflict();
        const job = await sottoJobOutbox(database).read(operation.id);
        const grant = await classPreparationGrant(database, operation).read(operation.grant);
        const payload = classPreparationPayload.safeParse(job?.job.payload);
        const ownership = await captureCourseStorage(database, cls.courseId);
        if (
          !job?.complete ||
          job.job.namespace !== SIDEDOOR_STATE_ID ||
          job.job.handler !== CLASS_PREPARATION_QUEUE ||
          job.job.version !== 1 ||
          !payload.success ||
          payload.data.courseId !== cls.courseId ||
          payload.data.operationId !== operation.id ||
          ownership.scopes.length !== job.job.scopes.length ||
          ownership.scopes.some(
            (scope) =>
              !job.job.scopes.some(
                (saved) =>
                  saved.subjectId === scope.subjectId && saved.generation === scope.generation
              )
          ) ||
          grant.status !== 'revoked'
        )
          throw new PrerequisiteDeletionConflict();
        const executions = sottoJobExecutions(database);
        if (await executions.blockingStatus(operation.id, job.fingerprint))
          throw new PrerequisiteDeletionConflict();
        await executions.requireParentDrained(operation.id, job.fingerprint);
        if (await hasUnsettledClassSpeakingReferenceWrites(database, cls.courseId, classId))
          throw new PrerequisiteDeletionConflict();
      }
      const inventory = await inspectPrerequisiteDeletion(database, classId, cls.courseId, userId, {
        allowAssessmentSpeaking: true,
      });
      const assessment = await database.classAssessment.findFirst({
        where: { classId },
        select: { id: true },
      });
      if (assessment && !inventory.assessmentOperations.length)
        throw new PrerequisiteDeletionConflict(
          'This class has assessment material that requires complete media cleanup before deletion.'
        );
      const courseScope = inventory.scopes.find(
        (scope) => scope.subjectId === `course:${cls.courseId}`
      );
      if (!courseScope) throw new PrerequisiteDeletionConflict();
      await requireLegacySpeakingClassDeletionSafe(database, courseScope, classId);
      const legacy = await inspectLegacyWorksheetDeletion(
        database,
        courseScope,
        classId,
        cls.courseId
      );
      const legacyOwnership = legacy.length
        ? await captureCourseStorage(database, cls.courseId)
        : null;
      const speaking = await inspectSpeakingGradingDeletion(
        database,
        [inventory.classScope],
        inventory.assessmentSpeakingOperations
      );
      if (cls.worksheetPdfUrl)
        await requireClassWorksheetOwnership(
          database,
          classId,
          cls.worksheetPdfUrl,
          inventory.scopes,
          inventory.worksheetOperations,
          legacyOwnership ? { scopes: legacyOwnership.scopes, operations: legacy } : undefined
        );
      const listening = await inspectClassListeningDeletion(
        database,
        classId,
        cls.courseId,
        userId
      );
      const classSpeakingMedia = await inspectClassSpeakingMedia(
        database,
        {
          classId,
          courseId: cls.courseId,
          userId,
          scope: inventory.classScope,
        },
        speaking
      );
      const classWrites = await hasClassStorageWrites(database, classId);
      const hasWork =
        inventory.operations.length ||
        inventory.assessmentOperations.length ||
        inventory.copyOperations.length ||
        inventory.worksheetOperations.length ||
        legacy.length ||
        speaking.length ||
        classSpeakingMedia ||
        classWrites ||
        listening.length;
      if (hasWork && !backend) throw new PrerequisiteDeletionConflict();
      let job = null;
      let episodeJobs: { episodeId: string; generation: number; jobId: string }[] = [];
      if (hasWork && backend) {
        if (
          inventory.assessmentSpeakingOperations.length ||
          inventory.copyOperations.length ||
          inventory.worksheetOperations.length ||
          legacy.length ||
          inventory.audio.episodeIds.length ||
          classSpeakingMedia ||
          classWrites ||
          listening.length
        ) {
          const episodeIds = listening.map((subject) => subject.subjectId.slice('episode:'.length));
          const jobs = await admitLearningStorageDeletion({
            database,
            scope: { kind: 'class', id: classId, episodeIds },
            subjects: [inventory.classScope, ...listening],
            currentBackend: backend,
          });
          job = jobs.find((entry) => entry.subjectId === inventory.classScope.subjectId) ?? null;
          if (!job || jobs.length !== listening.length + 1)
            throw new PrerequisiteDeletionConflict();
          episodeJobs = listening.map((subject) => {
            const entry = jobs.find((candidate) => candidate.subjectId === subject.subjectId);
            if (!entry) throw new PrerequisiteDeletionConflict();
            return {
              episodeId: subject.subjectId.slice('episode:'.length),
              generation: subject.generation,
              jobId: entry.id,
            };
          });
        } else job = await admitPrerequisiteClassDeletion(database, inventory, backend, speaking);
      }
      if (job || expectedPreparation)
        await recordPrerequisiteClassDeletion(database, {
          classId,
          classGeneration: cls.createdAt.getTime(),
          userId,
          jobId: job?.id ?? null,
          episodeJobs,
          ...(expectedPreparation
            ? {
                preparation: {
                  operationId: expectedPreparation.operationId,
                  attempt: expectedPreparation.attempt,
                },
              }
            : {}),
        });
      await database.courseClass.delete({ where: { id: classId } });
      const episodeIds = [
        ...inventory.audio.episodeIds,
        ...episodeJobs.map((entry) => entry.episodeId),
      ];
      if (episodeIds.length)
        await database.episode.deleteMany({ where: { id: { in: episodeIds } } });
      if (cls.course.activeClassId === classId)
        await database.course.update({
          where: { id: cls.courseId },
          data: { activeClassId: null },
        });
      return { jobIds: [...(job ? [job.id] : []), ...episodeJobs.map((entry) => entry.jobId)] };
    },
    execution.signal ?? AbortSignal.timeout(120_000),
    { timeoutMs: 60_000 }
  );
  if (!result) return false;
  for (const jobId of result.jobIds) {
    try {
      await runSottoStorageCleanup(prismaUnfiltered, jobId, { signal: execution.signal });
    } catch (error) {
      if (expectedPreparation) throw error;
      logger.error('Class prerequisite cleanup remains pending', {
        classId,
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return true;
}
