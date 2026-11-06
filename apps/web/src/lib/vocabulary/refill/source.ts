import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { assertVocabularyStudyOwner, vocabularyStudyStateSchema } from '../study-state';

export class VocabularyRefillError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422
  ) {
    super(message);
  }
}

export const vocabularyRefillContextSchema = z
  .object({
    courseId: z.string().min(1),
    userId: z.string().min(1),
    generation: z.number().int().positive(),
    nativeLang: z.string().min(1),
    targetLang: z.string().min(1),
    level: z.string().min(1),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export async function readVocabularyRefillSource(
  database: Prisma.TransactionClient,
  courseId: string,
  userId: string,
  generation: number
) {
  const course = await database.course.findFirst({
    where: { id: courseId, userId },
    select: { nativeLang: true, targetLang: true, currentLevel: true },
  });
  if (!course) throw new VocabularyRefillError('Course not found.', 404);
  const ownership = await captureCourseStorage(database, courseId);
  if (ownership.userId !== userId) throw new VocabularyRefillError('Course not found.', 404);
  const content = {
    nativeLang: course.nativeLang,
    targetLang: course.targetLang,
    level: course.currentLevel,
  };
  const sourceHash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return {
    context: vocabularyRefillContextSchema.parse({
      courseId,
      userId,
      generation,
      ...content,
      sourceHash,
    }),
    ownership,
  };
}

export async function validateRefillTrigger(
  database: Prisma.TransactionClient,
  courseId: string,
  userId: string,
  sessionId: string | null
) {
  if (!sessionId) {
    const refill = await database.vocabularyRefill.findUnique({ where: { courseId } });
    return (
      (refill !== null && refill.triggerSessionId === null) ||
      (await database.learnerVocab.count({ where: { courseId } })) === 0
    );
  }
  const session = await database.practiceSession.findFirst({
    where: { id: sessionId, courseId, course: { userId } },
  });
  if (!session?.vocabularyStudy || session.status !== 'COMPLETED')
    throw new VocabularyRefillError('Completed vocabulary practice not found.', 404);
  const state = vocabularyStudyStateSchema.parse(session.vocabularyStudy);
  assertVocabularyStudyOwner(state, session, userId);
  if (state.mode !== 'FLASHCARDS') return false;
  if (state.requestedWordIds.length === 0) return true;
  const { sottoJobOutbox } = await import('@/lib/sidedoor/jobs/core/job-delivery');
  const { readVocabularyRefillOutcome, vocabularyRefillOperationId, vocabularyRefillWorkSchema } =
    await import('./work');
  const record = await sottoJobOutbox(database).read(sessionId);
  if (!record?.complete || record.job.handler !== 'interactions' || record.job.version !== 4)
    return false;
  const work = vocabularyRefillWorkSchema.safeParse(record.job.payload);
  if (
    !work.success ||
    work.data.context.courseId !== courseId ||
    work.data.context.userId !== userId ||
    vocabularyRefillOperationId(courseId, work.data.context.generation) !== sessionId
  )
    return false;
  const ownership = await captureCourseStorage(database, courseId);
  if (!isDeepStrictEqual(record.job.scopes, ownership.scopes)) return false;
  const outcome = await readVocabularyRefillOutcome(database, sessionId, record.fingerprint);
  return (
    outcome?.status === 'READY' &&
    isDeepStrictEqual([...state.requestedWordIds].sort(), [...outcome.wordIds].sort())
  );
}

export async function requireVocabularyRefillSource(
  database: Prisma.TransactionClient,
  context: z.infer<typeof vocabularyRefillContextSchema>,
  scopes: readonly { subjectId: string; generation: number }[]
) {
  const current = await readVocabularyRefillSource(
    database,
    context.courseId,
    context.userId,
    context.generation
  );
  if (
    !isDeepStrictEqual(current.context, context) ||
    !isDeepStrictEqual(current.ownership.scopes, scopes)
  )
    throw new VocabularyRefillError('The course or its ownership changed.', 409);
  return current;
}
