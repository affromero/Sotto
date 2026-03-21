import { Job } from 'bullmq';
import type { MonitorTtsProvidersPayload } from '@/lib/queue';
import { logger } from '@/lib/logger';
import { runTtsProviderMonitor } from '@/lib/tts-provider-monitor';

export async function processTtsProviderMonitor(job: Job<MonitorTtsProvidersPayload>): Promise<void> {
  logger.info('TTS provider monitor worker started');
  job.updateProgress(5);

  try {
    await runTtsProviderMonitor();
    job.updateProgress(100);
    logger.info('TTS provider monitor worker complete');
  } catch (error) {
    logger.error('TTS provider monitor worker failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
