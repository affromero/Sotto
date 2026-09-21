import type { Job } from 'bullmq';
import { processDurableAudioStitching } from '@/workers/durable/audio/durable-audio-stitching';
import { processDurableInitialAudioStitching } from '@/workers/durable/audio/durable-initial-audio-stitching';

export async function processAudioStitching(
  job: Pick<Job<unknown>, 'id' | 'name' | 'data' | 'updateProgress'>,
  signal?: AbortSignal
): Promise<void> {
  if (job.name === 'audio-stitching.v1') return processDurableAudioStitching(job, signal);
  if (job.name === 'audio-stitching.v2') return processDurableInitialAudioStitching(job, signal);
  throw new Error('Audio stitching requires a canonical Sidedoor job reference');
}
