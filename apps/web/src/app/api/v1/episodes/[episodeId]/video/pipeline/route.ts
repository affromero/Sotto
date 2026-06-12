import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { checkVideoGenerationGate } from '@/lib/video-gate';
import {
  estimateSegmentCost,
  estimatePipelineCost,
  estimateTransitionCost,
  fetchFalImageModels,
  fetchAllVideoModels,
} from '@/lib/video-cost-estimator';
import {
  resolveAiModelAndProvider,
  isValidAiProviderId,
  isValidModelId,
  getProviderForModel,
  getCheapestModelForProvider,
  type AiProviderId,
} from '@/lib/providers/ai-registry';
import { getAiKey } from '@/lib/byok';
import { Prisma } from '@prisma/client';
import type { VideoPipeline } from '@/types/pipeline';
import { videoModelSupportsLastFrame } from '@/lib/providers/video-registry';
import { logger } from '@/lib/logger';
import { addJob, pipelineClassificationQueue, JobType } from '@/lib/queue';
import { cache } from '@/lib/redis';

type RouteParams = { params: Promise<{ episodeId: string }> };

const pipelineBodySchema = z.object({
  aiProvider: z.string().optional(),
  aiModel: z.string().optional(),
}).optional();

const classificationIdSchema = z.string().uuid();

const REDIS_KEY_PREFIX = 'pipeline-classification:';
const LOCAL_AI_PROVIDER: AiProviderId = 'claude-code';
const LOCAL_MODEL_PREFIX = 'claude-code:';

function isLocalAiModel(model: string): boolean {
  return model.startsWith(LOCAL_MODEL_PREFIX) && model.length > LOCAL_MODEL_PREFIX.length;
}

function providerForModel(model: string): AiProviderId | null {
  if (isLocalAiModel(model)) return LOCAL_AI_PROVIDER;
  return getProviderForModel(model);
}

function isKnownModel(model: string): boolean {
  return isLocalAiModel(model) || isValidModelId(model);
}

async function requireAiProviderKey(
  userId: string,
  provider: AiProviderId,
): Promise<string | undefined | Response> {
  if (provider === LOCAL_AI_PROVIDER) return undefined;

  const aiKey = await getAiKey(userId, provider);
  if (!aiKey) {
    return errorResponse(`AI key for provider "${provider}" is required for video pipeline classification.`, 403, {
      code: 'ai_key_required',
      provider,
    });
  }

  return aiKey.apiKey;
}

/**
 * POST — Queue visual classification and return a classificationId for polling.
 * Does NOT create DB records — the worker stores the pipeline JSON in Redis.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const auth = await authenticateRequest(request);
  if (!auth) return errorResponse('Unauthorized', 401);

  const adminId = await requireAdmin();
  const isAdmin = adminId !== null;

  if (!isAdmin) {
    const gate = await checkVideoGenerationGate(auth.userId);
    if (!gate.allowed) {
      return errorResponse('No image provider available. Add a fal or MiniMax API key in Settings.', 403, {
        code: gate.reason,
      });
    }
  }

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      userId: true,
      status: true,
      segments: {
        select: { id: true },
      },
    },
  });

  if (!episode) return errorResponse('Episode not found', 404);
  if (episode.userId !== auth.userId && !isAdmin) return errorResponse('Forbidden', 403);
  if (episode.status !== 'READY') {
    return errorResponse('Episode must be in READY status to generate video', 400);
  }
  if (episode.segments.length === 0) {
    return errorResponse('No segments found for episode', 400);
  }

  // Parse optional body for AI provider override
  const body = pipelineBodySchema.parse(await request.json().catch(() => undefined));

  // Resolve user model defaults
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: auth.userId },
    select: { preferredAiModel: true },
  });

  // Resolve AI provider (fast, needs request-scoped auth context)
  let aiModel: string;
  let aiProvider: string;
  let apiKeyOverride: string | undefined;

  if (body?.aiProvider && body?.aiModel) {
    if (!isValidAiProviderId(body.aiProvider)) {
      return errorResponse(`Unknown AI provider: ${body.aiProvider}`, 400);
    }
    if (!isKnownModel(body.aiModel)) {
      return errorResponse(`Unknown AI model: ${body.aiModel}`, 400);
    }
    const owningProvider = providerForModel(body.aiModel);
    if (owningProvider !== body.aiProvider) {
      return errorResponse(`AI model "${body.aiModel}" does not belong to provider "${body.aiProvider}".`, 400);
    }
    aiProvider = owningProvider;
    aiModel = body.aiModel;
  } else if (body?.aiModel) {
    if (!isKnownModel(body.aiModel)) {
      return errorResponse(`Unknown AI model: ${body.aiModel}`, 400);
    }
    const resolvedProvider = providerForModel(body.aiModel);
    if (!resolvedProvider) {
      return errorResponse(`No provider found for model: ${body.aiModel}`, 400);
    }
    aiModel = body.aiModel;
    aiProvider = resolvedProvider;
  } else if (body?.aiProvider) {
    if (!isValidAiProviderId(body.aiProvider)) {
      return errorResponse(`Unknown AI provider: ${body.aiProvider}`, 400);
    }
    const resolvedModel = getCheapestModelForProvider(body.aiProvider as AiProviderId);
    if (!resolvedModel) {
      return errorResponse(`No models available for provider: ${body.aiProvider}`, 400);
    }
    aiProvider = body.aiProvider;
    aiModel = resolvedModel;
  } else if (user.preferredAiModel) {
    try {
      const resolved = await resolveAiModelAndProvider({
        episodeAiModel: user.preferredAiModel,
        aiKey: null,
      });
      aiModel = resolved.model;
      aiProvider = resolved.provider;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to resolve AI model.';
      return errorResponse(message, 400);
    }
  } else {
    const aiKey = await getAiKey(auth.userId);
    if (!aiKey) {
      return errorResponse('AI model is required for video pipeline classification when no AI key is configured.', 403, {
        code: 'ai_key_required',
      });
    }
    const resolved = await resolveAiModelAndProvider({
      episodeAiModel: null,
      aiKey,
    });
    aiModel = resolved.model;
    aiProvider = resolved.provider;
    apiKeyOverride = aiKey.apiKey;
  }

  if (!isValidAiProviderId(aiProvider)) {
    return errorResponse(`Unknown AI provider: ${aiProvider}`, 400);
  }

  if (!apiKeyOverride) {
    const keyOrResponse = await requireAiProviderKey(auth.userId, aiProvider as AiProviderId);
    if (keyOrResponse instanceof Response) return keyOrResponse;
    apiKeyOverride = keyOrResponse;
  }

  // Generate classificationId and queue the job
  const classificationId = crypto.randomUUID();

  await addJob(pipelineClassificationQueue, JobType.CLASSIFY_PIPELINE, {
    classificationId,
    episodeId,
    userId: auth.userId,
    aiProvider,
    aiModel,
    apiKeyOverride,
  });

  logger.info('Pipeline classification queued', { classificationId, episodeId });

  return NextResponse.json({ classificationId, status: 'classifying' });
}

/**
 * GET — Poll for pipeline classification result.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const auth = await authenticateRequest(request);
  if (!auth) return errorResponse('Unauthorized', 401);

  // Verify episode ownership to prevent enumeration
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { userId: true },
  });
  if (!episode) return errorResponse('Episode not found', 404);

  const adminId = await requireAdmin();
  if (episode.userId !== auth.userId && adminId === null) {
    return errorResponse('Forbidden', 403);
  }

  const url = new URL(request.url);
  const rawId = url.searchParams.get('classificationId');

  // No classificationId — load saved draft from DB
  if (!rawId) {
    const draft = await prisma.videoGeneration.findFirst({
      where: { episodeId, status: 'DRAFT' },
      select: { pipelineJson: true },
    });
    if (draft?.pipelineJson) {
      return NextResponse.json({ status: 'saved', pipeline: draft.pipelineJson });
    }
    return NextResponse.json({ status: 'none' });
  }

  // With classificationId — poll Redis for classification result
  const parsed = classificationIdSchema.safeParse(rawId);
  if (!parsed.success) {
    return errorResponse('Invalid classificationId', 400);
  }
  const classificationId = parsed.data;

  const result = await cache.get<{
    status: 'ready' | 'failed';
    pipeline?: VideoPipeline;
    error?: string;
    isLlmError?: boolean;
    errorKind?: string;
    currentProvider?: string;
  }>(`${REDIS_KEY_PREFIX}${classificationId}`);

  if (!result) {
    return NextResponse.json({ status: 'classifying' });
  }

  return NextResponse.json(result);
}

/**
 * PATCH — Validate and recalculate costs for an edited pipeline. Stateless.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const auth = await authenticateRequest(request);
  if (!auth) return errorResponse('Unauthorized', 401);

  const adminId = await requireAdmin();
  const isAdmin = adminId !== null;

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { id: true, userId: true },
  });

  if (!episode) return errorResponse('Episode not found', 404);
  if (episode.userId !== auth.userId && !isAdmin) return errorResponse('Forbidden', 403);

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

  if (body.transitions) {
    for (const t of body.transitions) {
      if (t.transitionModel && !validVideoIds.has(t.transitionModel)) {
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

  // Persist edits to DRAFT VideoGeneration (fire-and-forget)
  prisma.videoGeneration.updateMany({
    where: { episodeId, status: 'DRAFT' },
    data: { pipelineJson: pipeline as unknown as Prisma.InputJsonValue },
  }).catch((err) => {
    logger.warn('Failed to persist pipeline draft', { episodeId, error: String(err) });
  });

  return NextResponse.json(pipeline);
}
