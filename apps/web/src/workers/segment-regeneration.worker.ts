import type { Job } from 'bullmq';
import { processDurableSegmentRegeneration } from '@/workers/durable/audio/durable-segment-regeneration';

export async function processSegmentRegeneration(
  job: Job<unknown>,
  signal?: AbortSignal
): Promise<void> {
  if (job.name !== 'segment-regeneration.v1')
    throw new Error(
      'Unsupported segment regeneration job version. Migrate pending jobs before starting workers.'
    );
  await processDurableSegmentRegeneration(job, signal);
}
