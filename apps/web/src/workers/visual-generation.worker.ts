import { Job } from 'bullmq';
import {
  GenerateVisualPayload,
  addJob,
  JobType,
  videoCompositionQueue,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveImageProvider } from '@/lib/providers/image';
import { getImageModelCost } from '@/lib/providers/image-registry';
import { searchStockVideo, downloadStockAsset } from '@/lib/stock-footage';
import { uploadFile } from '@/lib/r2';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';

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
      // Resolve image provider (BYOK or platform fal key)
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

      assetBuffer = await provider.generateImage({ prompt, width: 1280, height: 720 });
      assetType = 'image/png';
      assetExt = 'png';
      service = source === 'byok' ? 'fal_byok' : 'fal';

      // Cost: 1280x720 = 0.9216 megapixels
      const megapixels = (1280 * 720) / 1_000_000;
      totalCost = megapixels * getImageModelCost(provider.getModelId());
    } else if (visualType === 'STOCK_FOOTAGE') {
      const result = await searchStockVideo(prompt);
      if (!result) {
        // Fallback: convert to TEXT_CARD (programmatic, no asset needed)
        await prisma.segmentVisual.update({
          where: { id: segmentVisualId },
          data: {
            visualType: 'TEXT_CARD',
            status: 'ready',
            metadata: { headline: prompt, bullets: [] },
          },
        });
        await checkAllReady(videoGenerationId, podcastId);
        await job.updateProgress(100);
        return;
      }

      assetBuffer = await downloadStockAsset(result.url);
      assetType = 'video/mp4';
      assetExt = 'mp4';
      service = 'pexels';
      totalCost = 0; // Free
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
    // Mark this visual as failed
    await prisma.segmentVisual.update({
      where: { id: segmentVisualId },
      data: {
        status: 'failed',
        failureReason: err instanceof Error ? err.message : String(err),
      },
    });
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

    // All ready — queue composition
    await addJob(videoCompositionQueue, JobType.COMPOSE_VIDEO, {
      podcastId,
      videoGenerationId,
    });
  }
}
