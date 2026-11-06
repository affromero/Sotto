import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { unseenVocabularyWhere } from '@/lib/learning/vocabulary/memory';
import { readVocabularyRefillSource, validateRefillTrigger, VocabularyRefillError } from './source';
import {
  readVocabularyRefillOutcome,
  vocabularyRefillOperationId,
  vocabularyRefillWorkSchema,
} from './work';

export async function readVocabularyRefillStatus(
  database: Prisma.TransactionClient,
  courseId: string,
  userId: string,
  sessionId: string | null
) {
  const row = await database.vocabularyRefill.findUnique({ where: { courseId } });
  const source = await readVocabularyRefillSource(
    database,
    courseId,
    userId,
    (row?.generation ?? 0) + 1
  );
  if (!(await validateRefillTrigger(database, courseId, userId, sessionId)))
    return { source, row, response: { status: 'NOT_NEEDED' as const, canRetry: false } };
  const unseen = await database.learnerVocab.count({
    where: { courseId, ...unseenVocabularyWhere() },
  });
  const ready = async (operationId: string, added: number, wordIds: string[]) => {
    if (!wordIds.length || wordIds.length > 8 || new Set(wordIds).size !== wordIds.length)
      throw new VocabularyRefillError('The saved words could not be verified.', 409);
    const owned = await database.learnerVocab.count({ where: { courseId, id: { in: wordIds } } });
    if (owned !== wordIds.length)
      throw new VocabularyRefillError('The saved words changed. Open the dictionary.', 409);
    return {
      status: 'READY' as const,
      canRetry: false,
      added,
      nextSessionId: operationId,
      wordIds,
    };
  };
  if (row && ['PENDING', 'PUBLISHING', 'UNRESOLVED'].includes(row.status)) {
    const record = await sottoJobOutbox(database).read(row.operationId);
    if (!record || record.job.handler !== 'interactions' || record.job.version !== 4)
      throw new VocabularyRefillError('The vocabulary refill needs server recovery.', 409);
    const work = vocabularyRefillWorkSchema.parse(record.job.payload);
    if (
      work.context.courseId !== courseId ||
      work.context.userId !== userId ||
      work.context.generation !== row.generation ||
      work.context.sourceHash !== row.sourceHash ||
      work.triggerSessionId !== row.triggerSessionId ||
      !isDeepStrictEqual(record.job.scopes, source.ownership.scopes)
    )
      throw new VocabularyRefillError('The vocabulary refill could not be verified.', 409);
    const outcome = await readVocabularyRefillOutcome(
      database,
      row.operationId,
      record.fingerprint
    );
    const blocked = await sottoJobExecutions(database).blockingStatus(
      row.operationId,
      record.fingerprint
    );
    if (row.status === 'PUBLISHING' && outcome?.status === 'READY' && !blocked) {
      if (row.added !== outcome.added || !isDeepStrictEqual(row.wordIds, outcome.wordIds))
        throw new VocabularyRefillError('The saved refill could not be verified.', 409);
      await sottoJobExecutions(database).requireParentDrained(row.operationId, record.fingerprint);
      const completed = await database.vocabularyRefill.updateMany({
        where: {
          courseId,
          operationId: row.operationId,
          status: 'PUBLISHING',
          added: outcome.added,
        },
        data: { status: 'READY' },
      });
      if (completed.count !== 1)
        throw new VocabularyRefillError('The refill changed during recovery.', 409);
      await sottoJobOutbox(database).complete(row.operationId, record.fingerprint);
      return {
        source,
        row,
        response: await ready(row.operationId, outcome.added, outcome.wordIds),
      };
    }
    if (
      row.status === 'UNRESOLVED' ||
      (blocked && blocked !== 'active') ||
      outcome?.status === 'FAILED'
    )
      return {
        source,
        row,
        response: {
          status: 'FAILED' as const,
          canRetry: false,
          error: 'The vocabulary refill needs server recovery before another request.',
        },
      };
    return { source, row, response: { status: 'PENDING' as const, canRetry: false } };
  }
  if (row?.status === 'READY' && row.triggerSessionId === sessionId) {
    const record = await sottoJobOutbox(database).read(row.operationId);
    if (
      !record?.complete ||
      record.job.handler !== 'interactions' ||
      record.job.version !== 4 ||
      !isDeepStrictEqual(record.job.scopes, source.ownership.scopes)
    )
      throw new VocabularyRefillError('The saved refill could not be verified.', 409);
    const outcome = await readVocabularyRefillOutcome(
      database,
      row.operationId,
      record.fingerprint
    );
    if (
      outcome?.status !== 'READY' ||
      row.added !== outcome.added ||
      !isDeepStrictEqual(row.wordIds, outcome.wordIds)
    )
      throw new VocabularyRefillError('The saved refill could not be verified.', 409);
    return { source, row, response: await ready(row.operationId, outcome.added, outcome.wordIds) };
  }
  if (unseen > 0)
    return { source, row, response: { status: 'NOT_NEEDED' as const, canRetry: false } };
  const generation = (row?.generation ?? 0) + 1;
  const next = await readVocabularyRefillSource(database, courseId, userId, generation);
  const request = {
    operationId: vocabularyRefillOperationId(courseId, generation),
    generation,
    triggerSessionId: sessionId,
    sourceHash: next.context.sourceHash,
  };
  if (row?.status === 'FAILED') {
    const record = await sottoJobOutbox(database).read(row.operationId);
    if (!record || !record.complete)
      throw new VocabularyRefillError('The previous refill needs recovery.', 409);
    const outcome = await readVocabularyRefillOutcome(
      database,
      row.operationId,
      record.fingerprint
    );
    const blocked = await sottoJobExecutions(database).blockingStatus(
      row.operationId,
      record.fingerprint
    );
    const canRetry = outcome?.status === 'FAILED' && !outcome.uncertain && !blocked;
    return {
      source: next,
      row,
      response: {
        status: 'FAILED' as const,
        canRetry,
        request,
        error: canRetry
          ? 'New words could not be prepared. You can try again.'
          : 'The previous refill needs server recovery.',
      },
    };
  }
  return {
    source: next,
    row,
    response: { status: 'AVAILABLE' as const, canRetry: false, request },
  };
}
