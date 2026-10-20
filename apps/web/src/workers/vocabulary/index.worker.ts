import type { Job } from 'bullmq';
import { vocabularyIndexPayloadSchema } from '@/lib/vocabulary/index-state';
import { prepareVocabularyIndex } from './index-prepare';
import { processVocabularyIndexChunk } from './index-chunk';

export async function processVocabularyIndex(job: Job<unknown>, signal?: AbortSignal) {
  const payload = vocabularyIndexPayloadSchema.parse(job.data);
  if (payload.phase === 'PREPARE') return prepareVocabularyIndex(job, signal);
  return processVocabularyIndexChunk(job, signal);
}
