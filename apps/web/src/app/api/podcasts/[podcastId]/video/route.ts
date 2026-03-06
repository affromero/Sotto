import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { checkVideoGenerationGate } from '@/lib/video-gate';
import { generateVideoSchema } from '@/lib/validations';
import { Prisma } from '@prisma/client';
import { addJob, JobType, visualClassificationQueue, visualGenerationQueue, videoCompositionQueue } from '@/lib/queue';
import { deleteFile, extractR2Key } from '@/lib/r2';
import { logger } from '@/lib/logger';

type RouteParams = { params: Promise<{ podcastId: string }> };

/**
 * POST — Trigger video generation for a READY podcast.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const adminId = await requireAdmin();
  const isAdmin = adminId !== null;

  // Feature gate: PRO/admin only
  if (!isAdmin) {
    const gate = await checkVideoGenerationGate(authResult.userId);
    if (!gate.allowed) {
      const msg = gate.reason === 'upgrade_to_pro'
        ? 'Video generation is a PRO feature. Upgrade to generate videos.'
        : 'No image provider available. Add a fal API key in Settings.';
      return errorResponse(msg, 403, { code: gate.reason });
    }
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, userId: true, status: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  if (podcast.userId !== authResult.userId && !isAdmin) {
    return errorResponse('Forbidden', 403);
  }

  if (podcast.status !== 'READY') {
    return errorResponse('Podcast must be in READY status to generate video', 400);
  }

  // Parse optional body
  let imageModel: string | undefined;
  let pipeline: {
    version: 1;
    defaultImageModel: string;
    defaultVideoModel: string;
    segments: Array<{
      segmentId: string;
      order: number;
      visualType: string;
      visualMode: 'image' | 'video' | 'programmatic';
      model: string | null;
      prompt: string | null;
      metadata: Record<string, unknown> | null;
    }>;
  } | undefined;

  try {
    const body = await request.json();
    const parsed = generateVideoSchema.safeParse(body);
    if (parsed.success && parsed.data) {
      imageModel = parsed.data.imageModel;
      pipeline = parsed.data.pipeline;
    }
  } catch {
    // No body — use defaults
  }

  // Idempotency: return existing generation if in progress
  const existing = await prisma.videoGeneration.findUnique({
    where: { podcastId },
    select: { id: true, status: true, videoUrl: true },
  });

  if (existing && existing.status !== 'FAILED') {
    return NextResponse.json({
      videoGenerationId: existing.id,
      status: existing.status,
      videoUrl: existing.videoUrl,
    });
  }

  // Resume or restart failed generation
  if (existing?.status === 'FAILED') {
    if (pipeline) {
      // New pipeline provided — start fresh (user changed settings)
      await prisma.segmentVisual.deleteMany({ where: { videoGenerationId: existing.id } });
      await prisma.videoGeneration.delete({ where: { id: existing.id } });
      // Fall through to create new generation
    } else {
      // Resume from where it failed
      const visuals = await prisma.segmentVisual.findMany({
        where: { videoGenerationId: existing.id },
        select: { id: true, segmentId: true, status: true, visualType: true, prompt: true, metadata: true, visualMode: true, videoModel: true },
      });

      if (visuals.length === 0) {
        // Classification failed — delete and start fresh
        await prisma.videoGeneration.delete({ where: { id: existing.id } });
        // Fall through to create new generation
      } else {
        const failedVisuals = visuals.filter(v => v.status === 'failed');
        const pendingVisuals = visuals.filter(v => v.status === 'pending');
        const allReady = failedVisuals.length === 0 && pendingVisuals.length === 0;

        if (allReady) {
          // All visuals ready — composition must have failed. Re-queue composition.
          await prisma.videoGeneration.update({
            where: { id: existing.id },
            data: { status: 'COMPOSING', failureReason: null },
          });
          await addJob(videoCompositionQueue, JobType.COMPOSE_VIDEO, {
            podcastId, videoGenerationId: existing.id,
          });
          return NextResponse.json({
            videoGenerationId: existing.id, status: 'COMPOSING',
          });
        }

        // Some visuals failed/pending — reset and re-queue those
        const toRegenerate = [...failedVisuals, ...pendingVisuals];
        await prisma.segmentVisual.updateMany({
          where: { id: { in: toRegenerate.map(v => v.id) } },
          data: { status: 'pending', failureReason: null },
        });
        await prisma.videoGeneration.update({
          where: { id: existing.id },
          data: { status: 'GENERATING_VISUALS', failureReason: null },
        });

        for (const visual of toRegenerate) {
          await addJob(visualGenerationQueue, JobType.GENERATE_VISUAL, {
            podcastId,
            videoGenerationId: existing.id,
            segmentVisualId: visual.id,
            visualType: visual.visualType,
            prompt: visual.prompt ?? '',
            metadata: (visual.metadata as Record<string, unknown>) ?? {},
          });
        }

        return NextResponse.json({
          videoGenerationId: existing.id, status: 'GENERATING_VISUALS',
        });
      }
    }
  }

  // Create VideoGeneration record
  const videoGeneration = await prisma.videoGeneration.create({
    data: {
      podcastId,
      status: 'PENDING',
      imageModel: imageModel ?? null,
      pipelineJson: pipeline ? (pipeline as unknown as Prisma.InputJsonValue) : undefined,
    },
  });

  if (pipeline) {
    // Pipeline-driven: create SegmentVisuals directly, skip classification
    const EXTERNAL_MODES = new Set(['image', 'video']);

    await prisma.segmentVisual.createMany({
      data: pipeline.segments.map((seg) => ({
        videoGenerationId: videoGeneration.id,
        segmentId: seg.segmentId,
        order: seg.order,
        visualType: seg.visualType as 'AI_ILLUSTRATION' | 'STOCK_FOOTAGE' | 'DATA_CHART' | 'QUOTE' | 'COMPARISON' | 'TIMELINE' | 'DIAGRAM' | 'TEXT_CARD',
        visualMode: seg.visualMode,
        videoModel: seg.visualMode === 'video' ? seg.model : null,
        prompt: seg.prompt,
        metadata: seg.metadata ? (seg.metadata as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        status: EXTERNAL_MODES.has(seg.visualMode) ? 'pending' : 'ready',
      })),
    });

    await prisma.videoGeneration.update({
      where: { id: videoGeneration.id },
      data: { status: 'GENERATING_VISUALS' },
    });

    const externals = pipeline.segments.filter((s) => EXTERNAL_MODES.has(s.visualMode));

    if (externals.length > 0) {
      const visuals = await prisma.segmentVisual.findMany({
        where: { videoGenerationId: videoGeneration.id },
        select: { id: true, segmentId: true, visualType: true, prompt: true, metadata: true },
      });
      const visualBySegment = new Map(visuals.map((v) => [v.segmentId, v]));

      for (const ext of externals) {
        const visual = visualBySegment.get(ext.segmentId);
        if (!visual) continue;

        await addJob(visualGenerationQueue, JobType.GENERATE_VISUAL, {
          podcastId,
          videoGenerationId: videoGeneration.id,
          segmentVisualId: visual.id,
          visualType: visual.visualType,
          prompt: visual.prompt ?? '',
          metadata: (visual.metadata as Record<string, unknown>) ?? {},
        });
      }
    } else {
      await addJob(videoCompositionQueue, JobType.COMPOSE_VIDEO, {
        podcastId,
        videoGenerationId: videoGeneration.id,
      });
    }

    logger.info('Video generation started from pipeline', { podcastId, segmentCount: String(pipeline.segments.length) });
  } else {
    // Legacy: queue classification worker
    await addJob(visualClassificationQueue, JobType.CLASSIFY_VISUALS, {
      podcastId,
      videoGenerationId: videoGeneration.id,
      userId: authResult.userId,
    });
  }

  return NextResponse.json({
    videoGenerationId: videoGeneration.id,
    status: 'PENDING',
  });
}

/**
 * GET — Poll video generation status.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(_request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, userId: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  const adminId = await requireAdmin();
  if (podcast.userId !== authResult.userId && !adminId) {
    return errorResponse('Forbidden', 403);
  }

  const videoGeneration = await prisma.videoGeneration.findUnique({
    where: { podcastId },
    select: {
      id: true,
      status: true,
      videoUrl: true,
      duration: true,
      fileSize: true,
      failureReason: true,
      createdAt: true,
      visuals: {
        select: {
          id: true,
          segmentId: true,
          visualType: true,
          status: true,
          assetUrl: true,
        },
        orderBy: { order: 'asc' },
      },
    },
  });

  if (!videoGeneration) {
    return NextResponse.json({ status: null });
  }

  return NextResponse.json({
    videoGenerationId: videoGeneration.id,
    status: videoGeneration.status,
    videoUrl: videoGeneration.videoUrl,
    duration: videoGeneration.duration,
    fileSize: videoGeneration.fileSize,
    failureReason: videoGeneration.failureReason,
    createdAt: videoGeneration.createdAt,
    segmentVisuals: videoGeneration.visuals,
  });
}

/**
 * DELETE — Delete video and allow regeneration.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(_request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, userId: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  const adminId = await requireAdmin();
  if (podcast.userId !== authResult.userId && !adminId) {
    return errorResponse('Forbidden', 403);
  }

  const videoGeneration = await prisma.videoGeneration.findUnique({
    where: { podcastId },
    select: {
      id: true,
      videoUrl: true,
      visuals: { select: { assetUrl: true } },
    },
  });

  if (!videoGeneration) {
    return errorResponse('No video generation found', 404);
  }

  // Delete assets from R2
  const deletePromises: Promise<void>[] = [];

  for (const visual of videoGeneration.visuals) {
    if (visual.assetUrl) {
      const key = extractR2Key(visual.assetUrl);
      if (key) deletePromises.push(deleteFile(key));
    }
  }

  if (videoGeneration.videoUrl) {
    const key = extractR2Key(videoGeneration.videoUrl);
    if (key) deletePromises.push(deleteFile(key));
  }

  await Promise.allSettled(deletePromises);

  // Delete records (cascade deletes SegmentVisuals)
  await prisma.videoGeneration.delete({
    where: { id: videoGeneration.id },
  });

  // Clear podcast videoUrl
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { videoUrl: null },
  });

  logger.info('Video generation deleted', { podcastId });

  return NextResponse.json({ success: true });
}
