import { StorageCleanupJournal } from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';
import { prismaUnfiltered } from '@/lib/prisma';
import { captureStorageBackend } from '@/lib/r2';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { runSottoStorageCleanup } from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

export interface FactoryResetResult {
  profilesPreserved: number;
  episodesDeleted: number;
  filesAttempted: number;
  filesDeleted: number;
  filesFailed: number;
  cleanupPendingJobs: number;
}

function cleanup(database: Prisma.TransactionClient) {
  return new StorageCleanupJournal(
    {
      query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    },
    'postgres',
    SIDEDOOR_STATE_ID
  );
}

async function deleteDatabaseState(database: Prisma.TransactionClient): Promise<void> {
  await database.episodeVersionSegment.deleteMany({});
  await database.episodeVersion.deleteMany({});
  await database.discoveryMessage.deleteMany({});
  await database.discovery.deleteMany({});
  await database.agentIngestion.deleteMany({});
  await database.researchDossier.deleteMany({});
  await database.creativeOutline.deleteMany({});
  await database.script.deleteMany({});
  await database.segment.deleteMany({});
  await database.episodeVoice.deleteMany({});
  await database.audioFingerprint.deleteMany({});
  await database.reference.deleteMany({});
  await database.vocabularyEntry.deleteMany({});
  await database.episodeTag.deleteMany({});
  await database.pipelineEvent.deleteMany({});
  await database.job.deleteMany({});
  await database.save.deleteMany({});
  await database.interaction.deleteMany({});
  await database.examSectionResult.deleteMany({});
  await database.examSubmission.deleteMany({});
  await database.examQuestion.deleteMany({});
  await database.sectionAnswer.deleteMany({});
  await database.speakingRecording.deleteMany({});
  await database.writingResponse.deleteMany({});
  await database.speakingPrompt.deleteMany({});
  await database.writingPrompt.deleteMany({});
  await database.examSection.deleteMany({});
  await database.mockExam.deleteMany({});
  await database.classSubmission.deleteMany({});
  await database.lessonQuestion.deleteMany({});
  await database.classSection.deleteMany({});
  await database.courseClass.deleteMany({});
  await database.vocabEdge.deleteMany({});
  await database.learnerFocusTarget.deleteMany({});
  await database.practiceSession.deleteMany({});
  await database.courseNote.deleteMany({});
  await database.placementResult.deleteMany({});
  await database.learnerVocab.deleteMany({});
  await database.learnerGrammar.deleteMany({});
  await database.course.deleteMany({});
  await database.userInterest.deleteMany({});
  await database.userVoicePreference.deleteMany({});
  await database.pairingToken.deleteMany({});
  await database.notification.deleteMany({});
  await database.pushSubscription.deleteMany({});
  await database.discoveryChatError.deleteMany({});
  await database.apiUsageLog.deleteMany({});
  await database.feedback.deleteMany({});
  await database.episode.deleteMany({});
  await database.user.updateMany({
    data: {
      hasCompletedOnboarding: false,
      preferredLanguage: null,
      preferredAiProvider: null,
      preferredAiModel: null,
      preferredTtsProvider: null,
      preferredTtsModel: null,
    },
  });
  await database.modelPricingSnapshot.deleteMany({});
  await database.curriculum.deleteMany({ where: { source: 'generated' } });
}

export async function factoryReset(): Promise<FactoryResetResult> {
  const backend = await captureStorageBackend();
  const admitted = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const [profilesPreserved, episodes, courses] = await Promise.all([
        database.user.count(),
        database.episode.findMany({ select: { id: true, createdAt: true } }),
        database.course.findMany({ select: { id: true, createdAt: true } }),
      ]);
      const subjects = [
        ...episodes.map((episode) => ({
          subjectId: 'episode:' + episode.id,
          generation: episode.createdAt.getTime(),
        })),
        ...courses.map((course) => ({
          subjectId: 'course:' + course.id,
          generation: course.createdAt.getTime(),
        })),
      ];
      const jobs = subjects.length
        ? await admitLearningStorageDeletion({
            database,
            scope: { kind: 'instance' },
            subjects,
            currentBackend: backend,
          })
        : [];
      await deleteDatabaseState(database);
      return {
        profilesPreserved,
        episodesDeleted: episodes.length,
        jobs: jobs.map((job) => ({ id: job.id, files: job.pending })),
      };
    },
    { timeoutMs: 60_000 }
  );

  for (const job of admitted.jobs) {
    try {
      await runSottoStorageCleanup(prismaUnfiltered, job.id);
    } catch (error) {
      logger.error('Factory reset storage cleanup remains pending', {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const statuses = await sottoTransaction(prismaUnfiltered, async (database) =>
    Promise.all(admitted.jobs.map((job) => cleanup(database).get(job.id)))
  );
  const filesAttempted = admitted.jobs.reduce((total, job) => total + job.files, 0);
  const filesDeleted = statuses.reduce((total, job) => total + job.deleted, 0);
  const cleanupPendingJobs = statuses.filter((job) => job.phase !== 'complete').length;
  const result = {
    profilesPreserved: admitted.profilesPreserved,
    episodesDeleted: admitted.episodesDeleted,
    filesAttempted,
    filesDeleted,
    filesFailed: filesAttempted - filesDeleted,
    cleanupPendingJobs,
  };
  logger.warn('Factory reset completed', {
    ...Object.fromEntries(Object.entries(result).map(([key, value]) => [key, String(value)])),
  });
  return result;
}
