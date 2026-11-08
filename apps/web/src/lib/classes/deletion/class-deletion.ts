import { prerequisiteFenceStateId } from '@/lib/classes/help/lifecycle/prerequisite-fence';
import {
  inspectClassListeningDeletion,
  requireClassWorksheetOwnership,
  requireLegacyWorksheetDeletionSafe,
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
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  inspectClassSpeakingMedia,
  inspectSpeakingGradingDeletion,
  requireLegacySpeakingClassDeletionSafe,
} from '@/lib/sidedoor/jobs/stitch/speaking-grading-deletion';
import { runSottoStorageCleanup } from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';

export async function deleteClassForUser(
  classId: string,
  userId: string,
  execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution
): Promise<boolean> {
  const existing = await prismaUnfiltered.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    select: { id: true, createdAt: true },
  });
  if (!existing) {
    const recovered = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        const actor = await execution.authorize(database);
        if (actor.userId !== userId) throw new PrerequisiteDeletionConflict();
        try {
          return await recoverPrerequisiteClassDeletion(database, classId, userId);
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
      if (cleanup.phase === 'complete') continue;
      try {
        await runSottoStorageCleanup(prismaUnfiltered, cleanup.id, { signal: execution.signal });
      } catch (error) {
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
      return sottoJobOutbox(database).listForScope(
        `class:${classId}`,
        existing.createdAt.getTime()
      );
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
    savedFence || classJobs.jobs.length || promptReferences || listeningReferences
      ? await captureStorageBackend()
      : null;

  const result = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== userId) throw new PrerequisiteDeletionConflict();
      const cls = await database.courseClass.findFirst({
        where: { id: classId, course: { userId } },
        select: {
          id: true,
          createdAt: true,
          courseId: true,
          worksheetPdfUrl: true,
          course: { select: { activeClassId: true } },
        },
      });
      if (!cls) return null;
      if (cls.createdAt.getTime() !== existing.createdAt.getTime())
        throw new PrerequisiteDeletionConflict();
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
      await requireLegacyWorksheetDeletionSafe(database, courseScope, classId);
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
          inventory.worksheetOperations
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
      const hasWork =
        inventory.operations.length ||
        inventory.assessmentOperations.length ||
        inventory.copyOperations.length ||
        inventory.worksheetOperations.length ||
        speaking.length ||
        classSpeakingMedia ||
        listening.length;
      if (hasWork && !backend) throw new PrerequisiteDeletionConflict();
      let job = null;
      let episodeJobs: { episodeId: string; generation: number; jobId: string }[] = [];
      if (hasWork && backend) {
        if (
          inventory.assessmentSpeakingOperations.length ||
          inventory.copyOperations.length ||
          inventory.worksheetOperations.length ||
          inventory.audio.episodeIds.length ||
          classSpeakingMedia ||
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
      if (job)
        await recordPrerequisiteClassDeletion(database, {
          classId,
          classGeneration: cls.createdAt.getTime(),
          userId,
          jobId: job.id,
          episodeJobs,
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
    { timeoutMs: 60_000, signal: execution.signal }
  );
  if (!result) return false;
  for (const jobId of result.jobIds) {
    try {
      await runSottoStorageCleanup(prismaUnfiltered, jobId, { signal: execution.signal });
    } catch (error) {
      logger.error('Class prerequisite cleanup remains pending', {
        classId,
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return true;
}
