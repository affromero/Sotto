import { StorageCleanupJournal } from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';
import { prismaUnfiltered } from '@/lib/prisma';
import { captureStorageBackend } from '@/lib/r2';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { runSottoStorageCleanup } from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

export interface CourseDeletionResult {
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

async function courseEpisodeIds(database: Prisma.TransactionClient, courseId: string) {
  const [classSections, examSections, practiceSessions] = await Promise.all([
    database.classSection.findMany({
      where: { class: { courseId }, episodeId: { not: null } },
      select: { episodeId: true },
    }),
    database.examSection.findMany({
      where: { exam: { courseId }, episodeId: { not: null } },
      select: { episodeId: true },
    }),
    database.practiceSession.findMany({
      where: { courseId, episodeId: { not: null } },
      select: { episodeId: true },
    }),
  ]);
  return [
    ...new Set([
      ...classSections.flatMap((section) => (section.episodeId ? [section.episodeId] : [])),
      ...examSections.flatMap((section) => (section.episodeId ? [section.episodeId] : [])),
      ...practiceSessions.flatMap((session) => (session.episodeId ? [session.episodeId] : [])),
    ]),
  ];
}

/** Revoke storage authority and remove one course with its generated episodes atomically. */
export async function deleteCourseCompletely(courseId: string): Promise<CourseDeletionResult> {
  const backend = await captureStorageBackend();
  const admitted = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const course = await database.course.findUniqueOrThrow({
        where: { id: courseId },
        select: { createdAt: true },
      });
      const episodeIds = await courseEpisodeIds(database, courseId);
      const episodes = episodeIds.length
        ? await database.episode.findMany({
            where: { id: { in: episodeIds } },
            select: { id: true, createdAt: true },
          })
        : [];
      if (episodes.length !== episodeIds.length)
        throw new Error('Course episode ownership changed during deletion');
      const jobs = await admitLearningStorageDeletion({
        database,
        scope: { kind: 'course', id: courseId, episodeIds },
        subjects: [
          { subjectId: 'course:' + courseId, generation: course.createdAt.getTime() },
          ...episodes.map((episode) => ({
            subjectId: 'episode:' + episode.id,
            generation: episode.createdAt.getTime(),
          })),
        ],
        currentBackend: backend,
      });
      await database.course.delete({ where: { id: courseId } });
      if (episodeIds.length)
        await database.episode.deleteMany({ where: { id: { in: episodeIds } } });
      return {
        episodeIds,
        jobs: jobs.map((job) => ({ id: job.id, files: job.pending })),
      };
    },
    { timeoutMs: 60_000 }
  );

  for (const job of admitted.jobs) {
    try {
      await runSottoStorageCleanup(prismaUnfiltered, job.id);
    } catch (error) {
      logger.error('Course storage cleanup remains pending', {
        courseId,
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
    episodesDeleted: admitted.episodeIds.length,
    filesAttempted,
    filesDeleted,
    filesFailed: filesAttempted - filesDeleted,
    cleanupPendingJobs,
  };
  logger.warn('Course deleted completely', {
    courseId,
    ...Object.fromEntries(Object.entries(result).map(([key, value]) => [key, String(value)])),
  });
  return result;
}
