import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { checkVideoGenerationGate, tryIncrementVideoGeneration } from '@/lib/video-gate';
import { generateVideoSchema, updateVideoSegmentsSchema } from '@/lib/validations';
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

  // Feature gate: check provider availability + daily video limit
  const gate = !isAdmin ? await checkVideoGenerationGate(authResult.userId) : null;
  if (gate && !gate.allowed) {
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
    version: 1 | 2 | 3;
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
      endStatePrompt?: string | null;
      subVisuals?: Array<{
        subOrder: number;
        startOffset: number;
        duration: number;
        visualType: string;
        visualMode: 'image' | 'video' | 'programmatic';
        model: string | null;
        prompt: string | null;
        metadata: Record<string, unknown> | null;
        endStatePrompt?: string | null;
      }>;
    }>;
    transitions?: Array<{
      fromSegmentOrder: number;
      toSegmentOrder: number;
      fromSegmentId: string;
      toSegmentId: string;
      enabled: boolean;
      recommended?: boolean;
      transitionModel: string | null;
      durationSeconds?: number;
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
      await prisma.segmentTransition.deleteMany({ where: { videoGenerationId: existing.id } });
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
          if (process.env.ENABLE_VIDEO_EXPORT === 'true') {
            // Legacy: server-side composition — re-queue
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
          // Client-side rendering: just mark as READY
          await prisma.videoGeneration.update({
            where: { id: existing.id },
            data: { status: 'READY', failureReason: null },
          });
          return NextResponse.json({
            videoGenerationId: existing.id, status: 'READY',
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

  // Increment daily video counter (non-admin, non-BYOK users)
  if (gate && !gate.isByokUser) {
    const incremented = await tryIncrementVideoGeneration(authResult.userId, gate.dailyLimit);
    if (!incremented) {
      return errorResponse('Daily video generation limit reached. Try again later.', 429, {
        code: 'daily_limit_reached',
      });
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
      data: pipeline.segments.flatMap((seg) => {
        // If segment has sub-visuals (version 2), create one record per sub-visual
        if (seg.subVisuals && seg.subVisuals.length > 0) {
          return seg.subVisuals.map((sv) => ({
            videoGenerationId: videoGeneration.id,
            segmentId: seg.segmentId,
            order: seg.order,
            subOrder: sv.subOrder,
            startOffset: sv.startOffset,
            subDuration: sv.duration,
            visualType: sv.visualType as 'AI_ILLUSTRATION' | 'STOCK_FOOTAGE' | 'DATA_CHART' | 'QUOTE' | 'COMPARISON' | 'TIMELINE' | 'DIAGRAM' | 'TEXT_CARD',
            visualMode: sv.visualMode,
            videoModel: sv.visualMode === 'video' ? sv.model : null,
            prompt: sv.prompt,
            endStatePrompt: sv.endStatePrompt ?? null,
            metadata: sv.metadata ? (sv.metadata as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
            status: EXTERNAL_MODES.has(sv.visualMode) ? 'pending' : 'ready',
          }));
        }
        // Single visual (version 1 or no sub-visuals)
        return [{
          videoGenerationId: videoGeneration.id,
          segmentId: seg.segmentId,
          order: seg.order,
          subOrder: 0,
          startOffset: 0,
          subDuration: null as number | null,
          visualType: seg.visualType as 'AI_ILLUSTRATION' | 'STOCK_FOOTAGE' | 'DATA_CHART' | 'QUOTE' | 'COMPARISON' | 'TIMELINE' | 'DIAGRAM' | 'TEXT_CARD',
          visualMode: seg.visualMode,
          videoModel: seg.visualMode === 'video' ? seg.model : null,
          prompt: seg.prompt,
          endStatePrompt: seg.endStatePrompt ?? null,
          metadata: seg.metadata ? (seg.metadata as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          status: EXTERNAL_MODES.has(seg.visualMode) ? 'pending' : 'ready',
        }];
      }),
    });

    // Create SegmentTransition records from pipeline (enabled ones only)
    if (pipeline.transitions && pipeline.transitions.length > 0) {
      const enabledTransitions = pipeline.transitions.filter((t) => t.enabled);
      if (enabledTransitions.length > 0) {
        await prisma.segmentTransition.createMany({
          data: enabledTransitions.map((t) => ({
            videoGenerationId: videoGeneration.id,
            fromSegmentId: t.fromSegmentId,
            toSegmentId: t.toSegmentId,
            fromSegmentOrder: t.fromSegmentOrder,
            toSegmentOrder: t.toSegmentOrder,
            transitionModel: t.transitionModel,
            recommended: t.recommended ?? false,
            enabled: true,
            durationSeconds: t.durationSeconds ?? 1,
            status: 'pending',
          })),
        });
      }
    }

    await prisma.videoGeneration.update({
      where: { id: videoGeneration.id },
      data: { status: 'GENERATING_VISUALS' },
    });

    // Find all visuals that need external asset generation
    const allVisuals = await prisma.segmentVisual.findMany({
      where: { videoGenerationId: videoGeneration.id },
      select: { id: true, segmentId: true, visualType: true, visualMode: true, prompt: true, metadata: true },
    });
    const externalVisuals = allVisuals.filter((v) => EXTERNAL_MODES.has(v.visualMode ?? ''));

    if (externalVisuals.length > 0) {
      for (const visual of externalVisuals) {
        await addJob(visualGenerationQueue, JobType.GENERATE_VISUAL, {
          podcastId,
          videoGenerationId: videoGeneration.id,
          segmentVisualId: visual.id,
          visualType: visual.visualType,
          prompt: visual.prompt ?? '',
          metadata: (visual.metadata as Record<string, unknown>) ?? {},
        });
      }
    } else if (process.env.ENABLE_VIDEO_EXPORT === 'true') {
      // All visuals programmatic — queue server-side composition
      await addJob(videoCompositionQueue, JobType.COMPOSE_VIDEO, {
        podcastId,
        videoGenerationId: videoGeneration.id,
      });
    } else {
      // All visuals programmatic, client-side rendering — mark READY
      await prisma.videoGeneration.update({
        where: { id: videoGeneration.id },
        data: { status: 'READY' },
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
      avatarsVisible: true,
      failureReason: true,
      createdAt: true,
      visuals: {
        select: {
          id: true,
          segmentId: true,
          visualType: true,
          prompt: true,
          endStatePrompt: true,
          metadata: true,
          status: true,
          assetUrl: true,
          assetType: true,
          firstFrameUrl: true,
          lastFrameUrl: true,
          order: true,
          subOrder: true,
          startOffset: true,
          subDuration: true,
          visualMode: true,
        },
        orderBy: [{ order: 'asc' }, { subOrder: 'asc' }],
      },
      avatarOverlays: {
        select: {
          id: true,
          speaker: true,
          avatarId: true,
          avatarName: true,
          previewImageUrl: true,
          videoUrl: true,
          status: true,
          posX: true,
          posY: true,
          width: true,
          height: true,
          durationSeconds: true,
          chunkVideoUrl: true,
          chunkDurationSeconds: true,
          runwayChunkIndex: true,
          runwayTotalChunks: true,
          avatarProvider: true,
          maskShape: true,
          enabledSegmentIds: true,
        },
      },
      transitions: {
        select: {
          id: true,
          fromSegmentOrder: true,
          toSegmentOrder: true,
          transitionModel: true,
          status: true,
          assetUrl: true,
          assetType: true,
          enabled: true,
          recommended: true,
          durationSeconds: true,
          cost: true,
        },
        orderBy: { fromSegmentOrder: 'asc' },
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
    avatarsVisible: videoGeneration.avatarsVisible,
    failureReason: videoGeneration.failureReason,
    createdAt: videoGeneration.createdAt,
    segmentVisuals: videoGeneration.visuals,
    avatarOverlays: videoGeneration.avatarOverlays,
    transitions: videoGeneration.transitions,
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
      avatarOverlays: { select: { videoUrl: true, concatAudioUrl: true, chunkVideoUrl: true } },
      transitions: { select: { assetUrl: true } },
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

  for (const overlay of videoGeneration.avatarOverlays) {
    if (overlay.videoUrl) {
      const key = extractR2Key(overlay.videoUrl);
      if (key) deletePromises.push(deleteFile(key));
    }
    if (overlay.concatAudioUrl) {
      const key = extractR2Key(overlay.concatAudioUrl);
      if (key) deletePromises.push(deleteFile(key));
    }
    if (overlay.chunkVideoUrl) {
      const key = extractR2Key(overlay.chunkVideoUrl);
      if (key) deletePromises.push(deleteFile(key));
    }
  }

  for (const transition of videoGeneration.transitions) {
    if (transition.assetUrl) {
      const key = extractR2Key(transition.assetUrl);
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

/**
 * PATCH — Selectively regenerate changed video segments.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

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

  const body = await request.json().catch(() => null);

  // Handle avatarsVisible toggle (simple boolean update)
  if (body && typeof body.avatarsVisible === 'boolean' && !body.segments) {
    const vg = await prisma.videoGeneration.findUnique({
      where: { podcastId },
      select: { id: true },
    });
    if (!vg) return errorResponse('No video generation found', 404);
    await prisma.videoGeneration.update({
      where: { id: vg.id },
      data: { avatarsVisible: body.avatarsVisible },
    });
    return NextResponse.json({ avatarsVisible: body.avatarsVisible });
  }

  const parsed = updateVideoSegmentsSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request body', 400, { details: parsed.error.flatten() });
  }

  const videoGeneration = await prisma.videoGeneration.findUnique({
    where: { podcastId },
    select: { id: true, status: true, videoUrl: true },
  });

  if (!videoGeneration) {
    return errorResponse('No video generation found', 404);
  }

  if (videoGeneration.status !== 'READY' && videoGeneration.status !== 'FAILED') {
    return errorResponse('Video must be in READY or FAILED status to edit', 400);
  }

  // Look up all referenced segment visuals
  const segmentIds = parsed.data.segments.map((s) => s.segmentVisualId);
  const existingVisuals = await prisma.segmentVisual.findMany({
    where: { id: { in: segmentIds }, videoGenerationId: videoGeneration.id },
    select: { id: true, assetUrl: true, visualMode: true },
  });

  const existingMap = new Map(existingVisuals.map((v) => [v.id, v]));
  const missing = segmentIds.filter((id) => !existingMap.has(id));
  if (missing.length > 0) {
    return errorResponse(`Segment visuals not found: ${missing.join(', ')}`, 404);
  }

  // Delete old assets from R2
  const deletePromises: Promise<void>[] = [];
  for (const visual of existingVisuals) {
    if (visual.assetUrl) {
      const key = extractR2Key(visual.assetUrl);
      if (key) deletePromises.push(deleteFile(key));
    }
  }
  // Delete old composed video if it exists
  if (videoGeneration.videoUrl) {
    const key = extractR2Key(videoGeneration.videoUrl);
    if (key) deletePromises.push(deleteFile(key));
  }
  await Promise.allSettled(deletePromises);

  const EXTERNAL_MODES = new Set(['image', 'video']);

  // Update segment visuals and video generation in a transaction
  await prisma.$transaction(async (tx) => {
    for (const seg of parsed.data.segments) {
      const newMode = seg.visualMode ?? existingMap.get(seg.segmentVisualId)!.visualMode ?? 'image';
      const isExternal = EXTERNAL_MODES.has(newMode);

      await tx.segmentVisual.update({
        where: { id: seg.segmentVisualId },
        data: {
          ...(seg.visualType !== undefined && { visualType: seg.visualType as Prisma.EnumVisualTypeFieldUpdateOperationsInput['set'] }),
          ...(seg.visualMode !== undefined && { visualMode: seg.visualMode }),
          ...(seg.model !== undefined && { videoModel: seg.model }),
          ...(seg.prompt !== undefined && { prompt: seg.prompt }),
          ...(seg.endStatePrompt !== undefined && { endStatePrompt: seg.endStatePrompt }),
          ...(seg.metadata !== undefined && { metadata: seg.metadata ? (seg.metadata as unknown as Prisma.InputJsonValue) : Prisma.JsonNull }),
          status: isExternal ? 'pending' : 'ready',
          assetUrl: null,
          assetType: null,
          failureReason: null,
        },
      });
    }

    await tx.videoGeneration.update({
      where: { id: videoGeneration.id },
      data: {
        status: 'GENERATING_VISUALS',
        videoUrl: null,
        failureReason: null,
      },
    });
  });

  // Queue regeneration jobs for external visuals
  const updatedVisuals = await prisma.segmentVisual.findMany({
    where: { id: { in: segmentIds }, videoGenerationId: videoGeneration.id },
    select: { id: true, segmentId: true, visualType: true, visualMode: true, prompt: true, metadata: true },
  });

  for (const visual of updatedVisuals) {
    if (!EXTERNAL_MODES.has(visual.visualMode ?? '')) continue;

    await addJob(visualGenerationQueue, JobType.GENERATE_VISUAL, {
      podcastId,
      videoGenerationId: videoGeneration.id,
      segmentVisualId: visual.id,
      visualType: visual.visualType,
      prompt: visual.prompt ?? '',
      metadata: (visual.metadata as Record<string, unknown>) ?? {},
    });
  }

  // If all changed segments are programmatic, check if everything is ready
  const allVisuals = await prisma.segmentVisual.findMany({
    where: { videoGenerationId: videoGeneration.id },
    select: { status: true },
  });
  const allReady = allVisuals.every((v) => v.status === 'ready');

  if (allReady) {
    await prisma.videoGeneration.update({
      where: { id: videoGeneration.id },
      data: { status: 'READY' },
    });

    logger.info('Video segments updated (all programmatic)', { podcastId, count: String(segmentIds.length) });
    return NextResponse.json({ videoGenerationId: videoGeneration.id, status: 'READY' });
  }

  logger.info('Video segments updated, regenerating', { podcastId, count: String(segmentIds.length) });
  return NextResponse.json({ videoGenerationId: videoGeneration.id, status: 'GENERATING_VISUALS' });
}
