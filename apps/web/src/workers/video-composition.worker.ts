import { Job } from 'bullmq';
import { ComposeVideoPayload, addJob, JobType, notificationQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';

const REMOTION_URL = process.env.REMOTION_URL || 'http://localhost:3100';
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
    throw new Error('Podcast has no audio URL');
  }

  try {
    // Update status
    await prisma.videoGeneration.update({
      where: { id: videoGenerationId },
      data: { status: 'COMPOSING' },
    });

    // Fetch segments with timing and visuals
    const segments = await prisma.segment.findMany({
      where: { podcastId },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        order: true,
        speaker: true,
        text: true,
        startTime: true,
        duration: true,
        segmentVisuals: {
          where: { videoGenerationId },
          select: {
            visualType: true,
            prompt: true,
            metadata: true,
            assetUrl: true,
            assetType: true,
          },
        },
      },
    });

    const renderSegments = segments.map((s) => {
      const visual = s.segmentVisuals[0];
      return {
        segmentId: s.id,
        order: s.order,
        speaker: s.speaker,
        text: s.text,
        startTime: s.startTime ?? 0,
        duration: s.duration ?? 5,
        visualType: visual?.visualType ?? 'TEXT_CARD',
        prompt: visual?.prompt ?? undefined,
        metadata: (visual?.metadata as Record<string, unknown>) ?? undefined,
        assetUrl: visual?.assetUrl ?? undefined,
        assetType: visual?.assetType ?? undefined,
      };
    });

    await job.updateProgress(20);

    // POST to Remotion sidecar
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
          primaryColor: '#D97706',
          accentColor: '#1E3A5F',
          backgroundColor: '#FEFCF8',
          headingFont: 'DM Serif Display',
          bodyFont: 'Inter',
        },
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

      if (status.status === 'completed') {
        // Scale progress from 30-80 during render
        const renderProgress = Math.min(80, 30 + Math.round(status.progress * 50));
        if (renderProgress > lastProgress) {
          lastProgress = renderProgress;
          await job.updateProgress(renderProgress);
        }
        break;
      }

      if (status.status === 'failed') {
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

    // Update VideoGeneration and Podcast
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
