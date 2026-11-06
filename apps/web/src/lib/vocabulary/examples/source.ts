import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { durableQueueOperationId } from '@/lib/sidedoor/jobs/core/durable-queue';
import { assertVocabularyStudyOwner, vocabularyStudyStateSchema } from '../study-state';

export class VocabularyExamplesError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422
  ) {
    super(message);
  }
}

export const vocabularyExamplesContextSchema = z
  .object({
    sessionId: z.string().min(1),
    cardId: z.uuid(),
    courseId: z.string().min(1),
    userId: z.string().min(1),
    nativeLang: z.string().min(1),
    targetLang: z.string().min(1),
    level: z.string().min(1),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export async function readVocabularyExamplesSource(
  database: Prisma.TransactionClient,
  sessionId: string,
  cardId: string,
  userId: string
) {
  const session = await database.practiceSession.findFirst({
    where: { id: sessionId, course: { userId } },
    include: { course: { select: { nativeLang: true, targetLang: true, currentLevel: true } } },
  });
  if (!session?.vocabularyStudy || !['ACTIVE', 'COMPLETED'].includes(session.status))
    throw new VocabularyExamplesError('Vocabulary practice not found.', 404);
  const state = vocabularyStudyStateSchema.parse(session.vocabularyStudy);
  assertVocabularyStudyOwner(state, session, userId);
  const card = state.cards.find((item) => item.id === cardId);
  if (state.mode !== 'FLASHCARDS' || !card)
    throw new VocabularyExamplesError('Flashcard not found.', 404);
  const content = {
    lemma: card.lemma,
    meaning: card.meaning,
    nativeLang: state.nativeLang,
    targetLang: state.targetLang,
    level: session.course.currentLevel,
  };
  const sourceHash = createHash('sha256')
    .update(
      JSON.stringify({
        lemma: content.lemma,
        meaning: content.meaning,
        nativeLang: content.nativeLang,
        targetLang: content.targetLang,
      })
    )
    .digest('hex');
  const context = vocabularyExamplesContextSchema.parse({
    sessionId,
    cardId,
    courseId: session.courseId,
    userId,
    nativeLang: content.nativeLang,
    targetLang: content.targetLang,
    level: content.level,
    sourceHash,
  });
  const ownership = await captureCourseStorage(database, session.courseId);
  if (ownership.userId !== userId) throw new VocabularyExamplesError('Flashcard not found.', 404);
  const operationId = durableQueueOperationId(
    'interactions',
    JSON.stringify({
      kind: 'VOCABULARY_EXAMPLES.v1',
      sessionId,
      cardId,
      userId,
      courseId: context.courseId,
      sourceHash,
      instanceId: ownership.instanceId,
      scopes: ownership.scopes,
    })
  );
  return {
    context,
    ownership,
    operationId,
    answered: card.response !== null,
    word: { lemma: card.lemma, meaning: card.meaning },
  };
}

export async function requireVocabularyExamplesSource(
  database: Prisma.TransactionClient,
  context: z.infer<typeof vocabularyExamplesContextSchema>,
  scopes: readonly { subjectId: string; generation: number }[]
) {
  const current = await readVocabularyExamplesSource(
    database,
    context.sessionId,
    context.cardId,
    context.userId
  );
  if (
    !isDeepStrictEqual({ ...current.context, level: context.level }, context) ||
    !isDeepStrictEqual(current.ownership.scopes, scopes)
  )
    throw new VocabularyExamplesError('The flashcard or its ownership changed.', 409);
  return current;
}
