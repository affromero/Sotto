import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import type { ClassTeaching } from '@sotto/shared';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { QuizRetryContext } from '@/lib/classes/quiz/retry';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { learningScriptHash } from '@/lib/learning/script-hash';
import { assertClassGeneration } from '@/lib/learning/classes/formative/class-generation-state';
import { requireListeningAttachmentFence } from '@/lib/learning/classes/progress/listening-attachment-fence';
import { createSegmentsAndQueueAudio } from '@/lib/segment-creator';
import { SectionQualityError } from '@/lib/classes/section-quality';
import { requireStoredInitialA1Listening } from '@/lib/classes/quality/section-review/stored-section-review';
import { listeningReviewAuthority } from './review-authority';

interface ListeningComprehensionQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

// Content-only listening generation: builds the CLASS episode and script
// and the comprehension questions, feeds generated vocab into the memory graph,
// and returns both. The caller decides where to persist the questions (a class
// section, or a practice session). No ClassSection/LessonQuestion rows here.
export interface ListeningContentParams {
  ttsProvider?: import('@/lib/providers/tts-registry').TtsProviderId | null;
  deferAudio?: boolean;
  userId: string;
  execution: SottoProviderExecution;
  courseId: string;
  level: string;
  nativeLang: string;
  targetLang: string;
  objective: string;
  mustIncludeVocab: Array<{ word: string; translation: string }>;
  /** Provenance for graph vocab (a class id). Undefined for practice sessions. */
  firstSeenClassId?: string;
  generationClass?: { classId: string; attempt: number };
  note?: string;
  teaching?: ClassTeaching;
  retry?: QuizRetryContext;
  /**
   * Optional sourced-class content: a CEFR-leveled passage in the target
   * language (from `prepareClassSource`). When present, the listening episode
   * derives from it with `[N]` citations and real, verified references.
   */
  sourceContent?: string;
  sourceMetadata?: { title?: string; author?: string; publishedDate?: string; siteName?: string };
  sourceUrl?: string;
  reviewScope?: { classId: string; attempt: number };
}

export interface ListeningContent {
  episodeId: string;
  comprehensionQuestions: ListeningComprehensionQuestion[];
  turns: Array<{ speaker: string; text: string; direction?: string }>;
}

export class ListeningEpisodeChangedError extends Error {
  constructor() {
    super('Listening episode changed before script publication.');
  }
}

export async function authorizeListeningMaterial(
  database: Prisma.TransactionClient,
  p: ListeningContentParams
) {
  p.execution.signal?.throwIfAborted();
  const actor = await p.execution.authorize(database);
  if (actor.userId !== p.userId) throw new Error('Listening owner changed.');
  const course = await database.course.findFirst({
    where: { id: p.courseId, userId: actor.userId },
    select: { id: true },
  });
  if (!course) throw new Error('Listening course is unavailable.');
  if (p.generationClass) {
    if (p.firstSeenClassId !== p.generationClass.classId)
      throw new Error('Listening class changed.');
    await assertClassGeneration(
      database,
      p.generationClass.classId,
      p.generationClass.attempt,
      actor.userId
    );
    const cls = await database.courseClass.findFirst({
      where: { id: p.generationClass.classId, courseId: course.id },
      select: { id: true },
    });
    if (!cls) throw new Error('Listening class changed.');
  }
  p.execution.signal?.throwIfAborted();
}

export async function requireUnqueuedListeningEpisode(
  database: Prisma.TransactionClient,
  p: ListeningContentParams,
  episode: { id: string; createdAt: Date }
) {
  await requireListeningAttachmentFence(database);
  await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${episode.id} AND "userId" = ${p.userId} FOR UPDATE`;
  const current = await database.episode.findFirst({
    where: {
      id: episode.id,
      userId: p.userId,
      createdAt: episode.createdAt,
      source: 'CLASS',
      status: 'PENDING',
      deletedAt: null,
      audioGenerationKey: null,
      classSection: { is: null },
      practiceSession: { is: null },
      examSection: { is: null },
      assessmentSection: { is: null },
      assessmentAudioAssessmentId: null,
    },
    select: { id: true },
  });
  if (!current) throw new ListeningEpisodeChangedError();
}

/** Admit audio only after the caller has persisted the final learning association. */
export async function queueListeningAudio(
  content: ListeningContent,
  execution: SottoProviderExecution,
  parent:
    | { classId: string; attempt: number; requireInitialA1Proof?: boolean }
    | { practiceSessionId: string }
    | { examId: string; examSectionId: string }
) {
  const classAttempt = 'classId' in parent ? parent : undefined;
  const registerAudioEpisode = execution.registerAudioEpisode;
  listeningReviewAuthority.verifyIfReviewed(content);
  const reviewed = listeningReviewAuthority.boundIfReviewed(content);
  if (classAttempt?.requireInitialA1Proof && !reviewed)
    throw new SectionQualityError('The initial A1 listening review is missing.');
  if (
    reviewed &&
    (!classAttempt ||
      classAttempt.classId !== reviewed.classId ||
      classAttempt.attempt !== reviewed.attempt)
  )
    throw new SectionQualityError('The reviewed listening class changed before audio admission.');
  const turns = structuredClone(content.turns);
  await createSegmentsAndQueueAudio(content.episodeId, turns, {
    authorize: async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId) throw new Error('Listening owner changed.');
      if ('classId' in parent)
        await assertClassGeneration(database, parent.classId, parent.attempt, actor.userId);
      else if ('practiceSessionId' in parent)
        await database.$queryRaw`
          SELECT session.id FROM "PracticeSession" session
          JOIN "Course" course ON course.id = session."courseId"
          WHERE session.id = ${parent.practiceSessionId} AND course."userId" = ${actor.userId}
          FOR UPDATE OF session
        `;
      else
        await database.$queryRaw`
          SELECT section.id FROM "ExamSection" section
          JOIN "MockExam" exam ON exam.id = section."examId"
          WHERE section.id = ${parent.examSectionId} AND exam.id = ${parent.examId}
            AND exam."userId" = ${actor.userId}
          FOR UPDATE OF exam, section
        `;
      const locked = await database.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Episode" WHERE id = ${content.episodeId} AND "userId" = ${actor.userId} FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error('Listening audio source changed before admission.');
      await database.$queryRaw`
        SELECT script.id FROM "Script" script
        JOIN "Episode" episode ON episode.id = script."episodeId"
        WHERE episode.id = ${content.episodeId} AND episode."userId" = ${actor.userId}
        FOR UPDATE OF script
      `;
      const episode = await database.episode.findFirst({
        where: {
          id: content.episodeId,
          userId: actor.userId,
          source: 'CLASS',
          status: 'SCRIPT_READY',
          deletedAt: null,
          audioGenerationKey: null,
          ...('classId' in parent
            ? {
                classSection: {
                  is: {
                    classId: parent.classId,
                    attempt: parent.attempt,
                    withdrawn: false,
                    skill: 'LISTENING',
                    status: 'READY',
                  },
                },
              }
            : 'practiceSessionId' in parent
              ? {
                  practiceSession: {
                    is: {
                      id: parent.practiceSessionId,
                      course: { userId: actor.userId },
                      kind: { in: ['FULL', 'LISTENING'] },
                      status: { in: ['ACTIVE', 'GENERATING'] },
                      listeningScriptHash: learningScriptHash(turns),
                    },
                  },
                }
              : {
                  examSection: {
                    is: {
                      id: parent.examSectionId,
                      examId: parent.examId,
                      skill: 'LISTENING',
                      format: 'listening',
                      status: { in: ['PENDING', 'GENERATING', 'READY'] },
                      exam: { userId: actor.userId, status: 'GENERATING' },
                    },
                  },
                }),
        },
        select: { script: { select: { turns: true } } },
      });
      if (
        !episode?.script ||
        learningScriptHash(episode.script.turns) !== learningScriptHash(turns)
      )
        throw new Error('Listening audio source changed before admission.');
      execution.signal?.throwIfAborted();
      return actor;
    },
    onPrepared: async (database, audioGenerationKey) => {
      listeningReviewAuthority.verifyIfReviewed(content);
      if (classAttempt)
        await assertClassGeneration(
          database,
          classAttempt.classId,
          classAttempt.attempt,
          execution.userId
        );
      if (reviewed) {
        const current = listeningReviewAuthority.boundIfReviewed(content);
        if (!current || !isDeepStrictEqual(current, reviewed))
          throw new SectionQualityError(
            'The reviewed listening material changed before audio admission.'
          );
        await requireStoredInitialA1Listening(database, reviewed.classId, current);
      }
      await registerAudioEpisode?.(database, content.episodeId, audioGenerationKey);
    },
  });
  listeningReviewAuthority.verifyIfReviewed(content);
}

/**
 * How many of a class's references must verify for the class to ship.
 *
 * A simple majority, and never fewer than one. The reasoning: a class whose
 * sources are mostly sound is still worth listening to — the failed entries are
 * shown as failed — while one where half or more of the citations cannot be
 * stood up is not something to teach from, however much was spent generating
 * it. Deliberately not reusing `getMinReferenceCount`: that governs how many
 * references a script must *contain*, which is a question about depth and
 * duration, not about how many of them survived checking.
 */
export function minimumVerifiedReferences(total: number): number {
  if (total <= 0) return 0;
  return Math.max(1, Math.ceil(total / 2));
}

/** Retire only unqueued class audio; admitted or uncertain audio retains its own lifecycle. */
export async function failUnqueuedClassListening(episodeId: string, userId: string): Promise<void> {
  await prisma.episode
    .updateMany({
      where: {
        id: episodeId,
        userId,
        source: 'CLASS',
        status: 'SCRIPT_READY',
        audioGenerationKey: null,
      },
      data: {
        status: 'FAILED',
        failureReason: 'Audio generation did not start because preparation did not finish.',
      },
    })
    .catch((error: unknown) => {
      logger.error('Failed to retire unqueued class listening', {
        episodeId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}
