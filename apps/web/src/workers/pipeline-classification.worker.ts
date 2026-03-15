import { Job } from 'bullmq';
import { ClassifyPipelinePayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { classifySegmentVisuals, type VisualTypeString } from '@/lib/visual-classifier';
import {
  estimateSegmentCost,
  estimatePipelineCost,
  estimateTransitionCost,
  fetchFalImageModels,
  fetchAllVideoModels,
  cheapestModel,
} from '@/lib/video-cost-estimator';
import { resolveVideoModel } from '@/lib/auto-model-config';
import { getAllVideoProviderMeta } from '@/lib/providers/video-registry';
import { classifyError, userMessage, type ByokErrorKind } from '@/lib/byok-errors';
import { getAiProviderMeta, type AiProviderId } from '@/lib/providers/ai-registry';
import { logUsage } from '@/lib/usage-logger';
import { cache } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { estimateDurationFromText } from '@/lib/duration';
import type { PipelineSegmentNode, PipelineTransition, VisualMode, VideoPipeline } from '@/types/pipeline';

const REDIS_KEY_PREFIX = 'pipeline-classification:';
const REDIS_TTL_SECONDS = 900; // 15 minutes

const USER_ACTIONABLE_ERROR_KINDS = new Set<ByokErrorKind>(['auth_invalid', 'insufficient_credits']);

const PROGRAMMATIC_TYPES = new Set<VisualTypeString>([
  'DATA_CHART',
  'QUOTE',
  'COMPARISON',
  'TIMELINE',
  'DIAGRAM',
  'TEXT_CARD',
]);

function visualModeForType(visualType: VisualTypeString): VisualMode {
  if (PROGRAMMATIC_TYPES.has(visualType)) return 'programmatic';
  return 'image';
}

export async function processPipelineClassification(job: Job<ClassifyPipelinePayload>): Promise<void> {
  const { classificationId, podcastId, userId, aiProvider, aiModel, apiKeyOverride, tier } = job.data;
  const redisKey = `${REDIS_KEY_PREFIX}${classificationId}`;

  logger.info('Starting pipeline classification', { classificationId, podcastId });

  try {
    const podcast = await prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: {
        id: true,
        title: true,
        topic: true,
        segments: {
          orderBy: { order: 'asc' as const },
          select: { id: true, order: true, speaker: true, text: true, duration: true },
        },
      },
    });

    const segmentInputs = podcast.segments.map((s) => ({
      segmentId: s.id,
      order: s.order,
      speaker: s.speaker,
      text: s.text,
      duration: s.duration ?? estimateDurationFromText(s.text),
    }));

    await job.updateProgress(20);

    const [{ classifications, transitionRecommendations, inputTokens, outputTokens, model }, imageModels, videoModels, configuredVideo] = await Promise.all([
      classifySegmentVisuals(segmentInputs, podcast.title, podcast.topic, {
        provider: aiProvider,
        model: aiModel,
        apiKeyOverride,
      }),
      fetchFalImageModels(),
      fetchAllVideoModels(),
      resolveVideoModel(tier),
    ]);

    await job.updateProgress(70);

    const defaultImageModel = cheapestModel(imageModels, (m) => m.pricePerImage, 'fal-recraft-v3');
    const defaultVideoModel = configuredVideo.videoModel
      ?? cheapestModel(videoModels, (m) => m.costPerMinute, 'fal-wan2.5-480p');

    const segments: PipelineSegmentNode[] = classifications.map((c) => {
      const input = segmentInputs.find((s) => s.segmentId === c.segmentId)!;
      const firstSv = c.subVisuals[0];
      const mode = visualModeForType(firstSv.visualType);
      const model_ = mode === 'image' ? defaultImageModel : mode === 'video' ? defaultVideoModel : null;

      const node: PipelineSegmentNode = {
        segmentId: c.segmentId,
        order: c.order,
        speaker: input.speaker,
        text: input.text,
        duration: input.duration,
        visualType: firstSv.visualType,
        visualMode: mode,
        model: model_,
        prompt: firstSv.prompt,
        metadata: firstSv.metadata,
        endStatePrompt: firstSv.endStatePrompt,
        estimatedCost: 0,
      };

      if (c.subVisuals.length > 1) {
        node.subVisuals = c.subVisuals.map((sv) => {
          const svMode = visualModeForType(sv.visualType);
          const svModel = svMode === 'image' ? defaultImageModel : svMode === 'video' ? defaultVideoModel : null;
          return {
            subOrder: sv.subOrder,
            startOffset: sv.startOffsetFraction * input.duration,
            duration: sv.durationFraction * input.duration,
            visualType: sv.visualType,
            visualMode: svMode,
            model: svModel,
            prompt: sv.prompt,
            metadata: sv.metadata,
            endStatePrompt: sv.endStatePrompt,
            estimatedCost: 0,
          };
        });
      }

      node.estimatedCost = estimateSegmentCost(node, imageModels, videoModels);
      return node;
    });

    // Find cheapest FLF2V-capable model for transitions
    const flf2vModels: { id: string; costPerMinute: number }[] = [];
    for (const provider of getAllVideoProviderMeta()) {
      for (const m of provider.models) {
        if (m.supportsLastFrame) {
          flf2vModels.push({ id: m.id, costPerMinute: m.costPerMinute });
        }
      }
    }
    const defaultTransitionModel = flf2vModels.length > 0
      ? flf2vModels.reduce((a, b) => (a.costPerMinute <= b.costPerMinute ? a : b)).id
      : null;

    // Build transitions for all segment boundaries
    const recommendedSet = new Set(
      transitionRecommendations.map((r) => `${r.fromSegmentOrder}-${r.toSegmentOrder}`),
    );
    const recommendationReasons = new Map(
      transitionRecommendations.map((r) => [`${r.fromSegmentOrder}-${r.toSegmentOrder}`, r.reason]),
    );

    const transitions: PipelineTransition[] = [];
    for (let i = 0; i < segments.length - 1; i++) {
      const from = segments[i];
      const to = segments[i + 1];
      const key = `${from.order}-${to.order}`;
      const recommended = recommendedSet.has(key);
      const transition: PipelineTransition = {
        fromSegmentOrder: from.order,
        toSegmentOrder: to.order,
        fromSegmentId: from.segmentId,
        toSegmentId: to.segmentId,
        enabled: recommended,
        recommended,
        recommendationReason: recommendationReasons.get(key),
        transitionModel: defaultTransitionModel,
        durationSeconds: 1,
        estimatedCost: 0,
      };
      transition.estimatedCost = estimateTransitionCost(transition, videoModels);
      transitions.push(transition);
    }

    const pipeline: VideoPipeline = {
      version: 3,
      segments,
      transitions,
      totalEstimatedCost: estimatePipelineCost(segments, imageModels, videoModels, transitions),
      defaultImageModel,
      defaultVideoModel,
      defaultTransitionModel: defaultTransitionModel ?? undefined,
    };

    // Store result in Redis
    await cache.set(redisKey, { status: 'ready', pipeline }, REDIS_TTL_SECONDS);

    // Log usage
    logUsage({
      service: aiProvider,
      model,
      category: 'video_generation',
      inputTokens,
      outputTokens,
      podcastId,
      userId,
      metadata: { stage: 'pipeline-classification', segmentCount: classifications.length },
    });

    await job.updateProgress(100);
    logger.info('Pipeline classification complete', {
      classificationId,
      podcastId,
      segmentCount: String(segments.length),
      transitionCount: String(transitions.filter((t) => t.enabled).length),
      totalCost: String(pipeline.totalEstimatedCost),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Pipeline classification failed', { classificationId, podcastId, error: message });

    const errorKind = classifyError(message);
    const isLlmError = USER_ACTIONABLE_ERROR_KINDS.has(errorKind);

    let providerDisplayName = aiProvider;
    if (isLlmError) {
      try {
        providerDisplayName = getAiProviderMeta(aiProvider as AiProviderId).displayName;
      } catch {
        // Unknown provider — use raw ID
      }
    }

    // Store error result in Redis so frontend can display it
    await cache.set(redisKey, {
      status: 'failed',
      error: isLlmError ? userMessage(errorKind, providerDisplayName) : "Something went wrong. We've been notified.",
      isLlmError,
      errorKind: isLlmError ? errorKind : undefined,
      currentProvider: isLlmError ? aiProvider : undefined,
    }, REDIS_TTL_SECONDS);

    // Don't rethrow — the error result is stored in Redis for the frontend
    // Rethrowing would cause BullMQ to retry and overwrite the error with a new attempt
  }
}
