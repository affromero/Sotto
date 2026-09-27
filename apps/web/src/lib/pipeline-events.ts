import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Fire-and-forget stage completion logger. Internal .catch() ensures a DB
 * logging failure never crashes a pipeline job.
 */
export async function logPipelineStageComplete(
  episodeId: string,
  stage: string,
  message?: string
): Promise<void> {
  await prisma.pipelineEvent
    .create({
      data: { episodeId, stage, type: 'complete', message: message ?? `${stage} completed` },
    })
    .catch((err) => {
      logger.warn('Failed to log pipeline stage completion', {
        episodeId,
        stage,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}
