import type { Prisma } from '@/generated/prisma/client';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { readVocabularyExamplesSource } from './source';
import {
  nextVocabularyExamplesRetry,
  readCurrentVocabularyExamples,
  vocabularyExamplesSchema,
} from './work';

export async function readVocabularyExamplesStatus(
  database: Prisma.TransactionClient,
  sessionId: string,
  cardId: string,
  userId: string
) {
  const source = await readVocabularyExamplesSource(database, sessionId, cardId, userId);
  const current = await readCurrentVocabularyExamples(
    database,
    source.context,
    source.operationId,
    source.ownership.scopes
  );
  const blocking =
    current.record &&
    (await sottoJobExecutions(database).blockingStatus(
      current.operationId,
      current.record.fingerprint
    ));
  const request = {
    operationId: current.canRetry
      ? nextVocabularyExamplesRetry(current.operationId)
      : current.operationId,
    retryOf: current.canRetry ? current.operationId : current.previousOperationId,
    sourceHash: source.context.sourceHash,
  };
  let status: 'AVAILABLE' | 'PENDING' | 'READY' | 'FAILED' = current.record
    ? 'PENDING'
    : 'AVAILABLE';
  let error: string | undefined;
  let canRetry = current.canRetry;
  let examples: Array<{ sentence: string; translation: string | null }> | undefined;
  let completed = current.record?.complete ?? false;
  if (!completed && current.record && current.outcome?.status === 'READY' && !blocking) {
    const saved = await database.flashcardExample.findUnique({
      where: { practiceSessionId_cardId: { practiceSessionId: sessionId, cardId } },
    });
    if (
      !saved ||
      saved.courseId !== source.context.courseId ||
      saved.sourceHash !== source.context.sourceHash ||
      saved.operationId !== current.operationId ||
      saved.status !== 'PUBLISHING'
    )
      throw new Error('The saved examples could not be verified.');
    vocabularyExamplesSchema.parse(saved.examples);
    await sottoJobExecutions(database).requireParentDrained(
      current.operationId,
      current.record.fingerprint
    );
    const promoted = await database.flashcardExample.updateMany({
      where: {
        practiceSessionId: sessionId,
        cardId,
        operationId: current.operationId,
        status: 'PUBLISHING',
      },
      data: { status: 'READY' },
    });
    if (promoted.count !== 1) throw new Error('The examples changed during recovery.');
    await sottoJobOutbox(database).complete(current.operationId, current.record.fingerprint);
    completed = true;
  }
  if (current.outcome?.status === 'FAILED') {
    status = 'FAILED';
    error = current.outcome.error;
  } else if (blocking && blocking !== 'active') {
    status = 'FAILED';
    canRetry = false;
    error = 'The example request needs server recovery before another request can start.';
  } else if (completed) {
    if (current.outcome?.status !== 'READY') throw new Error('The saved examples are missing.');
    const saved = await database.flashcardExample.findUnique({
      where: { practiceSessionId_cardId: { practiceSessionId: sessionId, cardId } },
    });
    if (
      !saved ||
      saved.courseId !== source.context.courseId ||
      saved.sourceHash !== source.context.sourceHash ||
      saved.operationId !== current.operationId ||
      saved.status !== 'READY'
    )
      throw new Error('The saved examples could not be verified.');
    status = 'READY';
    examples = vocabularyExamplesSchema.parse(saved.examples).map((item) => ({
      sentence: item.sentence,
      translation: source.answered ? item.translation : null,
    }));
  }
  return {
    source,
    current,
    response: { status, request, canRetry, ...(error && { error }), ...(examples && { examples }) },
  };
}
