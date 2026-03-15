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
import type { VideoPipeline } from '@/types/pipeline';
import { videoModelSupportsLastFrame } from '@/lib/providers/video-registry';
import { logger } from '@/lib/logger';
import { addJob, pipelineClassificationQueue, JobType } from '@/lib/queue';
import { cache } from '@/lib/redis';
import { estimateDurationFromText } from '@/lib/duration';

type RouteParams = { params: Promise<{ podcastId: string }> };

const pipelineBodySchema = z.object({
  aiProvider: z.string().optional(),
  aiModel: z.string().optional(),
}).optional();

const classificationIdSchema = z.string().uuid();

const REDIS_KEY_PREFIX = 'pipeline-classification:';

/**
 * POST — Queue visual classification and return a classificationId for polling.
 * Does NOT create DB records — the worker stores the pipeline JSON in Redis.
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
      segments: {
        orderBy: { order: 'asc' },
        select: { id: true, duration: true, text: true },
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

  // Parse optional body for AI provider override
  const body = pipelineBodySchema.parse(await request.json().catch(() => undefined));

  // Resolve user plan for model defaults
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: auth.userId },
    select: { plan: true, preferredAiModel: true },
  });
  const tier = user.plan as 'FREE' | 'PRO';

  // Resolve AI provider (fast, needs request-scoped auth context)
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
  } else if (body?.aiModel) {
    if (!isValidModelId(body.aiModel)) {
      return errorResponse(`Unknown AI model: ${body.aiModel}`, 400);
    }
    const resolvedProvider = getProviderForModel(body.aiModel);
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
  } else {
    const aiKey = await getAiKey(auth.userId);
    const resolved = await resolveAiModelAndProvider({
      podcastAiModel: user.preferredAiModel,
      aiKey,
      plan: tier,
    });
    aiModel = resolved.model;
    aiProvider = resolved.provider;
    apiKeyOverride = aiKey?.apiKey;
  }

  // Generate classificationId and queue the job
  const classificationId = crypto.randomUUID();

  await addJob(pipelineClassificationQueue, JobType.CLASSIFY_PIPELINE, {
    classificationId,
    podcastId,
    userId: auth.userId,
    aiProvider,
    aiModel,
    apiKeyOverride,
    tier,
  });

  logger.info('Pipeline classification queued', { classificationId, podcastId });

  return NextResponse.json({ classificationId, status: 'classifying' });
}

/**
 * GET — Poll for pipeline classification result.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const auth = await authenticateRequest(request);
  if (!auth) return errorResponse('Unauthorized', 401);

  const url = new URL(request.url);
  const rawId = url.searchParams.get('classificationId');
  const parsed = classificationIdSchema.safeParse(rawId);
  if (!parsed.success) {
    return errorResponse('Missing or invalid classificationId', 400);
  }
  const classificationId = parsed.data;

  // Verify podcast ownership to prevent enumeration
  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true },
  });
  if (!podcast) return errorResponse('Podcast not found', 404);

  const adminId = await requireAdmin();
  if (podcast.userId !== auth.userId && adminId === null) {
    return errorResponse('Forbidden', 403);
  }

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

  return NextResponse.json(pipeline);
}
