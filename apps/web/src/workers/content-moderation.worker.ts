import { Job } from 'bullmq';
import { moderateContent, recordContentFlag } from '@/lib/moderation';
import { logger } from '@/lib/logger';
import type { ModerateContentPayload } from '@/lib/queue';

/**
 * Async content moderation worker.
 * Scans podcast scripts via the OpenAI Moderation API
 * and creates ContentFlag records for flagged content. Admins can review
 * flags in the moderation dashboard.
 */
export async function processContentModeration(
  job: Job<ModerateContentPayload>
): Promise<{ flagged: boolean; categories: string[] }> {
  const { targetType, targetId, content, userId } = job.data;

  logger.info('Content moderation scan started', { targetType, targetId });

  const result = await moderateContent(content);

  if (result.flagged) {
    await recordContentFlag({
      targetType,
      targetId,
      userId,
      result,
      source: 'worker_scan',
    });

    logger.warn('Content flagged by moderation scanner', {
      targetType,
      targetId,
      categories: result.blockedCategories.join(', '),
    });
  }

  await job.updateProgress(100);

  return {
    flagged: result.flagged,
    categories: result.blockedCategories,
  };
}
