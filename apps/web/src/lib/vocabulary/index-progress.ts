import type { LearningDatabase } from '../learning/database';

/** Complete means reviewed coverage of the entire extract, rather than just an exhausted queue. */
export async function updateVocabularyIndexProgress(database: LearningDatabase, indexId: string) {
  const index = await database.materialVocabularyIndex.findUniqueOrThrow({
    where: { id: indexId },
  });
  const chunks = await database.vocabularyIndexChunk.findMany({
    where: { indexId, status: { not: 'SPLIT' } },
    orderBy: { startOffset: 'asc' },
  });
  const contiguous =
    chunks.length > 0 &&
    chunks[0]!.startOffset === 0 &&
    chunks.at(-1)!.endOffset === index.textLength &&
    chunks.every(
      (chunk, position) => !position || chunks[position - 1]!.endOffset === chunk.startOffset
    );
  const unresolved = chunks.some((chunk) => chunk.status === 'UNRESOLVED');
  const failed = chunks.some((chunk) => chunk.status === 'FAILED');
  const complete = contiguous && chunks.every((chunk) => chunk.status === 'COMPLETE');
  return database.materialVocabularyIndex.update({
    where: { id: indexId },
    data: {
      status: unresolved ? 'UNRESOLVED' : failed ? 'FAILED' : complete ? 'COMPLETE' : 'ACTIVE',
      error: unresolved
        ? 'An indexing request has an unresolved outcome. Confirm execution cleanup before recovery.'
        : failed
          ? 'Some source sections could not be verified. Completed sections are saved; retry reviews only failed sections.'
          : null,
    },
  });
}
