import { Job } from 'bullmq';
import { ExtractContentPayload } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { extractFromUrl } from '@/lib/content-parser';
import { logger } from '@/lib/logger';

export async function processContentExtraction(job: Job<ExtractContentPayload>): Promise<void> {
  const { podcastId, sourceUrl, sourceText } = job.data;

  logger.info('Extracting content', { podcastId });
  await job.updateProgress(10);

  let content = sourceText || '';

  if (sourceUrl) {
    content = await extractFromUrl(sourceUrl);
  }

  // Store extracted content in discovery
  await prisma.discovery.update({
    where: { podcastId },
    data: { sourceContent: content },
  });

  // Update podcast status
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'SCRIPTING' },
  });

  await job.updateProgress(100);
  logger.info('Content extraction complete', { podcastId });
}
