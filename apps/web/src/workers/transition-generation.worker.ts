import { Job } from 'bullmq';
import {
  GenerateTransitionPayload,
  addJob,
  JobType,
  videoCompositionQueue,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveVideoProvider } from '@/lib/providers/video';
import { getAllVideoProviderMeta } from '@/lib/providers/video-registry';
import { uploadFile } from '@/lib/r2';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';

export async function processTransitionGeneration(job: Job<GenerateTransitionPayload>): Promise<void> {
  const { podcastId, videoGenerationId, transitionId, userId } = job.data;

  logger.info('Starting transition generation', { transitionId, videoGenerationId });
  await job.updateProgress(10);

  const transition = await prisma.segmentTransition.findUniqueOrThrow({
    where: { id: transitionId },
  });

  // Idempotency: already generated
  if (transition.assetUrl) {
    logger.info('Transition already generated, skipping', { transitionId });
    await checkAllTransitionsReady(videoGenerationId, podcastId);
    return;
  }

  await prisma.segmentTransition.update({
    where: { id: transitionId },
    data: { status: 'generating' },
  });

  try {
    // Fetch the last frame of fromSegment and first frame of toSegment
    const [fromVisuals, toVisuals] = await Promise.all([
      prisma.segmentVisual.findMany({
        where: { videoGenerationId, segmentId: transition.fromSegmentId },
        orderBy: { subOrder: 'desc' },
        take: 1,
        select: { lastFrameUrl: true, assetUrl: true, visualType: true },
      }),
      prisma.segmentVisual.findMany({
        where: { videoGenerationId, segmentId: transition.toSegmentId },
        orderBy: { subOrder: 'asc' },
        take: 1,
        select: { firstFrameUrl: true, assetUrl: true, visualType: true },
      }),
    ]);

    const fromVisual = fromVisuals[0];
    const toVisual = toVisuals[0];

    if (!fromVisual || !toVisual) {
      throw new Error('Missing segment visuals for transition');
    }

    // Use lastFrameUrl if available; fall back to assetUrl (for image-only segments)
    const fromFrameUrl = fromVisual.lastFrameUrl ?? fromVisual.assetUrl;
    const toFrameUrl = toVisual.firstFrameUrl ?? toVisual.assetUrl;

    if (!fromFrameUrl || !toFrameUrl) {
      // Programmatic stills may have failed — skip gracefully, compositor ignores assetUrl-less transitions
      logger.warn('Skipping transition — missing frame URLs (still rendering may have failed)', {
        transitionId,
        fromVisualType: fromVisual.visualType,
        toVisualType: toVisual.visualType,
        hasFromFrame: !!fromFrameUrl,
        hasToFrame: !!toFrameUrl,
      });
      await prisma.segmentTransition.update({
        where: { id: transitionId },
        data: { status: 'ready' },
      });
      await checkAllTransitionsReady(videoGenerationId, podcastId);
      return;
    }

    await job.updateProgress(30);

    // Resolve video provider for the transition model
    const { provider, source, providerId } = await resolveVideoProvider({
      userId,
      requestedModel: transition.transitionModel,
    });

    const prompt = transition.prompt ?? 'Smooth cinematic transition between two scenes';
    const duration = transition.durationSeconds;

    logger.info('Generating transition video', {
      transitionId,
      model: transition.transitionModel,
      duration: String(duration),
    });

    const buffer = await provider.generateVideo({
      prompt,
      duration,
      firstFrameImage: fromFrameUrl,
      lastFrameImage: toFrameUrl,
    });

    await job.updateProgress(80);

    // Upload to R2
    const r2Key = `podcasts/${podcastId}/transitions/${transitionId}.mp4`;
    const assetUrl = await uploadFile(r2Key, buffer, 'video/mp4');

    // Calculate cost
    let costPerMinute = 0;
    for (const p of getAllVideoProviderMeta()) {
      const model = p.models.find((m) => m.id === transition.transitionModel);
      if (model) { costPerMinute = model.costPerMinute; break; }
    }
    const cost = (duration / 60) * costPerMinute;

    await prisma.segmentTransition.update({
      where: { id: transitionId },
      data: { assetUrl, assetType: 'video/mp4', status: 'ready', cost },
    });

    // Log usage
    const service = source === 'byok' ? `${providerId}_byok` : providerId;
    logUsage({
      service,
      model: provider.getModelId(),
      category: 'video_generation',
      inputTokens: 0,
      outputTokens: 0,
      podcastId,
      userId,
      metadata: { stage: 'transition', transitionId, duration },
    });

    await job.updateProgress(100);
    logger.info('Transition generation complete', { transitionId, assetUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Transition generation failed', { transitionId, error: message });

    await prisma.segmentTransition.update({
      where: { id: transitionId },
      data: { status: 'failed', failureReason: message },
    });

    throw err;
  }

  await checkAllTransitionsReady(videoGenerationId, podcastId);
}

async function checkAllTransitionsReady(videoGenerationId: string, podcastId: string): Promise<void> {
  const pending = await prisma.segmentTransition.count({
    where: {
      videoGenerationId,
      enabled: true,
      status: { in: ['pending', 'generating'] },
    },
  });

  if (pending > 0) return;

  // Check for failures
  const failed = await prisma.segmentTransition.count({
    where: { videoGenerationId, enabled: true, status: 'failed' },
  });

  if (failed > 0) {
    await prisma.videoGeneration.update({
      where: { id: videoGenerationId },
      data: {
        status: 'FAILED',
        failureReason: `${failed} transition(s) failed to generate`,
      },
    });
    return;
  }

  // Check for pending avatar overlays before proceeding
  const pendingAvatars = await prisma.avatarOverlay.count({
    where: { videoGenerationId, status: { in: ['pending', 'concatenating', 'submitting', 'processing'] } },
  });

  if (pendingAvatars > 0) {
    await prisma.videoGeneration.update({
      where: { id: videoGenerationId },
      data: { status: 'GENERATING_AVATARS' },
    });
    return;
  }

  // All transitions (and avatars) ready
  if (process.env.ENABLE_VIDEO_EXPORT === 'true') {
    await addJob(videoCompositionQueue, JobType.COMPOSE_VIDEO, {
      podcastId,
      videoGenerationId,
    });
  } else {
    await prisma.videoGeneration.update({
      where: { id: videoGenerationId },
      data: { status: 'READY' },
    });
  }
}
