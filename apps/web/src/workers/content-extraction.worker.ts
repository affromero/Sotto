import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { ExtractContentPayload, addJob, JobType, scriptGenerationQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { extractContent } from '@/lib/extractors';
import { assessTopicFeasibility } from '@/lib/topic-assessor';
import { markPodcastFailed } from '@/lib/pipeline-resume';
import { logUsage } from '@/lib/usage-logger';
import { getAiKey } from '@/lib/byok';
import { resolveAutoModel } from '@/lib/auto-model-config';
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

  // Pre-flight feasibility check — only for WEB-sourced podcasts (user is at browser).
  // Twitter/Telegram/API sources have pre-validated topics and no interactive retry.
  const podcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: { source: true },
  });

  if (podcast.source === 'WEB') {
    const discoveryMeta = await prisma.discovery.findUnique({
      where: { podcastId },
      select: { topic: true, depth: true },
    });

    if (discoveryMeta?.topic) {
      logger.info('Running topic feasibility check', { podcastId });

      const aiKey = useAdminCredits ? null : await getAiKey(userId);
      let model: string | undefined;
      if (!model) {
        const autoConfig = await resolveAutoModel('FREE');
        model = autoConfig.aiModel;
      }

      const assessment = await assessTopicFeasibility({
        topic: discoveryMeta.topic,
        sourceContent: content || undefined,
        depth: discoveryMeta.depth || undefined,
        apiKeyOverride: aiKey?.apiKey,
        model,
      });

      await logUsage({
        service: 'anthropic',
        model: assessment.model,
        category: 'topic_assessment',
        inputTokens: assessment.inputTokens,
        outputTokens: assessment.outputTokens,
        podcastId,
        userId,
      });

      // Store assessment results in Discovery
      await prisma.discovery.update({
        where: { podcastId },
        data: {
          feasibilityVerdict: assessment.verdict,
          feasibilitySuggestion: assessment.suggestion,
        },
      });

      if (assessment.verdict === 'reject') {
        const suggestion = assessment.suggestion
          ? ` Try: "${assessment.suggestion}"`
          : '';
        await markPodcastFailed(podcastId, {
          failureReason: `This topic can't produce a well-sourced podcast: ${assessment.reason}${suggestion}`,
          technicalError: `Topic assessment rejected: ${assessment.reason}`,
        });

        logger.info('Topic rejected by feasibility check', {
          podcastId,
          reason: assessment.reason,
        });
        await job.updateProgress(100);
        return;
      }

      if (assessment.verdict === 'warn') {
        logger.info('Topic flagged with warning, continuing to script generation', {
          podcastId,
          reason: assessment.reason,
        });
      }
    }
  }

  await job.updateProgress(70);

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
