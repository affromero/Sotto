import type { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

const STALE_VIDEO_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

export async function processDraftCleanup(_job: Job): Promise<void> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const result = await prisma.podcast.deleteMany({
    where: {
      status: 'DRAFT',
      updatedAt: { lt: thirtyDaysAgo },
    },
  });

  if (result.count > 0) {
    logger.info('Cleaned up stale drafts', { count: String(result.count) });
  }

  // Mark video generations stuck in non-terminal states as FAILED
  const staleThreshold = new Date(Date.now() - STALE_VIDEO_THRESHOLD_MS);

  const staleVideos = await prisma.videoGeneration.updateMany({
    where: {
      status: { in: ['PENDING', 'CLASSIFYING', 'GENERATING_VISUALS', 'GENERATING_AVATARS', 'COMPOSING'] },
      updatedAt: { lt: staleThreshold },
    },
    data: {
      status: 'FAILED',
      failureReason: 'Timed out — stuck in non-terminal state for over 20 minutes',
    },
  });

  if (staleVideos.count > 0) {
    logger.warn('Marked stale video generations as FAILED', { count: String(staleVideos.count) });
  }

  // Mark avatar overlays stuck in processing for >30 minutes as failed
  const staleAvatarThreshold = new Date(Date.now() - 30 * 60 * 1000);

  const staleAvatars = await prisma.avatarOverlay.updateMany({
    where: {
      status: { in: ['concatenating', 'submitting', 'processing'] },
      updatedAt: { lt: staleAvatarThreshold },
    },
    data: {
      status: 'failed',
      failureReason: 'Timed out — stuck in processing for over 30 minutes',
    },
  });

  if (staleAvatars.count > 0) {
    logger.warn('Marked stale avatar overlays as failed', { count: String(staleAvatars.count) });
  }
}
