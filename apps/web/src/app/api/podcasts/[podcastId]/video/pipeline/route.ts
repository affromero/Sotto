import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { checkVideoGenerationGate } from '@/lib/video-gate';
import { classifySegmentVisuals, type VisualTypeString } from '@/lib/visual-classifier';
import {
  estimateSegmentCost,
  estimatePipelineCost,
  fetchFalImageModels,
  fetchFalVideoModels,
  cheapestModel,
} from '@/lib/video-cost-estimator';
import type { PipelineSegmentNode, VisualMode, VideoPipeline } from '@/types/pipeline';
import { logger } from '@/lib/logger';

type RouteParams = { params: Promise<{ podcastId: string }> };

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
      const msg =
        gate.reason === 'upgrade_to_pro'
          ? 'Video generation is a PRO feature. Upgrade to generate videos.'
          : 'No image provider available. Add a fal API key in Settings.';
      return errorResponse(msg, 403, { code: gate.reason });
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

  try {
    const [{ classifications }, imageModels, videoModels] = await Promise.all([
      classifySegmentVisuals(segmentInputs, podcast.title, podcast.topic),
      fetchFalImageModels(),
      fetchFalVideoModels(),
    ]);

    const defaultImageModel = cheapestModel(imageModels, (m) => m.pricePerImage, 'fal-recraft-v3');
    const defaultVideoModel = cheapestModel(videoModels, (m) => m.costPerMinute, 'fal-wan2.5-480p');

    const segments: PipelineSegmentNode[] = classifications.map((c) => {
      const input = segmentInputs.find((s) => s.segmentId === c.segmentId)!;
      const mode = visualModeForType(c.visualType);
      const model = mode === 'image' ? defaultImageModel : mode === 'video' ? defaultVideoModel : null;

      const node: PipelineSegmentNode = {
        segmentId: c.segmentId,
        order: c.order,
        speaker: input.speaker,
        text: input.text,
        duration: input.duration,
        visualType: c.visualType,
        visualMode: mode,
        model,
        prompt: c.prompt,
        metadata: c.metadata,
        estimatedCost: 0,
      };
      node.estimatedCost = estimateSegmentCost(node, imageModels, videoModels);
      return node;
    });

    const pipeline: VideoPipeline = {
      version: 1,
      segments,
      totalEstimatedCost: estimatePipelineCost(segments, imageModels, videoModels),
      defaultImageModel,
      defaultVideoModel,
    };

    logger.info('Pipeline created for editor', {
      podcastId,
      segmentCount: String(segments.length),
      totalCost: String(pipeline.totalEstimatedCost),
    });

    return NextResponse.json(pipeline);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to create video pipeline', { podcastId, error: message });
    return errorResponse(`Pipeline creation failed: ${message}`, 500);
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

  if (body.version !== 1 || !Array.isArray(body.segments)) {
    return errorResponse('Invalid pipeline format', 400);
  }

  const [imageModels, videoModels] = await Promise.all([fetchFalImageModels(), fetchFalVideoModels()]);

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

  const segments = body.segments.map((seg) => ({
    ...seg,
    estimatedCost: estimateSegmentCost(seg, imageModels, videoModels),
  }));

  const pipeline: VideoPipeline = {
    ...body,
    segments,
    totalEstimatedCost: estimatePipelineCost(segments, imageModels, videoModels),
  };

  return NextResponse.json(pipeline);
}
