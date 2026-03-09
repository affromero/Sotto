import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { checkVideoGenerationGate } from '@/lib/video-gate';
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
import {
  resolveAiModelAndProvider,
  isValidAiProviderId,
  isValidModelId,
} from '@/lib/providers/ai-registry';
import { classifyError, type ByokErrorKind } from '@/lib/byok-errors';
import { getAiKey } from '@/lib/byok';
import type { PipelineSegmentNode, PipelineTransition, VisualMode, VideoPipeline } from '@/types/pipeline';
import { getAllVideoProviderMeta, videoModelSupportsLastFrame } from '@/lib/providers/video-registry';
import { logger } from '@/lib/logger';

type RouteParams = { params: Promise<{ podcastId: string }> };

const pipelineBodySchema = z.object({
  aiProvider: z.string().optional(),
  aiModel: z.string().optional(),
}).optional();

const LLM_ERROR_KINDS = new Set<ByokErrorKind>(['auth_invalid', 'insufficient_credits', 'rate_limited']);

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

/**
 * POST — Run visual classification and return a pipeline JSON for the editor.
 * Does NOT create DB records — stateless.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const auth = await authenticateRequest(request);
  if (!auth) return errorResponse('Unauthorized', 401);

  const adminId = await requireAdmin();
  const isAdmin = adminId !== null;

  if (!isAdmin) {
    const gate = await checkVideoGenerationGate(auth.userId);
    if (!gate.allowed) {
      const message = gate.reason === 'daily_limit_reached'
        ? 'Daily video generation limit reached. Try again later.'
        : 'No image provider available. Add a fal or MiniMax API key in Settings.';
      return errorResponse(message, gate.reason === 'daily_limit_reached' ? 429 : 403, {
        code: gate.reason,
        dailyUsed: gate.dailyUsed,
        dailyLimit: gate.dailyLimit,
        resetInSeconds: gate.resetInSeconds,
      });
    }
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      id: true,
      userId: true,
      status: true,
      title: true,
      topic: true,
      aiModel: true,
      segments: {
        orderBy: { order: 'asc' },
        select: { id: true, order: true, speaker: true, text: true, duration: true },
      },
    },
  });

  if (!podcast) return errorResponse('Podcast not found', 404);
  if (podcast.userId !== auth.userId && !isAdmin) return errorResponse('Forbidden', 403);
  if (podcast.status !== 'READY') {
    return errorResponse('Podcast must be in READY status to generate video', 400);
  }
  if (podcast.segments.length === 0) {
    return errorResponse('No segments found for podcast', 400);
  }

  const segmentInputs = podcast.segments.map((s) => ({
    segmentId: s.id,
    order: s.order,
    speaker: s.speaker,
    text: s.text,
    duration: s.duration ?? 5,
  }));

  // Parse optional body for AI provider override
  const body = pipelineBodySchema.parse(await request.json().catch(() => undefined));

  // Resolve user plan for model defaults
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: auth.userId },
    select: { plan: true },
  });
  const tier = user.plan as 'FREE' | 'PRO';

  // Resolve AI provider — hoist above try/catch so catch block can report currentProvider
  let aiModel: string;
  let aiProvider: string;
  let apiKeyOverride: string | undefined;

  if (body?.aiProvider && body?.aiModel) {
    if (!isValidAiProviderId(body.aiProvider)) {
      return errorResponse(`Unknown AI provider: ${body.aiProvider}`, 400);
    }
    if (!isValidModelId(body.aiModel)) {
      return errorResponse(`Unknown AI model: ${body.aiModel}`, 400);
    }
    aiProvider = body.aiProvider;
    aiModel = body.aiModel;
  } else {
    const aiKey = await getAiKey(auth.userId);
    const resolved = await resolveAiModelAndProvider({
      podcastAiModel: podcast.aiModel,
      aiKey,
      plan: tier,
    });
    aiModel = resolved.model;
    aiProvider = resolved.provider;
    apiKeyOverride = aiKey?.apiKey;
  }

  try {
    const [{ classifications, transitionRecommendations }, imageModels, videoModels, configuredVideo] = await Promise.all([
      classifySegmentVisuals(segmentInputs, podcast.title, podcast.topic, {
        provider: aiProvider,
        model: aiModel,
        apiKeyOverride,
      }),
      fetchFalImageModels(),
      fetchAllVideoModels(),
      resolveVideoModel(tier),
    ]);

    const defaultImageModel = cheapestModel(imageModels, (m) => m.pricePerImage, 'fal-recraft-v3');
    // Use the admin-configured video model; fall back to cheapest across all providers
    const defaultVideoModel = configuredVideo.videoModel
      ?? cheapestModel(videoModels, (m) => m.costPerMinute, 'fal-wan2.5-480p');

    const segments: PipelineSegmentNode[] = classifications.map((c) => {
      const input = segmentInputs.find((s) => s.segmentId === c.segmentId)!;
      const firstSv = c.subVisuals[0];
      const mode = visualModeForType(firstSv.visualType);
      const model = mode === 'image' ? defaultImageModel : mode === 'video' ? defaultVideoModel : null;

      const node: PipelineSegmentNode = {
        segmentId: c.segmentId,
        order: c.order,
        speaker: input.speaker,
        text: input.text,
        duration: input.duration,
        visualType: firstSv.visualType,
        visualMode: mode,
        model,
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
      for (const model of provider.models) {
        if (model.supportsLastFrame) {
          flf2vModels.push({ id: model.id, costPerMinute: model.costPerMinute });
        }
      }
    }
    const defaultTransitionModel = flf2vModels.length > 0
      ? flf2vModels.reduce((a, b) => (a.costPerMinute <= b.costPerMinute ? a : b)).id
      : null;

    // Build PipelineTransition[] for all segment boundaries
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

    logger.info('Pipeline created for editor', {
      podcastId,
      segmentCount: String(segments.length),
      transitionCount: String(transitions.filter((t) => t.enabled).length),
      totalCost: String(pipeline.totalEstimatedCost),
    });

    return NextResponse.json(pipeline);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to create video pipeline', { podcastId, error: message });

    const errorKind = classifyError(message);
    const isLlmError = LLM_ERROR_KINDS.has(errorKind);

    return errorResponse(
      isAdmin ? `Pipeline creation failed: ${message}` : 'Pipeline creation failed. Please try again later.',
      500,
      isLlmError ? { isLlmError: true, errorKind, currentProvider: aiProvider } : undefined,
    );
  }
}

/**
 * PATCH — Validate and recalculate costs for an edited pipeline. Stateless.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const auth = await authenticateRequest(request);
  if (!auth) return errorResponse('Unauthorized', 401);

  const adminId = await requireAdmin();
  const isAdmin = adminId !== null;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, userId: true },
  });

  if (!podcast) return errorResponse('Podcast not found', 404);
  if (podcast.userId !== auth.userId && !isAdmin) return errorResponse('Forbidden', 403);

  let body: VideoPipeline;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (![1, 2, 3].includes(body.version) || !Array.isArray(body.segments)) {
    return errorResponse('Invalid pipeline format', 400);
  }

  const [imageModels, videoModels] = await Promise.all([fetchFalImageModels(), fetchAllVideoModels()]);

  const validImageIds = new Set(imageModels.map((m) => m.modelId));
  const validVideoIds = new Set(videoModels.map((m) => m.modelId));

  for (const seg of body.segments) {
    if (seg.model && seg.visualMode === 'image' && !validImageIds.has(seg.model)) {
      return errorResponse(`Unknown image model: ${seg.model}`, 400);
    }
    if (seg.model && seg.visualMode === 'video' && !validVideoIds.has(seg.model)) {
      return errorResponse(`Unknown video model: ${seg.model}`, 400);
    }
  }

  // Validate transition models
  if (body.transitions) {
    for (const t of body.transitions) {
      if (t.transitionModel && !validVideoIds.has(t.transitionModel)) {
        // Check video registry directly for non-pricetoken models
        if (!videoModelSupportsLastFrame(t.transitionModel)) {
          return errorResponse(`Unknown transition model: ${t.transitionModel}`, 400);
        }
      }
    }
  }

  const segments = body.segments.map((seg) => ({
    ...seg,
    estimatedCost: estimateSegmentCost(seg, imageModels, videoModels),
  }));

  const transitions = (body.transitions ?? []).map((t) => ({
    ...t,
    estimatedCost: estimateTransitionCost(t, videoModels),
  }));

  const pipeline: VideoPipeline = {
    ...body,
    segments,
    transitions,
    totalEstimatedCost: estimatePipelineCost(segments, imageModels, videoModels, transitions),
  };

  return NextResponse.json(pipeline);
}
