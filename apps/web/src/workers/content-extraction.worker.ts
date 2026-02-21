import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { ExtractContentPayload, addJob, JobType, scriptGenerationQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { extractContent } from '@/lib/extractors';
import { logger } from '@/lib/logger';

export async function processContentExtraction(job: Job<ExtractContentPayload>): Promise<void> {
  const { podcastId, userId, sourceUrl, sourceText, useAdminCredits } = job.data;

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
      useAdminCredits,
    });

    await job.updateProgress(100);
    return;
  }

  let content = sourceText || '';
  let sourceMetadata: Prisma.InputJsonValue | undefined;

  if (sourceUrl) {
    const extracted = await extractContent(sourceUrl);
    const urlContent = extracted.markdown || extracted.text;
    content = content
      ? `${content}\n\n---\n\n## Referenced Article\n\n${urlContent}`
      : urlContent;
    sourceMetadata = {
      title: extracted.title,
      author: extracted.author,
      publishedDate: extracted.publishedDate,
      siteName: extracted.siteName,
      wordCount: extracted.wordCount,
      sourceType: extracted.sourceType,
      extractionMethod: extracted.extractionMethod,
    };
  }

  // Store extracted content and metadata in discovery
  const discovery = await prisma.discovery.update({
    where: { podcastId },
    data: {
      sourceContent: content,
      ...(sourceMetadata && { sourceMetadata }),
    },
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
    useAdminCredits,
  });

  await job.updateProgress(100);
  logger.info('Content extraction complete', { podcastId });
}
