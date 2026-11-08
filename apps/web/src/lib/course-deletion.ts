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
  /** Targets discovered so far; pending cleanup may discover more. */
  filesAttempted: number;
  filesDeleted: number;
  /** Discovered targets still awaiting cleanup. */
  filesFailed: number;
  /** Nonzero when cleanup is incomplete, including undiscovered targets. */
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

async function courseEpisodeIds(
  database: Prisma.TransactionClient,
  courseId: string,
  userId: string
) {
  const [classSections, examSections, practiceSessions, assessmentSections] = await Promise.all([
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
    database.classAssessmentSection.findMany({
      where: { assessment: { courseId }, episodeId: { not: null } },
      select: {
        episodeId: true,
        episode: {
          select: {
            userId: true,
            classSection: { select: { class: { select: { courseId: true } } } },
            examSection: { select: { exam: { select: { courseId: true } } } },
            practiceSession: { select: { courseId: true } },
          },
        },
        assessment: { select: { userId: true, course: { select: { userId: true } } } },
      },
    }),
  ]);
  for (const section of assessmentSections) {
    if (
      !section.episode ||
      section.episode.userId !== section.assessment.userId ||
      section.assessment.userId !== section.assessment.course.userId ||
      (section.episode.classSection && section.episode.classSection.class.courseId !== courseId) ||
      (section.episode.examSection && section.episode.examSection.exam.courseId !== courseId) ||
      (section.episode.practiceSession && section.episode.practiceSession.courseId !== courseId)
    )
      throw new Error('Assessment episode ownership changed during deletion');
  }
  const episodeIds = [
    ...new Set([
      ...classSections.flatMap((section) => (section.episodeId ? [section.episodeId] : [])),
      ...examSections.flatMap((section) => (section.episodeId ? [section.episodeId] : [])),
      ...practiceSessions.flatMap((session) => (session.episodeId ? [session.episodeId] : [])),
      ...assessmentSections.flatMap((section) => (section.episodeId ? [section.episodeId] : [])),
    ]),
  ];
  if (episodeIds.length) {
    const episodes = await database.episode.findMany({
      where: { id: { in: episodeIds } },
      select: {
        userId: true,
        classSection: { select: { class: { select: { courseId: true } } } },
        examSection: { select: { exam: { select: { courseId: true } } } },
        practiceSession: { select: { courseId: true } },
        assessmentSection: { select: { assessment: { select: { courseId: true } } } },
      },
    });
    if (
      episodes.length !== episodeIds.length ||
      episodes.some(
        (episode) =>
          episode.userId !== userId ||
          (episode.classSection && episode.classSection.class.courseId !== courseId) ||
          (episode.examSection && episode.examSection.exam.courseId !== courseId) ||
          (episode.practiceSession && episode.practiceSession.courseId !== courseId) ||
          (episode.assessmentSection && episode.assessmentSection.assessment.courseId !== courseId)
      )
    )
      throw new Error('Course episode ownership changed during deletion');
  }
  return episodeIds;
}

/** Revoke storage authority and remove one course with its generated episodes atomically. */
export async function deleteCourseCompletely(courseId: string): Promise<CourseDeletionResult> {
  const backend = await captureStorageBackend();
  const admitted = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const course = await database.course.findUniqueOrThrow({
        where: { id: courseId },
        select: { createdAt: true, userId: true },
      });
      const episodeIds = await courseEpisodeIds(database, courseId, course.userId);
      const materials = await database.courseMaterial.findMany({
        where: { courseId },
        select: { id: true, createdAt: true },
      });
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
          ...materials.map((material) => ({
            subjectId: `material:${material.id}`,
            generation: material.createdAt.getTime(),
          })),
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
        jobs: jobs.map((job) => ({ id: job.id })),
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
  const filesAttempted = statuses.reduce((total, job) => total + job.pending + job.deleted, 0);
  const filesDeleted = statuses.reduce((total, job) => total + job.deleted, 0);
  const filesFailed = statuses.reduce((total, job) => total + job.pending, 0);
  const cleanupPendingJobs = statuses.filter((job) => job.phase !== 'complete').length;
  const result = {
    episodesDeleted: admitted.episodeIds.length,
    filesAttempted,
    filesDeleted,
    filesFailed,
    cleanupPendingJobs,
  };
  logger.warn('Course deleted completely', {
    courseId,
    ...Object.fromEntries(Object.entries(result).map(([key, value]) => [key, String(value)])),
  });
  return result;
}
