import { Job } from 'bullmq';
import { ExtractContentPayload, addJob, JobType, scriptGenerationQueue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { extractFromUrl } from '@/lib/content-parser';
import { logger } from '@/lib/logger';

export async function processContentExtraction(job: Job<ExtractContentPayload>): Promise<void> {
  const { podcastId, userId, sourceUrl, sourceText } = job.data;

  logger.info('Extracting content', { podcastId });
  await job.updateProgress(10);

  // Idempotency: skip if content was already extracted
  const existingDiscovery = await prisma.discovery.findUnique({
    where: { podcastId },
    select: { id: true, sourceContent: true },
  });

  if (existingDiscovery?.sourceContent) {
    logger.info('Content already extracted, skipping to script generation', { podcastId });

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'SCRIPTING' },
    });

    await addJob(scriptGenerationQueue, JobType.GENERATE_SCRIPT, {
      podcastId,
      userId,
      discoveryId: existingDiscovery.id,
      sourceContent: existingDiscovery.sourceContent,
    });

    await job.updateProgress(100);
    return;
  }

  let content = sourceText || '';

  if (sourceUrl) {
    content = await extractFromUrl(sourceUrl);
  }

  // Store extracted content in discovery
  const discovery = await prisma.discovery.update({
    where: { podcastId },
    data: { sourceContent: content },
  });

  await job.updateProgress(50);

  // Update podcast status
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'SCRIPTING' },
  });

  // Chain to script generation
  await addJob(scriptGenerationQueue, JobType.GENERATE_SCRIPT, {
    podcastId,
    userId,
    discoveryId: discovery.id,
    sourceContent: content || undefined,
  });

  await job.updateProgress(100);
  logger.info('Content extraction complete', { podcastId });
}
