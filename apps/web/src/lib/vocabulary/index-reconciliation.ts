import type { LearningDatabase } from '../learning/database';
import { sottoJobExecutions } from '../sidedoor/jobs/core/job-execution-lifetime';
import { sottoJobOutbox } from '../sidedoor/jobs/core/job-delivery';
import {
  validateVocabularyIndex,
  vocabularyIndexGrant,
  vocabularyIndexOperationSchema,
} from './index-state';
import { updateVocabularyIndexProgress } from './index-progress';
import { VocabularyStudyNotFound, VocabularyStudyUnavailable } from './study-state';

/** Polling fences stale workers. It neither dispatches a model call nor confirms remote cleanup. */
export async function reconcileVocabularyIndex(
  database: LearningDatabase,
  indexId: string,
  userId: string
) {
  try {
    await validateVocabularyIndex(database, indexId, userId);
  } catch (error) {
    if (!(error instanceof VocabularyStudyNotFound || error instanceof VocabularyStudyUnavailable))
      throw error;
    await database.materialVocabularyIndex.updateMany({
      where: { id: indexId, course: { userId } },
      data: { status: 'FAILED', error: error.message },
    });
    return;
  }
  const chunks = await database.vocabularyIndexChunk.findMany({
    where: { indexId, status: 'RUNNING' },
  });
  let changed = false;
  for (const chunk of chunks) {
    const operation = vocabularyIndexOperationSchema.parse(chunk.operation);
    const receipt = await sottoJobOutbox(database).read(operation.id);
    if (!receipt) throw new Error('Indexing execution receipt is missing.');
    const blocker = await sottoJobExecutions(database).blockingStatus(
      operation.id,
      receipt.fingerprint
    );
    if (blocker !== 'cleanup-unconfirmed' && Date.now() - chunk.updatedAt.getTime() <= 30_000)
      continue;
    await vocabularyIndexGrant(database, operation).revoke(operation.grant);
    await database.vocabularyIndexChunk.updateMany({
      where: { id: chunk.id, generation: chunk.generation, status: 'RUNNING' },
      data: {
        status: 'UNRESOLVED',
        error: 'An interrupted indexing worker must be reconciled before recovery.',
      },
    });
    changed = true;
  }
  if (changed) await updateVocabularyIndexProgress(database, indexId);
}
