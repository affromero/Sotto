import { Job, UnrecoverableError } from 'bullmq';
import { fetchAllVideoModels } from '@/lib/video-cost-estimator';
import {
  GenerateVisualPayload,
  addJob,
  JobType,
  videoCompositionQueue,
  avatarGenerationQueue,
  transitionGenerationQueue,
  notificationQueue,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveImageProvider } from '@/lib/providers/image';
import { getImageModelCost } from '@/lib/providers/image-registry';
import { resolveVideoProvider } from '@/lib/providers/video';
import { searchStockVideo, downloadStockAsset } from '@/lib/stock-footage';
import { uploadFile } from '@/lib/r2';
import { logUsage } from '@/lib/usage-logger';
import { extractLastFrame, concatenateVideoClips } from '@/lib/video-concat';
import { generateHeraMotionGraphic } from '@/lib/hera';
import { buildHeraPrompt } from '@/lib/hera-prompt-builder';
import { logger } from '@/lib/logger';

const PROGRAMMATIC_TYPES = new Set(['DATA_CHART', 'QUOTE', 'COMPARISON', 'TIMELINE', 'DIAGRAM', 'TEXT_CARD']);

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

async function generateAiVideo(
  podcastId: string,
  videoGenerationId: string,
  segmentVisualId: string,
  videoModel: string,
  videoPrompt: string,
  endStatePrompt?: string | null,
): Promise<{ buffer: Buffer; service: string; cost: number }> {
  const podcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: { userId: true },
  });

  const { provider: videoProvider, source: videoSource, providerId } = await resolveVideoProvider({
    userId: podcast.userId,
    requestedModel: videoModel,
  });

  // Get duration: prefer subDuration (sub-visual), fall back to parent segment duration
  const visual = await prisma.segmentVisual.findUnique({
    where: { id: segmentVisualId },
    select: { segmentId: true, subDuration: true },
  });
  const segment = visual?.segmentId
    ? await prisma.segment.findUnique({ where: { id: visual.segmentId }, select: { duration: true } })
    : null;

  // Determine clip count for chaining
  const videoModels = await fetchAllVideoModels();
  const pricing = videoModels.find((m) => m.modelId === videoModel);
  const maxDuration = pricing?.maxDuration ?? 10;
  const rawDuration = visual?.subDuration ?? segment?.duration ?? 5;
  const clipCount = Math.ceil(rawDuration / maxDuration);

  // Always generate first-frame image for all video segments
  let imageCost = 0;
  logger.info('Generating first-frame image', { videoModel, segmentVisualId });
  const firstFrameResult = await generateAiImage(podcastId, videoGenerationId, videoPrompt);
  const firstFrameR2Key = `podcasts/${podcastId}/visuals/${segmentVisualId}-first-frame.png`;
  const firstFrameUrl = await uploadFile(firstFrameR2Key, firstFrameResult.buffer, 'image/png');
  imageCost += firstFrameResult.cost;

  // Always generate last-frame image (from endStatePrompt or fallback to videoPrompt)
  const lastFramePrompt = endStatePrompt ?? videoPrompt;
  logger.info('Generating last-frame image', { videoModel, segmentVisualId, hasEndStatePrompt: !!endStatePrompt });
  const lastFrameResult = await generateAiImage(podcastId, videoGenerationId, lastFramePrompt);
  const lastFrameR2Key = `podcasts/${podcastId}/visuals/${segmentVisualId}-last-frame.png`;
  const lastFrameUrl = await uploadFile(lastFrameR2Key, lastFrameResult.buffer, 'image/png');
  imageCost += lastFrameResult.cost;

  // Persist frame URLs on SegmentVisual
  await prisma.segmentVisual.update({
    where: { id: segmentVisualId },
    data: { firstFrameUrl, lastFrameUrl },
  });

  const service = videoSource === 'byok' ? `${providerId}_byok` : providerId;

  // Single clip — no chaining needed
  if (clipCount <= 1) {
    const cappedDuration = Math.min(rawDuration, maxDuration);
    const buffer = await videoProvider.generateVideo({
      prompt: videoPrompt,
      duration: cappedDuration,
      firstFrameImage: firstFrameUrl,
      lastFrameImage: lastFrameUrl,
    });
    const videoCost = pricing ? (cappedDuration / 60) * pricing.costPerMinute : 0;
    return { buffer, service, cost: videoCost + imageCost };
  }

  // Multi-clip chaining: generate N clips, extract last frame → first frame of next
  // Bookend strategy: first clip gets firstFrameUrl, final clip targets lastFrameUrl
  logger.info('Chaining video clips', {
    segmentVisualId,
    clipCount: String(clipCount),
    rawDuration: String(rawDuration),
    maxDuration: String(maxDuration),
  });

  const clips: Buffer[] = [];
  let chainImage: string | undefined = firstFrameUrl;
  let totalVideoCost = 0;

  for (let i = 0; i < clipCount; i++) {
    const remaining = rawDuration - i * maxDuration;
    const clipDuration = Math.min(remaining, maxDuration);
    const isLastClip = i === clipCount - 1;

    logger.info('Generating chained clip', {
      segmentVisualId,
      clip: `${i + 1}/${clipCount}`,
      clipDuration: String(clipDuration),
      hasChainImage: !!chainImage,
    });

    const clipBuffer = await videoProvider.generateVideo({
      prompt: videoPrompt,
      duration: clipDuration,
      firstFrameImage: chainImage,
      lastFrameImage: isLastClip ? lastFrameUrl : undefined,
    });
    clips.push(clipBuffer);

    if (pricing) {
      totalVideoCost += (clipDuration / 60) * pricing.costPerMinute;
    }

    // Extract last frame for next clip (skip for the final clip)
    if (!isLastClip) {
      const lastFrameBuffer = await extractLastFrame(clipBuffer);
      const r2Key = `podcasts/${podcastId}/visuals/${segmentVisualId}-chain-${i}.png`;
      chainImage = await uploadFile(r2Key, lastFrameBuffer, 'image/png');
    }
  }

  const buffer = await concatenateVideoClips(clips);

  return { buffer, service, cost: totalVideoCost + imageCost };
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

    // Check visualMode first — user may have explicitly chosen video mode in the pipeline editor.
    // This takes priority over visualType-specific logic.
    const visual = await prisma.segmentVisual.findUnique({
      where: { id: segmentVisualId },
      select: { visualMode: true, videoModel: true, endStatePrompt: true },
    });

    if (visual?.visualMode === 'video' && visual.videoModel) {
      const result = await generateAiVideo(podcastId, videoGenerationId, segmentVisualId, visual.videoModel, prompt, visual.endStatePrompt);
      assetBuffer = result.buffer;
      assetType = 'video/mp4';
      assetExt = 'mp4';
      service = result.service;
      totalCost = result.cost;
    } else if (visualType === 'AI_ILLUSTRATION') {
      const result = await generateAiImage(podcastId, videoGenerationId, prompt);
      assetBuffer = result.buffer;
      assetType = 'image/png';
      assetExt = 'png';
      service = result.service;
      totalCost = result.cost;
    } else if (visualType === 'MAP_OVERLAY') {
      const metadata = job.data.metadata as {
        places?: Array<{ name: string; coordinates?: [number, number] }>;
        preset?: string;
      } | undefined;
      const presetName = (metadata?.preset as string) ?? 'vintage';

      // Places are pre-enriched by the place-enrichment worker with full PlaceMetadata
      const enrichedPlace = metadata?.places?.find((p) => p.coordinates);

      if (!enrichedPlace || !enrichedPlace.coordinates) {
        const placeName = metadata?.places?.[0]?.name ?? prompt;
        logger.info('No enriched place with coordinates, falling back to AI illustration', { segmentVisualId, placeName });
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
        const { generateMapImage } = await import('@/lib/map-image');
        // Cast to PlaceMetadata — enrichment worker writes the full shape
        const place = enrichedPlace as import('@sotto/maps/server').PlaceMetadata;
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

        // Store Pexels attribution in metadata for credit display
        const existingVisual = await prisma.segmentVisual.findUnique({
          where: { id: segmentVisualId },
          select: { metadata: true },
        });
        await prisma.segmentVisual.update({
          where: { id: segmentVisualId },
          data: {
            metadata: {
              ...(existingVisual?.metadata as Record<string, unknown> | null),
              photographer: result.photographer,
              photographerUrl: result.photographerUrl,
              pexelsVideoId: result.pexelsVideoId,
              pexelsVideoUrl: result.pexelsVideoUrl,
            },
          },
        });
      }
    } else if (PROGRAMMATIC_TYPES.has(visualType)) {
      // Hera motion — programmatic types only reach here when motionProvider='hera'
      const sv = await prisma.segmentVisual.findUnique({
        where: { id: segmentVisualId },
        select: { subDuration: true, metadata: true, firstFrameUrl: true, motionProvider: true, segmentId: true },
      });

      if (sv?.motionProvider !== 'hera') {
        // Guard: shouldn't be here without Hera — mark ready for Remotion fallback
        await prisma.segmentVisual.update({
          where: { id: segmentVisualId },
          data: { status: 'ready', motionProvider: 'remotion' },
        });
        await checkAllReady(videoGenerationId, podcastId);
        await job.updateProgress(100);
        return;
      }

      // Fetch segment text and duration
      const segment = sv.segmentId
        ? await prisma.segment.findUnique({ where: { id: sv.segmentId }, select: { text: true, duration: true } })
        : null;
      const segmentText = segment?.text ?? '';
      const duration = sv.subDuration ?? segment?.duration ?? 5;
      const clampedDuration = Math.max(1, Math.min(60, Math.round(duration)));

      const heraPrompt = buildHeraPrompt({
        visualType,
        metadata: sv.metadata as Record<string, unknown> | null,
        segmentText,
      });

      const buffer = await generateHeraMotionGraphic({
        prompt: heraPrompt,
        durationSeconds: clampedDuration,
        referenceImageUrl: sv.firstFrameUrl ?? undefined,
        podcastId,
      });

      if (!buffer) {
        // Hera failed — fallback to Remotion (mark ready, no asset)
        logger.warn('Hera generation failed, falling back to Remotion', { segmentVisualId, visualType });
        await prisma.segmentVisual.update({
          where: { id: segmentVisualId },
          data: { status: 'ready', motionProvider: 'remotion' },
        });
        await checkAllReady(videoGenerationId, podcastId);
        await job.updateProgress(100);
        return;
      }

      assetBuffer = buffer;
      assetType = 'video/mp4';
      assetExt = 'mp4';
      service = 'hera';
      totalCost = 0;
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
    const errMsg = err instanceof Error ? err.message : String(err);

    // Config/quota errors will never succeed on retry — fail immediately
    const isConfigError = errMsg.includes('No Fal endpoint') ||
      errMsg.includes('No image provider available') ||
      errMsg.includes('No video provider available') ||
      errMsg.includes('USAGE_LIMIT_REACHED') ||
      errMsg.includes('HERA_API_KEY not configured');

    if (isConfigError) {
      await prisma.segmentVisual.update({
        where: { id: segmentVisualId },
        data: { status: 'failed', failureReason: errMsg },
      });
      await checkAllReady(videoGenerationId, podcastId);
      throw new UnrecoverableError(errMsg);
    }

    const maxAttempts = job.opts?.attempts ?? 3;
    const isTerminal = job.attemptsMade >= maxAttempts;

    if (isTerminal) {
      // Final attempt — mark as permanently failed
      await prisma.segmentVisual.update({
        where: { id: segmentVisualId },
        data: {
          status: 'failed',
          failureReason: errMsg,
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
    const failedVisuals = await prisma.segmentVisual.findMany({
      where: { videoGenerationId, status: 'failed' },
      select: { order: true, videoModel: true, failureReason: true },
    });

    if (failedVisuals.length > 0) {
      const details = failedVisuals.map(v =>
        `Segment ${v.order}${v.videoModel ? ` (${v.videoModel})` : ''}: ${v.failureReason ?? 'unknown'}`
      ).join('; ');
      const failureReason = `${failedVisuals.length} visual(s) failed — ${details}`;
      await prisma.videoGeneration.update({
        where: { id: videoGenerationId },
        data: { status: 'FAILED', failureReason },
      });

      // Send exactly one VIDEO_FAILED notification (checkAllReady fires once)
      const podcast = await prisma.podcast.findUnique({
        where: { id: podcastId },
        select: { userId: true },
      });
      if (podcast) {
        await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
          userId: podcast.userId,
          type: 'VIDEO_FAILED',
          title: 'Video Generation Failed',
          message: `Video generation failed: ${failureReason}`,
          data: { podcastId, videoGenerationId },
        });
      }
      return;
    }

    // Check for enabled transitions needing generation
    const pendingTransitions = await prisma.segmentTransition.count({
      where: { videoGenerationId, enabled: true, status: 'pending' },
    });

    if (pendingTransitions > 0) {
      await prisma.videoGeneration.update({
        where: { id: videoGenerationId },
        data: { status: 'GENERATING_TRANSITIONS' },
      });
      const podcast = await prisma.podcast.findUniqueOrThrow({
        where: { id: podcastId },
        select: { userId: true },
      });
      const transitions = await prisma.segmentTransition.findMany({
        where: { videoGenerationId, enabled: true, status: 'pending' },
      });
      for (const t of transitions) {
        await addJob(transitionGenerationQueue, JobType.GENERATE_TRANSITION, {
          podcastId,
          videoGenerationId,
          transitionId: t.id,
          userId: podcast.userId,
        });
      }
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
