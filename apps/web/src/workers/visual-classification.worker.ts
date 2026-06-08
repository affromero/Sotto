import { Job } from 'bullmq';
import { Prisma, VisualType } from '@prisma/client';
import {
  ClassifyVisualsPayload,
  addJob,
  JobType,
  visualGenerationQueue,
  placeEnrichmentQueue,
  videoCompositionQueue,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { classifySegmentVisuals, type StructuredSourceData } from '@/lib/visual-classifier';
import { resolveAiModelAndProvider, type AiProviderId } from '@/lib/providers/ai-registry';
import { resolveMotionProvider } from '@/lib/auto-model-config';
import { getAiKey } from '@/lib/byok';
import { uploadFile } from '@/lib/r2';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';
import { resolveSegmentTiming } from '@/lib/segment-timing';

const EXTERNAL_ASSET_TYPES = new Set(['AI_ILLUSTRATION', 'STOCK_FOOTAGE', 'MAP_OVERLAY']);
const PROGRAMMATIC_TYPES: VisualType[] = ['TEXT_CARD', 'TIMELINE', 'QUOTE', 'COMPARISON', 'DIAGRAM', 'DATA_CHART', 'DATA_TABLE', 'SOURCE_FIGURE'];
const REMOTION_URL = process.env.REMOTION_URL;
const STILL_FPS = 30;
const STILL_CONCURRENCY = 4;

export async function processVisualClassification(job: Job<ClassifyVisualsPayload>): Promise<void> {
  const { podcastId, videoGenerationId, userId, voiceTrackId, zeroCostVideo: zeroCostFromPayload } = job.data;

  logger.info('Starting visual classification', { podcastId, videoGenerationId });
  await job.updateProgress(10);

  // Update status
  await prisma.videoGeneration.update({
    where: { id: videoGenerationId },
    data: { status: 'CLASSIFYING' },
  });

  try {
    // Fetch podcast metadata + resolve AI model + segment timing + source data
    const [podcast, user, segmentTimings, discovery] = await Promise.all([
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
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } }),
      resolveSegmentTiming(podcastId, voiceTrackId),
      prisma.discovery.findUnique({
        where: { podcastId },
        select: { sourceMetadata: true },
      }),
    ]);
    // Resolve zeroCostVideo — DB record is source of truth, payload is convenience fallback
    const videoGenRecord = await prisma.videoGeneration.findUnique({
      where: { id: videoGenerationId },
      select: { zeroCostVideo: true },
    });
    const zeroCostVideo = videoGenRecord?.zeroCostVideo ?? zeroCostFromPayload ?? false;

    const aiKey = podcast.aiModel ? null : await getAiKey(userId);
    if (!podcast.aiModel && !aiKey) {
      throw new Error('AI model is required for visual classification when no AI key is configured.');
    }

    const { model: aiModel, provider: aiProvider } = await resolveAiModelAndProvider({
      podcastAiModel: podcast.aiModel,
      aiKey,
      plan: user.plan as 'FREE' | 'PRO',
    });

    const providerAiKey =
      podcast.aiModel && aiProvider !== 'claude-code'
        ? await getAiKey(userId, aiProvider as AiProviderId)
        : aiKey;
    if (podcast.aiModel && aiProvider !== 'claude-code' && !providerAiKey) {
      throw new Error(`AI key for provider "${aiProvider}" is required for visual classification.`);
    }

    if (segmentTimings.length === 0) {
      throw new Error('No segments found for podcast');
    }

    const motionProvider = await resolveMotionProvider(user.plan as 'FREE' | 'PRO');

    const segmentInputs = segmentTimings.map((s) => ({
      segmentId: s.segmentId,
      order: s.order,
      speaker: s.speaker,
      text: s.text,
      duration: s.duration,
    }));

    await job.updateProgress(30);

    // Classify all segments in a single AI call
    // Extract structured data from source metadata for the classifier
    const sourceMetadata = discovery?.sourceMetadata as Record<string, unknown> | null;
    const structuredData = sourceMetadata ? {
      tables: [
        ...(sourceMetadata.tables as StructuredSourceData['tables'] || []),
        ...(sourceMetadata.discoveryTables as StructuredSourceData['tables'] || []),
      ].slice(0, 10),
      figures: [
        ...(sourceMetadata.figures as StructuredSourceData['figures'] || []),
        ...(sourceMetadata.discoveryFigures as StructuredSourceData['figures'] || []),
      ].slice(0, 20),
      keyStatistics: sourceMetadata.keyStatistics as StructuredSourceData['keyStatistics'],
    } : undefined;

    const { classifications, transitionRecommendations, inputTokens, outputTokens, model } = await classifySegmentVisuals(
      segmentInputs,
      podcast.title,
      podcast.topic,
      { provider: aiProvider, model: aiModel, apiKeyOverride: providerAiKey?.apiKey, structuredData, zeroCostVideo },
    );

    await job.updateProgress(60);

    // Build a duration map for fraction→seconds conversion
    const segmentDurationMap = new Map(segmentInputs.map((s) => [s.segmentId, s.duration]));

    // Create SegmentVisual records — N per segment (one per sub-visual)
    const PROGRAMMATIC_SET = new Set(PROGRAMMATIC_TYPES.map(String));
    await prisma.segmentVisual.createMany({
      data: classifications.flatMap((c) =>
        c.subVisuals.map((sv) => {
          const isProgrammatic = PROGRAMMATIC_SET.has(sv.visualType);
          const isExternal = EXTERNAL_ASSET_TYPES.has(sv.visualType);
          const isSourceFigure = sv.visualType === 'SOURCE_FIGURE';

          // SOURCE_FIGURE: asset URL comes from metadata.figureUrl, immediately ready
          const figureUrl = isSourceFigure && sv.metadata
            ? (sv.metadata as Record<string, unknown>).figureUrl as string | undefined
            : undefined;

          // Hera-routed programmatic types need generation (pending); plain Remotion ones are ready immediately
          const status = isSourceFigure && figureUrl
            ? 'ready'
            : isExternal
              ? 'pending'
              : (isProgrammatic && motionProvider === 'hera' ? 'pending' : 'ready');
          return {
            videoGenerationId,
            segmentId: c.segmentId,
            order: c.order,
            subOrder: sv.subOrder,
            startOffset: sv.startOffsetFraction * (segmentDurationMap.get(c.segmentId) ?? 5),
            subDuration: sv.durationFraction * (segmentDurationMap.get(c.segmentId) ?? 5),
            visualType: sv.visualType,
            prompt: sv.prompt,
            endStatePrompt: sv.endStatePrompt,
            metadata: sv.metadata ? (sv.metadata as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
            motionProvider: isProgrammatic ? motionProvider : null,
            status,
            ...(isSourceFigure && figureUrl && { assetUrl: figureUrl, assetType: 'image/png' }),
          };
        }),
      ),
    });

    // Render first/last frame stills for programmatic visuals (for transition generation)
    if (REMOTION_URL) {
      const programmaticVisuals = await prisma.segmentVisual.findMany({
        where: { videoGenerationId, visualType: { in: [...PROGRAMMATIC_TYPES] } },
        select: { id: true, segmentId: true, visualType: true, prompt: true, metadata: true, subDuration: true },
      });

      if (programmaticVisuals.length > 0) {
        const segmentMap = new Map(podcast.segments.map((s) => [s.id, s]));

        // Process in batches to avoid overwhelming the sidecar
        for (let i = 0; i < programmaticVisuals.length; i += STILL_CONCURRENCY) {
          const batch = programmaticVisuals.slice(i, i + STILL_CONCURRENCY);
          await Promise.all(batch.map(async (visual) => {
            const seg = segmentMap.get(visual.segmentId);
            if (!seg) return;

            const duration = visual.subDuration ?? seg.duration ?? 5;
            const durationInFrames = Math.max(1, Math.round(duration * STILL_FPS));

            const videoSegment = {
              segmentId: seg.id,
              order: seg.order,
              speaker: seg.speaker,
              text: seg.text,
              startTime: 0,
              duration,
              visualType: visual.visualType,
              prompt: visual.prompt,
              metadata: visual.metadata as Record<string, unknown>,
            };

            try {
              const [firstBuf, lastBuf] = await Promise.all([
                renderProgrammaticStill(videoSegment, 0, durationInFrames),
                renderProgrammaticStill(videoSegment, durationInFrames - 1, durationInFrames),
              ]);

              const [firstFrameUrl, lastFrameUrl] = await Promise.all([
                uploadFile(`podcasts/${podcastId}/visuals/${visual.id}-first-frame.png`, firstBuf, 'image/png'),
                uploadFile(`podcasts/${podcastId}/visuals/${visual.id}-last-frame.png`, lastBuf, 'image/png'),
              ]);

              await prisma.segmentVisual.update({
                where: { id: visual.id },
                data: { firstFrameUrl, lastFrameUrl },
              });
            } catch (err) {
              // Best-effort — don't fail classification if stills fail
              const msg = err instanceof Error ? err.message : String(err);
              logger.warn('Failed to render programmatic still', { segmentVisualId: visual.id, error: msg });
            }
          }));
        }

        logger.info('Programmatic stills rendered', {
          videoGenerationId,
          count: String(programmaticVisuals.length),
        });
      }
    }

    // Create SegmentTransition records for classifier-recommended boundaries
    // Skip transitions in zero-cost mode — they use fal.ai video generation
    if (transitionRecommendations.length > 0 && !zeroCostVideo) {
      const orderToId = new Map(segmentInputs.map((s) => [s.order, s.segmentId]));
      const transitionData = transitionRecommendations
        .filter((t) => orderToId.has(t.fromSegmentOrder) && orderToId.has(t.toSegmentOrder))
        .map((t) => ({
          videoGenerationId,
          fromSegmentId: orderToId.get(t.fromSegmentOrder)!,
          toSegmentId: orderToId.get(t.toSegmentOrder)!,
          fromSegmentOrder: t.fromSegmentOrder,
          toSegmentOrder: t.toSegmentOrder,
          recommended: true,
          enabled: true,
          status: 'pending',
          durationSeconds: 1,
        }));

      if (transitionData.length > 0) {
        await prisma.segmentTransition.createMany({ data: transitionData });
      }
    }

    // Update status to GENERATING_VISUALS
    await prisma.videoGeneration.update({
      where: { id: videoGenerationId },
      data: { status: 'GENERATING_VISUALS' },
    });

    // Queue jobs for sub-visuals needing generation (external assets + Hera-routed programmatic)
    const pendingCount = await prisma.segmentVisual.count({
      where: { videoGenerationId, status: 'pending' },
    });

    if (pendingCount > 0) {
      const visuals = await prisma.segmentVisual.findMany({
        where: { videoGenerationId, status: 'pending' },
        select: { id: true, segmentId: true, subOrder: true, visualType: true, prompt: true, metadata: true },
      });

      for (const visual of visuals) {
        if (visual.visualType === 'MAP_OVERLAY') {
          const meta = (visual.metadata as Record<string, unknown>) ?? {};
          const places = (meta.places as Array<{ name: string; yearHint?: number }>) ?? [];
          await addJob(placeEnrichmentQueue, JobType.PLACE_ENRICHMENT, {
            podcastId,
            videoGenerationId,
            segmentVisualId: visual.id,
            places,
          });
        } else {
          await addJob(visualGenerationQueue, JobType.GENERATE_VISUAL, {
            podcastId,
            videoGenerationId,
            segmentVisualId: visual.id,
            visualType: visual.visualType,
            prompt: visual.prompt ?? '',
            metadata: (visual.metadata as Record<string, unknown>) ?? {},
          });
        }
      }
    } else {
      // All sub-visuals are programmatic (Remotion) — skip straight to composition
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
      pendingVisuals: String(pendingCount),
      motionProvider,
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

async function renderProgrammaticStill(
  segment: Record<string, unknown>,
  frame: number,
  durationInFrames: number,
): Promise<Buffer> {
  const res = await fetch(`${REMOTION_URL}/still`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segment, frame, durationInFrames }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    throw new Error(`Still render failed (${res.status}): ${text}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
