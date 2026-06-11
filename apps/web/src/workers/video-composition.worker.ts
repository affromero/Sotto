import { Job } from 'bullmq';
import { ComposeVideoPayload, addJob, JobType, notificationQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { RenderStatus } from '@sotto/video';
import { resolveSegmentTiming } from '@/lib/segment-timing';
import { concatenateSegmentPreviews } from '@/lib/video-concat';

if (!process.env.REMOTION_URL) {
  throw new Error('REMOTION_URL is not set — video composition worker cannot start');
}

const REMOTION_URL = process.env.REMOTION_URL;
const POLL_INTERVAL_MS = 5000;
const RENDER_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export async function processVideoComposition(job: Job<ComposeVideoPayload>): Promise<void> {
  const { podcastId, videoGenerationId } = job.data;

  logger.info('Starting video composition', { podcastId, videoGenerationId });
  await job.updateProgress(10);

  // Check podcast still exists
  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, audioUrl: true, duration: true, title: true, userId: true },
  });

  if (!podcast) {
    logger.warn('Podcast deleted during video generation', { podcastId });
    return;
  }

  if (!podcast.audioUrl) {
    throw new Error('No audio URL available');
  }

  try {
    // Update status
    await prisma.videoGeneration.update({
      where: { id: videoGenerationId },
      data: { status: 'COMPOSING' },
    });

    // Fetch segment timing + visuals
    const segmentTimings = await resolveSegmentTiming(podcastId);
    const segmentVisualsBySegment = new Map<string, Array<{
      visualType: string; prompt: string | null; metadata: unknown;
      assetUrl: string | null; assetType: string | null;
      subOrder: number; startOffset: number; subDuration: number | null;
    }>>();

    const visuals = await prisma.segmentVisual.findMany({
      where: { videoGenerationId },
      orderBy: [{ order: 'asc' }, { subOrder: 'asc' }],
      select: {
        segmentId: true, visualType: true, prompt: true, metadata: true,
        assetUrl: true, assetType: true, subOrder: true, startOffset: true, subDuration: true,
      },
    });
    for (const v of visuals) {
      const arr = segmentVisualsBySegment.get(v.segmentId) ?? [];
      arr.push(v);
      segmentVisualsBySegment.set(v.segmentId, arr);
    }

    const renderSegments = segmentTimings.map((s) => {
      const segVisuals = segmentVisualsBySegment.get(s.segmentId) ?? [];
      const first = segVisuals[0];
      const segDuration = s.duration;

      const base = {
        segmentId: s.segmentId,
        order: s.order,
        speaker: s.speaker,
        text: s.text,
        startTime: s.startTime,
        duration: segDuration,
        visualType: first?.visualType ?? 'TEXT_CARD',
        prompt: first?.prompt ?? undefined,
        metadata: (first?.metadata as Record<string, unknown>) ?? undefined,
        assetUrl: first?.assetUrl ?? undefined,
        assetType: first?.assetType ?? undefined,
        subVisuals: segVisuals.length > 1
          ? segVisuals.map((v) => ({
            subOrder: v.subOrder,
            startOffset: v.startOffset,
            duration: v.subDuration ?? segDuration,
            visualType: v.visualType,
            prompt: v.prompt ?? undefined,
            metadata: (v.metadata as Record<string, unknown>) ?? undefined,
            assetUrl: v.assetUrl ?? undefined,
            assetType: v.assetType ?? undefined,
          }))
          : undefined,
      };

      return base;
    });

    // Fetch ready avatar overlays
    const avatarOverlays = await prisma.avatarOverlay.findMany({
      where: { videoGenerationId, status: 'ready' },
      select: { speaker: true, videoUrl: true, posX: true, posY: true, width: true, height: true },
    });

    const avatarOverlayInputs = avatarOverlays
      .filter((o) => o.videoUrl)
      .map((o) => ({
        speaker: o.speaker,
        videoUrl: o.videoUrl!,
        posX: o.posX,
        posY: o.posY,
        width: o.width,
        height: o.height,
      }));

    // Fetch ready transition assets
    const transitionRecords = await prisma.segmentTransition.findMany({
      where: { videoGenerationId, enabled: true, status: 'ready' },
      orderBy: { fromSegmentOrder: 'asc' },
      select: { fromSegmentOrder: true, toSegmentOrder: true, assetUrl: true, durationSeconds: true },
    });

    const transitionInputs = transitionRecords
      .filter((t) => t.assetUrl)
      .map((t) => ({
        fromSegmentOrder: t.fromSegmentOrder,
        toSegmentOrder: t.toSegmentOrder,
        assetUrl: t.assetUrl!,
        durationSeconds: t.durationSeconds,
      }));

    await job.updateProgress(20);

    // Optimization: if all segments have full-quality previews, use FFmpeg concat (much faster)
    const allPreviewVisuals = await prisma.segmentVisual.findMany({
      where: { videoGenerationId },
      select: { order: true, previewUrl: true, previewStatus: true, previewQuality: true },
      orderBy: [{ order: 'asc' }, { subOrder: 'asc' }],
    });

    // Count sub-visuals per segment — only use concat when each segment has exactly one visual
    const subVisualsPerOrder = new Map<number, number>();
    for (const v of allPreviewVisuals) {
      subVisualsPerOrder.set(v.order, (subVisualsPerOrder.get(v.order) ?? 0) + 1);
    }
    const allSingleVisual = [...subVisualsPerOrder.values()].every((count) => count === 1);

    const allHaveFullPreviews = allPreviewVisuals.length > 0 && allSingleVisual &&
      allPreviewVisuals.every((v) => v.previewStatus === 'ready' && v.previewQuality === 'full' && v.previewUrl);

    if (allHaveFullPreviews && transitionInputs.length === 0) {
      logger.info('All segments have full-quality previews, using FFmpeg concat', { podcastId, segments: String(allPreviewVisuals.length) });

      const uniqueSegments = allPreviewVisuals;

      const videoBuffer = await concatenateSegmentPreviews(
        uniqueSegments.map((v) => ({ order: v.order, previewUrl: v.previewUrl! })),
        podcast.audioUrl,
      );

      const videoKey = `podcasts/${podcastId}/video.mp4`;
      const videoUrl = await uploadFile(videoKey, videoBuffer, 'video/mp4');

      await prisma.videoGeneration.update({
        where: { id: videoGenerationId },
        data: { status: 'READY', videoUrl },
      });
      await prisma.podcast.update({
        where: { id: podcastId },
        data: { videoUrl },
      });

      await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
        type: 'VIDEO_READY',
        podcastId,
        userId: podcast.userId,
      });

      logger.info('Video composition complete (FFmpeg concat)', { podcastId, videoUrl });
      await job.updateProgress(100);
      return;
    }

    // POST to Remotion sidecar (full render path)
    const renderResponse = await fetch(`${REMOTION_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioUrl: podcast.audioUrl,
        segments: renderSegments,
        config: {
          width: 1280,
          height: 720,
          fps: 30,
          codec: 'h264',
          crf: 23,
          audioBitrate: '192k',
        },
        branding: {
          primaryColor: '#3F4FB0',
          accentColor: '#2A3550',
          backgroundColor: '#F5F4F0',
          headingFont: 'Newsreader',
          bodyFont: 'IBM Plex Sans',
        },
        ...(avatarOverlayInputs.length > 0 && { avatarOverlays: avatarOverlayInputs }),
        ...(transitionInputs.length > 0 && { transitions: transitionInputs }),
      }),
    });

    if (!renderResponse.ok) {
      const text = await renderResponse.text().catch(() => 'unknown');
      if (renderResponse.status === 429) {
        throw new Error('Remotion sidecar busy — another render is in progress');
      }
      throw new Error(`Remotion render request failed (${renderResponse.status}): ${text}`);
    }

    const { jobId: renderJobId } = (await renderResponse.json()) as { jobId: string };
    logger.info('Remotion render started', { podcastId, renderJobId });

    await job.updateProgress(30);

    // Poll for completion
    const deadline = Date.now() + RENDER_TIMEOUT_MS;
    let lastProgress = 30;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const statusResponse = await fetch(`${REMOTION_URL}/render/${renderJobId}/status`);
      if (!statusResponse.ok) {
        throw new Error(`Failed to check render status: ${statusResponse.status}`);
      }

      const status = (await statusResponse.json()) as { status: string; progress: number; error?: string };

      if (status.status === RenderStatus.DONE) {
        // Scale progress from 30-80 during render
        const renderProgress = Math.min(80, 30 + Math.round(status.progress * 50));
        if (renderProgress > lastProgress) {
          lastProgress = renderProgress;
          await job.updateProgress(renderProgress);
        }
        break;
      }

      if (status.status === RenderStatus.ERROR) {
        throw new Error(`Remotion render failed: ${status.error ?? 'unknown'}`);
      }

      // Update progress based on render progress
      const renderProgress = Math.min(80, 30 + Math.round((status.progress ?? 0) * 50));
      if (renderProgress > lastProgress) {
        lastProgress = renderProgress;
        await job.updateProgress(renderProgress);
      }
    }

    if (Date.now() >= deadline) {
      throw new Error('Remotion render timed out (30 min)');
    }

    await job.updateProgress(80);

    // Download the output MP4
    const outputResponse = await fetch(`${REMOTION_URL}/render/${renderJobId}/output`);
    if (!outputResponse.ok) {
      throw new Error(`Failed to download render output: ${outputResponse.status}`);
    }

    const videoBuffer = Buffer.from(await outputResponse.arrayBuffer());

    await job.updateProgress(90);

    // Upload to R2
    const r2Key = `podcasts/${podcastId}/video.mp4`;
    const videoUrl = await uploadFile(r2Key, videoBuffer, 'video/mp4');

    // Update VideoGeneration
    await prisma.videoGeneration.update({
      where: { id: videoGenerationId },
      data: {
        status: 'READY',
        videoUrl,
        fileSize: videoBuffer.length,
        duration: podcast.duration,
      },
    });

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { videoUrl },
    });

    // Queue notification
    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId: podcast.userId,
      type: 'VIDEO_READY',
      title: 'Video Ready',
      message: `Video for "${podcast.title}" is ready to watch`,
      data: { podcastId },
    });

    await job.updateProgress(100);
    logger.info('Video composition complete', { podcastId, videoGenerationId, fileSize: String(videoBuffer.length) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const descriptive = message === 'fetch failed'
      ? `Remotion sidecar unreachable at ${REMOTION_URL} — is the container running?`
      : message;

    logger.error('Video composition failed', {
      podcastId, videoGenerationId,
      error: descriptive,
      remotionUrl: REMOTION_URL,
    });

    await prisma.videoGeneration.update({
      where: { id: videoGenerationId },
      data: { status: 'FAILED', failureReason: descriptive },
    });

    throw new Error(descriptive);
  }
}
