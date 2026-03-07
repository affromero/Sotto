import { Job } from 'bullmq';
import { fetchAllVideoModels } from '@/lib/video-cost-estimator';
import {
  GenerateVisualPayload,
  addJob,
  JobType,
  videoCompositionQueue,
  avatarGenerationQueue,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveImageProvider } from '@/lib/providers/image';
import { getImageModelCost } from '@/lib/providers/image-registry';
import { resolveVideoProvider } from '@/lib/providers/video';
import { searchStockVideo, downloadStockAsset } from '@/lib/stock-footage';
import { uploadFile } from '@/lib/r2';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';

async function generateAiImage(
  podcastId: string,
  videoGenerationId: string,
  imagePrompt: string,
): Promise<{ buffer: Buffer; service: string; cost: number }> {
  const podcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: { userId: true },
  });

  const videoGen = await prisma.videoGeneration.findUnique({
    where: { id: videoGenerationId },
    select: { imageModel: true },
  });

  const { provider, source } = await resolveImageProvider({
    userId: podcast.userId,
    requestedModel: videoGen?.imageModel,
  });

  const buffer = await provider.generateImage({ prompt: imagePrompt, width: 1280, height: 720 });
  const service = source === 'byok' ? 'fal_byok' : 'fal';
  const megapixels = (1280 * 720) / 1_000_000;
  const cost = megapixels * getImageModelCost(provider.getModelId());

  return { buffer, service, cost };
}

export async function processVisualGeneration(job: Job<GenerateVisualPayload>): Promise<void> {
  const { podcastId, videoGenerationId, segmentVisualId, visualType, prompt } = job.data;

  logger.info('Generating visual asset', { podcastId, segmentVisualId, visualType });
  await job.updateProgress(10);

  // Idempotency: skip if asset already generated
  const existing = await prisma.segmentVisual.findUnique({
    where: { id: segmentVisualId },
    select: { assetUrl: true, status: true },
  });

  if (existing?.assetUrl) {
    logger.info('Visual asset already exists, skipping', { segmentVisualId });
    await checkAllReady(videoGenerationId, podcastId);
    await job.updateProgress(100);
    return;
  }

  // Update status to generating
  await prisma.segmentVisual.update({
    where: { id: segmentVisualId },
    data: { status: 'generating' },
  });

  const startTime = Date.now();

  try {
    let assetBuffer: Buffer;
    let assetType: string;
    let assetExt: string;
    let service = 'fal';
    let totalCost = 0;

    if (visualType === 'AI_ILLUSTRATION') {
      const result = await generateAiImage(podcastId, videoGenerationId, prompt);
      assetBuffer = result.buffer;
      assetType = 'image/png';
      assetExt = 'png';
      service = result.service;
      totalCost = result.cost;
    } else if (visualType === 'MAP_OVERLAY') {
      const metadata = job.data.metadata as { places?: Array<{ name: string }>; preset?: string } | undefined;
      const placeName = metadata?.places?.[0]?.name ?? prompt;
      const presetName = (metadata?.preset as string) ?? 'vintage';

      const { generateMapImage } = await import('@/lib/map-image');
      const { PlaceResolver } = await import('@sotto/maps');
      const resolver = new PlaceResolver({ redisUrl: process.env.REDIS_URL });
      const place = await resolver.resolve(placeName);

      if (!place) {
        logger.info('No place resolved, falling back to AI illustration', { segmentVisualId, placeName });
        const aiResult = await generateAiImage(podcastId, videoGenerationId, prompt);
        assetBuffer = aiResult.buffer;
        assetType = 'image/png';
        assetExt = 'png';
        service = aiResult.service;
        totalCost = aiResult.cost;
        await prisma.segmentVisual.update({
          where: { id: segmentVisualId },
          data: { visualType: 'AI_ILLUSTRATION' },
        });
      } else {
        assetBuffer = await generateMapImage(place, presetName);
        assetType = 'image/png';
        assetExt = 'png';
        service = 'mapbox';
        totalCost = 0;
      }
    } else if (visualType === 'STOCK_FOOTAGE') {
      const result = await searchStockVideo(prompt);
      if (!result) {
        // Fallback: generate AI illustration instead of showing a text card
        logger.info('No stock footage found, falling back to AI illustration', { segmentVisualId, prompt });
        const aiResult = await generateAiImage(podcastId, videoGenerationId, prompt);
        assetBuffer = aiResult.buffer;
        assetType = 'image/png';
        assetExt = 'png';
        service = aiResult.service;
        totalCost = aiResult.cost;

        // Update visualType so the renderer uses ImageSlide
        await prisma.segmentVisual.update({
          where: { id: segmentVisualId },
          data: { visualType: 'AI_ILLUSTRATION' },
        });
      } else {
        assetBuffer = await downloadStockAsset(result.url);
        assetType = 'video/mp4';
        assetExt = 'mp4';
        service = 'pexels';
        totalCost = 0; // Free
      }
    } else {
      // Check if this is a video-mode segment (from pipeline editor)
      const visual = await prisma.segmentVisual.findUnique({
        where: { id: segmentVisualId },
        select: { visualMode: true, videoModel: true },
      });

      if (visual?.visualMode === 'video' && visual.videoModel) {
        const podcast = await prisma.podcast.findUniqueOrThrow({
          where: { id: podcastId },
          select: { userId: true },
        });

        const { provider: videoProvider, source: videoSource, providerId } = await resolveVideoProvider({
          userId: podcast.userId,
          requestedModel: visual.videoModel,
        });

        const segment = await prisma.segment.findFirst({
          where: { podcastId },
          orderBy: { order: 'asc' },
          select: { duration: true },
        });

        // Look up model pricing to get maxDuration cap
        const videoModels = await fetchAllVideoModels();
        const pricing = videoModels.find((m) => m.modelId === visual.videoModel);
        const maxDuration = pricing?.maxDuration ?? 10;
        const rawDuration = segment?.duration ?? 5;
        const cappedDuration = Math.min(rawDuration, maxDuration);

        assetBuffer = await videoProvider.generateVideo({
          prompt,
          duration: cappedDuration,
        });
        assetType = 'video/mp4';
        assetExt = 'mp4';
        service = videoSource === 'byok' ? `${providerId}_byok` : providerId;

        if (pricing) {
          totalCost = (cappedDuration / 60) * pricing.costPerMinute;
        }
      } else {
        // Should not reach here — programmatic types are marked ready in classification
        logger.warn('Unexpected visual type in generation worker', { visualType, segmentVisualId });
        await prisma.segmentVisual.update({
          where: { id: segmentVisualId },
          data: { status: 'ready' },
        });
        await checkAllReady(videoGenerationId, podcastId);
        await job.updateProgress(100);
        return;
      }
    }

    await job.updateProgress(70);

    // Upload to R2
    const r2Key = `podcasts/${podcastId}/visuals/${segmentVisualId}.${assetExt}`;
    const assetUrl = await uploadFile(r2Key, assetBuffer, assetType);

    // Update SegmentVisual
    await prisma.segmentVisual.update({
      where: { id: segmentVisualId },
      data: { assetUrl, assetType, status: 'ready' },
    });

    const durationMs = Date.now() - startTime;

    // Log cost
    if (totalCost > 0) {
      const podcast = await prisma.podcast.findUnique({
        where: { id: podcastId },
        select: { userId: true },
      });
      logUsage({
        service,
        category: 'video_generation',
        totalCost,
        durationMs,
        podcastId,
        userId: podcast?.userId,
        metadata: { stage: 'visual_generation', visualType },
      });
    }

    await job.updateProgress(90);
  } catch (err) {
    const maxAttempts = job.opts?.attempts ?? 3;
    const isTerminal = job.attemptsMade >= maxAttempts;

    if (isTerminal) {
      // Final attempt — mark as permanently failed
      await prisma.segmentVisual.update({
        where: { id: segmentVisualId },
        data: {
          status: 'failed',
          failureReason: err instanceof Error ? err.message : String(err),
        },
      });
      await checkAllReady(videoGenerationId, podcastId);
    } else {
      // Non-terminal — reset to pending so checkAllReady doesn't prematurely fail
      await prisma.segmentVisual.update({
        where: { id: segmentVisualId },
        data: { status: 'pending' },
      });
    }
    throw err;
  }

  // Check if all visuals for this generation are ready
  await checkAllReady(videoGenerationId, podcastId);
  await job.updateProgress(100);
  logger.info('Visual generation complete', { podcastId, segmentVisualId, visualType });
}

async function checkAllReady(videoGenerationId: string, podcastId: string): Promise<void> {
  const pending = await prisma.segmentVisual.count({
    where: {
      videoGenerationId,
      status: { in: ['pending', 'generating'] },
    },
  });

  if (pending === 0) {
    // Check for failures
    const failed = await prisma.segmentVisual.count({
      where: { videoGenerationId, status: 'failed' },
    });

    if (failed > 0) {
      await prisma.videoGeneration.update({
        where: { id: videoGenerationId },
        data: {
          status: 'FAILED',
          failureReason: `${failed} visual(s) failed to generate`,
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
      const overlays = await prisma.avatarOverlay.findMany({
        where: { videoGenerationId, status: 'pending' },
      });
      for (const overlay of overlays) {
        await addJob(avatarGenerationQueue, JobType.GENERATE_AVATAR, {
          podcastId,
          videoGenerationId,
          avatarOverlayId: overlay.id,
          speaker: overlay.speaker,
          avatarId: overlay.avatarId,
        });
      }
      return;
    }

    // All visuals ready — client-side rendering is the default
    if (process.env.ENABLE_VIDEO_EXPORT === 'true') {
      // Legacy: server-side MP4 composition via Remotion sidecar
      await addJob(videoCompositionQueue, JobType.COMPOSE_VIDEO, {
        podcastId,
        videoGenerationId,
      });
    } else {
      // Client-side rendering: mark as READY immediately
      await prisma.videoGeneration.update({
        where: { id: videoGenerationId },
        data: { status: 'READY' },
      });
    }
  }
}
