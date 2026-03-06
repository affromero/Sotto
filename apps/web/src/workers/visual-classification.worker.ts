import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import {
  ClassifyVisualsPayload,
  addJob,
  JobType,
  visualGenerationQueue,
  videoCompositionQueue,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { classifySegmentVisuals } from '@/lib/visual-classifier';
import { resolveAiModelAndProvider } from '@/lib/providers/ai-registry';
import { getAiKey } from '@/lib/byok';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';

const EXTERNAL_ASSET_TYPES = new Set(['AI_ILLUSTRATION', 'STOCK_FOOTAGE']);

export async function processVisualClassification(job: Job<ClassifyVisualsPayload>): Promise<void> {
  const { podcastId, videoGenerationId, userId } = job.data;

  logger.info('Starting visual classification', { podcastId, videoGenerationId });
  await job.updateProgress(10);

  // Update status
  await prisma.videoGeneration.update({
    where: { id: videoGenerationId },
    data: { status: 'CLASSIFYING' },
  });

  try {
    // Fetch podcast with segments + resolve AI model
    const [podcast, aiKey, user] = await Promise.all([
      prisma.podcast.findUniqueOrThrow({
        where: { id: podcastId },
        select: {
          aiModel: true,
          title: true,
          topic: true,
          segments: {
            orderBy: { order: 'asc' },
            select: { id: true, order: true, speaker: true, text: true, startTime: true, duration: true },
          },
        },
      }),
      getAiKey(userId),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } }),
    ]);
    const { model: aiModel, provider: aiProvider } = await resolveAiModelAndProvider({
      podcastAiModel: podcast.aiModel,
      aiKey,
      plan: user.plan as 'FREE' | 'PRO',
    });

    if (podcast.segments.length === 0) {
      throw new Error('No segments found for podcast');
    }

    const segmentInputs = podcast.segments.map((s) => ({
      segmentId: s.id,
      order: s.order,
      speaker: s.speaker,
      text: s.text,
      duration: s.duration ?? 5,
    }));

    await job.updateProgress(30);

    // Classify all segments in a single AI call
    const { classifications, inputTokens, outputTokens, model } = await classifySegmentVisuals(
      segmentInputs,
      podcast.title,
      podcast.topic,
      { provider: aiProvider, model: aiModel, apiKeyOverride: aiKey?.apiKey },
    );

    await job.updateProgress(60);

    // Create SegmentVisual records
    await prisma.segmentVisual.createMany({
      data: classifications.map((c) => ({
        videoGenerationId,
        segmentId: c.segmentId,
        order: c.order,
        visualType: c.visualType,
        prompt: c.prompt,
        metadata: c.metadata ? (c.metadata as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        status: EXTERNAL_ASSET_TYPES.has(c.visualType) ? 'pending' : 'ready',
      })),
    });

    // Update status to GENERATING_VISUALS
    await prisma.videoGeneration.update({
      where: { id: videoGenerationId },
      data: { status: 'GENERATING_VISUALS' },
    });

    // Queue jobs for segments needing external assets
    const externals = classifications.filter((c) => EXTERNAL_ASSET_TYPES.has(c.visualType));

    if (externals.length > 0) {
      // Look up the created SegmentVisual records for their IDs
      const visuals = await prisma.segmentVisual.findMany({
        where: { videoGenerationId },
        select: { id: true, segmentId: true, visualType: true, prompt: true, metadata: true },
      });

      const visualBySegment = new Map(visuals.map((v) => [v.segmentId, v]));

      for (const ext of externals) {
        const visual = visualBySegment.get(ext.segmentId);
        if (!visual) continue;

        await addJob(visualGenerationQueue, JobType.GENERATE_VISUAL, {
          podcastId,
          videoGenerationId,
          segmentVisualId: visual.id,
          visualType: visual.visualType,
          prompt: visual.prompt ?? '',
          metadata: (visual.metadata as Record<string, unknown>) ?? {},
        });
      }
    } else {
      // All segments are programmatic — skip straight to composition
      await addJob(videoCompositionQueue, JobType.COMPOSE_VIDEO, {
        podcastId,
        videoGenerationId,
      });
    }

    // Log cost
    logUsage({
      service: aiProvider,
      model,
      category: 'video_generation',
      inputTokens,
      outputTokens,
      podcastId,
      userId,
      metadata: { stage: 'classification', segmentCount: classifications.length },
    });

    await job.updateProgress(100);
    logger.info('Visual classification complete', {
      podcastId,
      videoGenerationId,
      totalSegments: String(classifications.length),
      externalAssets: String(externals.length),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Visual classification failed', { podcastId, videoGenerationId, error: message });

    await prisma.videoGeneration.update({
      where: { id: videoGenerationId },
      data: { status: 'FAILED', failureReason: `Classification failed: ${message}` },
    });

    throw err;
  }
}
