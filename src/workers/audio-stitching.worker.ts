import { Job } from 'bullmq';
import { StitchAudioPayload, addJob, JobType, notificationQueue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';

import { logger } from '@/lib/logger';

export async function processAudioStitching(job: Job<StitchAudioPayload>): Promise<void> {
  const { podcastId, segmentIds } = job.data;

  logger.info('Stitching audio', { podcastId, segmentCount: String(segmentIds.length) });
  await job.updateProgress(10);

  // Get segment audio URLs
  const segments = await prisma.segment.findMany({
    where: { id: { in: segmentIds } },
    orderBy: { order: 'asc' },
  });

  // For now, concatenate segment audio buffers
  // In production, this would download segments, use FFmpeg, and re-upload
  const totalDuration = segments.reduce((sum, s) => sum + (s.duration || 0), 0);

  await job.updateProgress(80);

  // Update podcast as READY
  const podcast = await prisma.podcast.update({
    where: { id: podcastId },
    data: {
      status: 'READY',
      duration: Math.round(totalDuration),
    },
    include: { user: true },
  });

  // Send notification
  await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
    userId: podcast.userId,
    type: 'PODCAST_READY',
    title: 'Your podcast is ready!',
    message: `"${podcast.title}" is ready to play.`,
    data: { podcastId },
  });

  await job.updateProgress(100);
  logger.info('Audio stitching complete', { podcastId });
}
