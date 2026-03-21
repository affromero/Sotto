import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { addJob, JobType, segmentPreviewQueue } from '@/lib/queue';
import { z } from 'zod';

type RouteParams = { params: Promise<{ podcastId: string }> };

const postSchema = z.object({
  segmentVisualId: z.string(),
  quality: z.enum(['preview', 'full']).default('preview'),
});

/**
 * POST — Queue a per-segment preview render.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request', 400, { errors: parsed.error.flatten() });
  }

  const { segmentVisualId, quality } = parsed.data;

  // Verify the segment visual belongs to this podcast
  const segmentVisual = await prisma.segmentVisual.findUnique({
    where: { id: segmentVisualId },
    select: {
      id: true,
      videoGenerationId: true,
      videoGeneration: {
        select: { podcastId: true },
      },
    },
  });

  if (!segmentVisual || segmentVisual.videoGeneration.podcastId !== podcastId) {
    return errorResponse('Segment visual not found', 404);
  }

  // Mark as pending
  await prisma.segmentVisual.update({
    where: { id: segmentVisualId },
    data: { previewStatus: 'pending', previewQuality: quality },
  });

  // Queue the preview job
  await addJob(segmentPreviewQueue, JobType.RENDER_SEGMENT_PREVIEW, {
    podcastId,
    videoGenerationId: segmentVisual.videoGenerationId,
    segmentVisualId,
    quality,
  }, { jobId: `preview-${segmentVisualId}-${quality}` });

  return NextResponse.json({ segmentVisualId, previewStatus: 'pending' });
}

/**
 * GET — Poll preview status for a segment visual.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const segmentVisualId = request.nextUrl.searchParams.get('segmentVisualId');
  if (!segmentVisualId) {
    return errorResponse('segmentVisualId query param required', 400);
  }

  const segmentVisual = await prisma.segmentVisual.findUnique({
    where: { id: segmentVisualId },
    select: {
      previewUrl: true,
      previewStatus: true,
      previewQuality: true,
      videoGeneration: {
        select: { podcastId: true },
      },
    },
  });

  if (!segmentVisual || segmentVisual.videoGeneration.podcastId !== podcastId) {
    return errorResponse('Segment visual not found', 404);
  }

  return NextResponse.json({
    previewUrl: segmentVisual.previewUrl,
    previewStatus: segmentVisual.previewStatus,
    previewQuality: segmentVisual.previewQuality,
  });
}
