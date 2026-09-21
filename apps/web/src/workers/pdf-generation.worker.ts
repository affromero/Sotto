import type { Job } from 'bullmq';
import { processDurablePdfGeneration } from '@/workers/durable/media/durable-pdf-generation';

export async function processPdfGeneration(
  job: Pick<Job<unknown>, 'id' | 'name' | 'data' | 'updateProgress'>,
  signal?: AbortSignal
): Promise<void> {
  if (job.name !== 'pdf-generation.v1' && job.name !== 'pdf-generation.v2')
    throw new Error('Transcript generation requires a canonical Sidedoor job reference');
  await processDurablePdfGeneration(job, signal);
}
