import { Job, UnrecoverableError } from 'bullmq';
import { safeFetch } from '@/lib/url-validator';
import { fetchAllVideoModels } from '@/lib/video-cost-estimator';
import {
  GenerateVisualPayload,
  addJob,
  JobType,
  videoCompositionQueue,
  avatarGenerationQueue,
  transitionGenerationQueue,
  notificationQueue,
  visualGenerationQueue,
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

const PROGRAMMATIC_TYPES = new Set(['DATA_CHART', 'QUOTE', 'COMPARISON', 'TIMELINE', 'DIAGRAM', 'TEXT_CARD', 'DATA_TABLE', 'SOURCE_FIGURE']);

async function generateAiImage(
  episodeId: string,
  videoGenerationId: string,
  imagePrompt: string,
): Promise<{ buffer: Buffer; service: string; cost: number }> {
  const episode = await prisma.episode.findUniqueOrThrow({
    where: { id: episodeId },
    select: { userId: true },
  });

  const videoGen = await prisma.videoGeneration.findUnique({
    where: { id: videoGenerationId },
    select: { imageModel: true },
  });

  const { provider, source } = await resolveImageProvider({
    userId: episode.userId,
    requestedModel: videoGen?.imageModel,
  });

  const buffer = await provider.generateImage({ prompt: imagePrompt, width: 1280, height: 720 });
  const service = source === 'byok' ? 'fal_byok' : 'fal';
  const megapixels = (1280 * 720) / 1_000_000;
  const cost = megapixels * getImageModelCost(provider.getModelId());

  return { buffer, service, cost };
}

async function generateAiVideo(
  episodeId: string,
  videoGenerationId: string,
  segmentVisualId: string,
  videoModel: string,
  videoPrompt: string,
  endStatePrompt?: string | null,
): Promise<{ buffer: Buffer; service: string; cost: number }> {
  const episode = await prisma.episode.findUniqueOrThrow({
    where: { id: episodeId },
    select: { userId: true },
  });

  const { provider: videoProvider, source: videoSource, providerId } = await resolveVideoProvider({
    userId: episode.userId,
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
  const firstFrameResult = await generateAiImage(episodeId, videoGenerationId, videoPrompt);
  const firstFrameR2Key = `episodes/${episodeId}/visuals/${segmentVisualId}-first-frame.png`;
  const firstFrameUrl = await uploadFile(firstFrameR2Key, firstFrameResult.buffer, 'image/png');
  imageCost += firstFrameResult.cost;

  // Always generate last-frame image (from endStatePrompt or fallback to videoPrompt)
  const lastFramePrompt = endStatePrompt ?? videoPrompt;
  logger.info('Generating last-frame image', { videoModel, segmentVisualId, hasEndStatePrompt: !!endStatePrompt });
  const lastFrameResult = await generateAiImage(episodeId, videoGenerationId, lastFramePrompt);
  const lastFrameR2Key = `episodes/${episodeId}/visuals/${segmentVisualId}-last-frame.png`;
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
      const r2Key = `episodes/${episodeId}/visuals/${segmentVisualId}-chain-${i}.png`;
      chainImage = await uploadFile(r2Key, lastFrameBuffer, 'image/png');
    }
  }

  const buffer = await concatenateVideoClips(clips);

  return { buffer, service, cost: totalVideoCost + imageCost };
}

export async function processVisualGeneration(job: Job<GenerateVisualPayload>): Promise<void> {
  const { episodeId, videoGenerationId, segmentVisualId, visualType } = job.data;

  // Apply user feedback to the prompt if present in metadata
  const userFeedback = (job.data.metadata as Record<string, unknown> | undefined)?.userFeedback as string | undefined;
  const prompt = userFeedback
    ? `${job.data.prompt}\n\nUser feedback: ${userFeedback}`
    : job.data.prompt;

  // Resolve zeroCostVideo from VideoGeneration
  const videoGen = await prisma.videoGeneration.findUnique({
    where: { id: videoGenerationId },
    select: { zeroCostVideo: true },
  });
  const zeroCostVideo = videoGen?.zeroCostVideo ?? false;

  logger.info('Generating visual asset', { episodeId, segmentVisualId, visualType, hasFeedback: !!userFeedback, zeroCostVideo });
  await job.updateProgress(10);

  // Zero-cost guard: AI_ILLUSTRATION should never reach here, but defense-in-depth
  if (zeroCostVideo && visualType === 'AI_ILLUSTRATION') {
    logger.info('Zero-cost mode: converting AI_ILLUSTRATION to TEXT_CARD', { segmentVisualId });
    const seg = await prisma.segment.findFirst({
      where: { id: (await prisma.segmentVisual.findUnique({ where: { id: segmentVisualId }, select: { segmentId: true } }))?.segmentId ?? '' },
      select: { text: true },
    });
    await prisma.segmentVisual.update({
      where: { id: segmentVisualId },
      data: {
        visualType: 'TEXT_CARD',
        metadata: { headline: seg?.text?.slice(0, 60) ?? 'Key Point', bullets: [] },
        status: 'ready',
      },
    });
    await checkAllReady(videoGenerationId, episodeId);
    await job.updateProgress(100);
    return;
  }

  // Idempotency: skip if asset already generated
  const existing = await prisma.segmentVisual.findUnique({
    where: { id: segmentVisualId },
    select: { assetUrl: true, status: true },
  });

  if (existing?.assetUrl) {
    logger.info('Visual asset already exists, skipping', { segmentVisualId });
    await checkAllReady(videoGenerationId, episodeId);
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

    if (visual?.visualMode === 'video' && visual.videoModel && !zeroCostVideo) {
      const result = await generateAiVideo(episodeId, videoGenerationId, segmentVisualId, visual.videoModel, prompt, visual.endStatePrompt);
      assetBuffer = result.buffer;
      assetType = 'video/mp4';
      assetExt = 'mp4';
      service = result.service;
      totalCost = result.cost;
    } else if (visualType === 'AI_ILLUSTRATION') {
      const result = await generateAiImage(episodeId, videoGenerationId, prompt);
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
        if (zeroCostVideo) {
          logger.info('Zero-cost mode: MAP_OVERLAY fallback → TEXT_CARD', { segmentVisualId });
          await prisma.segmentVisual.update({
            where: { id: segmentVisualId },
            data: {
              visualType: 'TEXT_CARD',
              metadata: { headline: metadata?.places?.[0]?.name ?? prompt.slice(0, 60), bullets: [] },
              status: 'ready',
            },
          });
          await checkAllReady(videoGenerationId, episodeId);
          await job.updateProgress(100);
          return;
        }
        const placeName = metadata?.places?.[0]?.name ?? prompt;
        logger.info('No enriched place with coordinates, falling back to AI illustration', { segmentVisualId, placeName });
        const aiResult = await generateAiImage(episodeId, videoGenerationId, prompt);
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
        if (zeroCostVideo) {
          logger.info('Zero-cost mode: STOCK_FOOTAGE fallback → TEXT_CARD', { segmentVisualId });
          await prisma.segmentVisual.update({
            where: { id: segmentVisualId },
            data: {
              visualType: 'TEXT_CARD',
              metadata: { headline: prompt.slice(0, 60), bullets: [] },
              status: 'ready',
            },
          });
          await checkAllReady(videoGenerationId, episodeId);
          await job.updateProgress(100);
          return;
        }
        // Fallback: generate AI illustration instead of showing a text card
        logger.info('No stock footage found, falling back to AI illustration', { segmentVisualId, prompt });
        const aiResult = await generateAiImage(episodeId, videoGenerationId, prompt);
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
    } else if (visualType === 'SOURCE_FIGURE') {
      // SOURCE_FIGURE: validate the figure URL from metadata, fall back to AI_ILLUSTRATION if broken
      const sv = await prisma.segmentVisual.findUnique({
        where: { id: segmentVisualId },
        select: { metadata: true },
      });
      const figureUrl = (sv?.metadata as Record<string, unknown> | null)?.figureUrl as string | undefined;

      if (figureUrl && figureUrl.startsWith('https://')) {
        try {
          const headResp = await safeFetch(figureUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
          if (headResp.ok) {
            await prisma.segmentVisual.update({
              where: { id: segmentVisualId },
              data: { assetUrl: figureUrl, assetType: 'image/png', status: 'ready' },
            });
            await checkAllReady(videoGenerationId, episodeId);
            await job.updateProgress(100);
            return;
          }
        } catch {
          logger.warn('SOURCE_FIGURE URL validation failed, falling back to AI_ILLUSTRATION', { segmentVisualId, figureUrl });
        }
      }

      // Fallback: convert to TEXT_CARD (zero-cost) or AI_ILLUSTRATION
      if (zeroCostVideo) {
        logger.info('Zero-cost mode: SOURCE_FIGURE fallback → TEXT_CARD', { segmentVisualId });
        await prisma.segmentVisual.update({
          where: { id: segmentVisualId },
          data: {
            visualType: 'TEXT_CARD',
            metadata: { headline: prompt?.slice(0, 60) ?? 'Source Figure', bullets: [] },
            status: 'ready',
          },
        });
        await checkAllReady(videoGenerationId, episodeId);
        await job.updateProgress(100);
        return;
      }
      const fallbackPrompt = prompt || 'Editorial illustration for episode segment';
      await prisma.segmentVisual.update({
        where: { id: segmentVisualId },
        data: { visualType: 'AI_ILLUSTRATION', status: 'pending' },
      });
      await addJob(visualGenerationQueue, JobType.GENERATE_VISUAL, {
        episodeId,
        videoGenerationId,
        segmentVisualId,
        visualType: 'AI_ILLUSTRATION',
        prompt: fallbackPrompt,
        metadata: {},
      });
      await job.updateProgress(100);
      return;
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
        await checkAllReady(videoGenerationId, episodeId);
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
        episodeId,
      });

      if (!buffer) {
        // Hera failed — fallback to Remotion (mark ready, no asset)
        logger.warn('Hera generation failed, falling back to Remotion', { segmentVisualId, visualType });
        await prisma.segmentVisual.update({
          where: { id: segmentVisualId },
          data: { status: 'ready', motionProvider: 'remotion' },
        });
        await checkAllReady(videoGenerationId, episodeId);
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
      await checkAllReady(videoGenerationId, episodeId);
      await job.updateProgress(100);
      return;
    }

    await job.updateProgress(70);

    // Upload to R2
    const r2Key = `episodes/${episodeId}/visuals/${segmentVisualId}.${assetExt}`;
    const assetUrl = await uploadFile(r2Key, assetBuffer, assetType);

    // Update SegmentVisual
    await prisma.segmentVisual.update({
      where: { id: segmentVisualId },
      data: { assetUrl, assetType, status: 'ready' },
    });

    const durationMs = Date.now() - startTime;

    // Log cost
    if (totalCost > 0) {
      const episode = await prisma.episode.findUnique({
        where: { id: episodeId },
        select: { userId: true },
      });
      logUsage({
        service,
        category: 'video_generation',
        totalCost,
        durationMs,
        episodeId,
        userId: episode?.userId,
        metadata: { stage: 'visual_generation', visualType },
      });
    }

    await job.updateProgress(90);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // Configuration and provider usage-limit errors will never succeed on retry.
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
      await checkAllReady(videoGenerationId, episodeId);
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
      await checkAllReady(videoGenerationId, episodeId);
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
  await checkAllReady(videoGenerationId, episodeId);
  await job.updateProgress(100);
  logger.info('Visual generation complete', { episodeId, segmentVisualId, visualType });
}

async function checkAllReady(videoGenerationId: string, episodeId: string): Promise<void> {
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
      const episode = await prisma.episode.findUnique({
        where: { id: episodeId },
        select: { userId: true },
      });
      if (episode) {
        await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
          userId: episode.userId,
          type: 'VIDEO_FAILED',
          title: 'Video Generation Failed',
          message: `Video generation failed: ${failureReason}`,
          data: { episodeId, videoGenerationId },
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
      const episode = await prisma.episode.findUniqueOrThrow({
        where: { id: episodeId },
        select: { userId: true },
      });
      const transitions = await prisma.segmentTransition.findMany({
        where: { videoGenerationId, enabled: true, status: 'pending' },
      });
      for (const t of transitions) {
        await addJob(transitionGenerationQueue, JobType.GENERATE_TRANSITION, {
          episodeId,
          videoGenerationId,
          transitionId: t.id,
          userId: episode.userId,
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
          episodeId,
          videoGenerationId,
          avatarOverlayId: overlay.id,
          speaker: overlay.speaker,
          avatarId: overlay.avatarId,
          avatarProvider: overlay.avatarProvider ?? undefined,
          avatarImageUrl: overlay.avatarImageUrl ?? undefined,
          avatarModelId: overlay.avatarModelId ?? undefined,
        });
      }
      return;
    }

    // All visuals ready — compose MP4 via Remotion sidecar
    await addJob(videoCompositionQueue, JobType.COMPOSE_VIDEO, {
      episodeId,
      videoGenerationId,
    });
  }
}
