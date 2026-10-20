import type { LearningDatabase } from '../../learning/database';
import { vocabularyAudioPayloadSchema } from '../audio/state';
import {
  vocabularyIndexPayloadSchema,
  vocabularyIndexOperationSchema,
  vocabularyIndexGrant,
} from '../index-state';
import { updateVocabularyIndexProgress } from '../index-progress';

/** Called only after canonical terminal delivery and authority validation. */
export async function settleVocabularyQueueFailure(
  database: LearningDatabase,
  handler: string,
  payload: unknown,
  userId: string
): Promise<boolean> {
  if (handler === 'vocabulary-audio') {
    const input = vocabularyAudioPayloadSchema.parse(payload);
    if (input.userId !== userId) throw new Error('Vocabulary failure recipient changed.');
    const changed = await database.vocabularyPronunciation.updateMany({
      where: {
        id: input.assetId,
        generation: input.generation,
        status: 'QUEUED',
        course: { userId },
      },
      data: {
        status: 'FAILED',
        error: 'Local pronunciation could not start. Check the worker and retry.',
      },
    });
    return changed.count > 0;
  }
  const input = vocabularyIndexPayloadSchema.parse(payload);
  if (input.userId !== userId) throw new Error('Vocabulary failure recipient changed.');
  if (input.phase === 'PREPARE') {
    const index = await database.materialVocabularyIndex.findFirst({
      where: { id: input.indexId, generation: input.generation, course: { userId } },
    });
    if (!index) return false;
    if (index.status === 'COMPLETE') return true;
    const changed = await database.vocabularyIndexChunk.updateMany({
      where: { indexId: index.id, status: 'PENDING' },
      data: {
        status: 'FAILED',
        error: 'Indexing preparation could not start. Check the worker and retry.',
      },
    });
    if (changed.count) await updateVocabularyIndexProgress(database, index.id);
    else if (index.status === 'PENDING')
      await database.materialVocabularyIndex.update({
        where: { id: index.id },
        data: {
          status: 'FAILED',
          error: 'Indexing preparation could not start. Check the worker and retry.',
        },
      });
    // Preparation admits children atomically and never dispatches a model request.
    return true;
  }
  const chunk = await database.vocabularyIndexChunk.findFirst({
    where: {
      id: input.chunkId,
      generation: input.generation,
      status: 'QUEUED',
      index: { course: { userId } },
    },
  });
  if (!chunk) return false;
  const operation = vocabularyIndexOperationSchema.parse(chunk.operation);
  await vocabularyIndexGrant(database, operation).revoke(operation.grant);
  await database.vocabularyIndexChunk.update({
    where: { id: chunk.id },
    data: {
      status: 'FAILED',
      error: 'Indexing admission expired or the worker could not start. Retry the import.',
    },
  });
  await updateVocabularyIndexProgress(database, chunk.indexId);
  return true;
}
