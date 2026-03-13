import { type Job } from 'bullmq';
import type { LipSyncTestPayload } from '@/lib/queue';
import { submitFalLipSync, pollFalLipSync } from '@/lib/fal-lip-sync';
import { logger } from '@/lib/logger';

export async function processLipSyncTest(job: Job<LipSyncTestPayload>): Promise<{ videoUrl: string }> {
  const { audioUrl, avatarImageUrl, avatarModelId } = job.data;

  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error('FAL_KEY is not configured');

  logger.info('Starting lip-sync test', { avatarModelId });

  const { statusUrl, resultUrl } = await submitFalLipSync({
    modelId: avatarModelId,
    imageUrl: avatarImageUrl,
    audioUrl,
    apiKey,
  });

  await job.updateProgress(30);

  // Short clips — 3min timeout is generous
  const result = await pollFalLipSync(statusUrl, resultUrl, apiKey, 180_000);

  await job.updateProgress(100);

  logger.info('Lip-sync test complete', { avatarModelId, videoUrl: result.videoUrl });

  return { videoUrl: result.videoUrl };
}
