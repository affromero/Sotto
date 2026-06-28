import { Job } from 'bullmq';
import { Prisma } from '@/generated/prisma/client';
import { ExtractContentPayload, addJob, JobType, deepResearchQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { extractContent } from '@/lib/extractors';
import { assessTopicFeasibility } from '@/lib/topic-assessor';
import { markEpisodeFailed } from '@/lib/pipeline-resume';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { logUsage } from '@/lib/usage-logger';
import { getAiKey } from '@/lib/byok';
import {
  providerRequiresAiKey,
  resolveAiModelAndProvider,
  type AiProviderId,
} from '@/lib/providers/ai-registry';
import { logger } from '@/lib/logger';
import { logPipelineStageComplete } from '@/lib/pipeline-events';
import { analyzeBias } from '@/lib/media-bias';

export async function processContentExtraction(job: Job<ExtractContentPayload>): Promise<void> {
  const { episodeId, userId, sourceUrl, sourceText, useAdminCredits } = job.data;

  logger.info('Extracting content', { episodeId });
  await job.updateProgress(10);

  // Idempotency: skip if content was already extracted
  const existingDiscovery = await prisma.discovery.findUnique({
    where: { episodeId },
    select: { id: true, sourceContent: true },
  });

  if (existingDiscovery?.sourceContent) {
    logger.info('Content already extracted, skipping to deep research', { episodeId });

    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'RESEARCHING' },
    });
    await invalidateEpisodeCache(episodeId);
    await publishEpisodeStatus(episodeId, { status: 'RESEARCHING' });

    await addJob(
      deepResearchQueue,
      JobType.DEEP_RESEARCH,
      {
        episodeId,
        userId,
        discoveryId: existingDiscovery.id,
        useAdminCredits,
      },
      { jobId: `research-${episodeId}-${Date.now()}` }
    );

    await job.updateProgress(100);
    return;
  }

  let content = sourceText || '';
  let sourceMetadata: Prisma.InputJsonValue | undefined;

  if (sourceUrl) {
    const extracted = await extractContent(sourceUrl);
    const urlContent = extracted.markdown || extracted.text;

    // Fail gracefully when extraction returns empty content (e.g., YouTube with no transcript)
    if (!urlContent.trim() && !sourceText?.trim()) {
      const reason =
        extracted.sourceType === 'youtube'
          ? `No transcript available for this YouTube video`
          : `Could not extract content from ${sourceUrl}`;
      throw new Error(reason);
    }

    content = content ? `${content}\n\n---\n\n## Referenced Article\n\n${urlContent}` : urlContent;
    sourceMetadata = JSON.parse(
      JSON.stringify({
        title: extracted.title,
        author: extracted.author,
        publishedDate: extracted.publishedDate,
        siteName: extracted.siteName,
        wordCount: extracted.wordCount,
        sourceType: extracted.sourceType,
        extractionMethod: extracted.extractionMethod,
        ...(extracted.tables && extracted.tables.length > 0 && { tables: extracted.tables }),
        ...(extracted.figures && extracted.figures.length > 0 && { figures: extracted.figures }),
        ...(extracted.keyStatistics &&
          extracted.keyStatistics.length > 0 && { keyStatistics: extracted.keyStatistics }),
      })
    );
  }

  // Fetch topic/depth/focusAreas in one query for bias analysis + feasibility check
  const discoveryMeta = await prisma.discovery.findUnique({
    where: { episodeId },
    select: { topic: true, depth: true, focusAreas: true },
  });

  // Bias analysis — run before persisting so we can store results in sourceMetadata
  if (sourceUrl && discoveryMeta?.topic) {
    const biasAnalysis = analyzeBias({
      sourceUrl,
      topic: discoveryMeta.topic,
      focusAreas: (discoveryMeta.focusAreas as string[]) ?? [],
    });
    sourceMetadata = {
      ...(sourceMetadata as Record<string, unknown> | undefined),
      biasAnalysis: { ...biasAnalysis },
    } as Prisma.InputJsonValue;
  }

  // Store extracted content and metadata in discovery
  const discovery = await prisma.discovery.update({
    where: { episodeId },
    data: {
      sourceContent: content,
      ...(sourceMetadata && { sourceMetadata }),
    },
  });

  await job.updateProgress(50);

  // Pre-flight feasibility check — only for WEB-sourced episodes (user is at browser).
  // API sources have pre-validated topics and no interactive retry.
  const episode = await prisma.episode.findUniqueOrThrow({
    where: { id: episodeId },
    select: {
      source: true,
      aiModel: true,
    },
  });

  if (episode.source === 'WEB') {
    if (discoveryMeta?.topic) {
      logger.info('Running topic feasibility check', { episodeId });

      const initialAiKey = useAdminCredits || episode.aiModel ? null : await getAiKey(userId);
      if (!episode.aiModel && !initialAiKey) {
        throw new Error(
          'AI model is required for topic feasibility assessment when no AI key is configured.'
        );
      }

      const { model, provider } = await resolveAiModelAndProvider({
        episodeAiModel: episode.aiModel,
        aiKey: initialAiKey,
      });

      const providerAiKey =
        episode.aiModel && providerRequiresAiKey(provider) && !useAdminCredits
          ? await getAiKey(userId, provider as AiProviderId)
          : initialAiKey;
      if (
        episode.aiModel &&
        providerRequiresAiKey(provider) &&
        !useAdminCredits &&
        !providerAiKey
      ) {
        throw new Error(
          `AI key for provider "${provider}" is required for topic feasibility assessment.`
        );
      }

      const assessment = await assessTopicFeasibility({
        topic: discoveryMeta.topic,
        sourceContent: content || undefined,
        depth: discoveryMeta.depth || undefined,
        apiKeyOverride: providerAiKey?.apiKey,
        model,
        provider,
      });

      await logUsage({
        service: provider,
        model: assessment.model,
        category: 'topic_assessment',
        inputTokens: assessment.inputTokens,
        outputTokens: assessment.outputTokens,
        episodeId,
        userId,
      });

      // Store assessment results in Discovery
      await prisma.discovery.update({
        where: { episodeId },
        data: {
          feasibilityVerdict: assessment.verdict,
          feasibilitySuggestion: assessment.suggestion,
        },
      });

      if (assessment.verdict === 'reject') {
        const suggestion = assessment.suggestion ? ` Try: "${assessment.suggestion}"` : '';
        await markEpisodeFailed(episodeId, {
          failureReason: `This topic can't produce a well-sourced episode: ${assessment.reason}${suggestion}`,
          technicalError: `Topic assessment rejected: ${assessment.reason}`,
        });

        logger.info('Topic rejected by feasibility check', {
          episodeId,
          reason: assessment.reason,
        });
        await job.updateProgress(100);
        return;
      }

      if (assessment.verdict === 'warn') {
        logger.info('Topic flagged with warning, continuing to script generation', {
          episodeId,
          reason: assessment.reason,
        });
      }
    }
  }

  await job.updateProgress(70);

  // Update episode status
  await prisma.episode.update({
    where: { id: episodeId },
    data: { status: 'RESEARCHING' },
  });
  await invalidateEpisodeCache(episodeId);
  await publishEpisodeStatus(episodeId, { status: 'RESEARCHING' });

  // Chain to deep research
  await addJob(
    deepResearchQueue,
    JobType.DEEP_RESEARCH,
    {
      episodeId,
      userId,
      discoveryId: discovery.id,
      useAdminCredits,
    },
    { jobId: `research-${episodeId}` }
  );

  await logPipelineStageComplete(episodeId, 'content-extraction');
  await job.updateProgress(100);
  logger.info('Content extraction complete', { episodeId });
}
