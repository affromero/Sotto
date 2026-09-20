import type { Job } from 'bullmq';
import { processDurableWaveformGeneration } from '@/workers/durable/media/durable-waveform-generation';

export async function processWaveformGeneration(
  job: Job<unknown>,
  signal?: AbortSignal
): Promise<void> {
  if (job.name !== 'waveform-generation.v1')
    throw new Error('Waveform generation requires a canonical Sidedoor job reference');
  await processDurableWaveformGeneration(job, signal);
}
