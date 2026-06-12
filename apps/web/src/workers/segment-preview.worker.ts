import { Job } from 'bullmq';
import { RenderSegmentPreviewPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import type { VideoSegment } from '@sotto/video';

const REMOTION_URL = process.env.REMOTION_URL;

export async function processSegmentPreview(job: Job<RenderSegmentPreviewPayload>): Promise<void> {
  const { episodeId, segmentVisualId, quality } = job.data;

  logger.info('Rendering segment preview', { episodeId, segmentVisualId, quality });
  await job.updateProgress(10);

  if (!REMOTION_URL) {
    throw new Error('REMOTION_URL not configured');
  }

  // Update status to rendering
  await prisma.segmentVisual.update({
    where: { id: segmentVisualId },
    data: { previewStatus: 'rendering' },
  });

  try {
    // Load segment visual + segment data
    const segmentVisual = await prisma.segmentVisual.findUniqueOrThrow({
      where: { id: segmentVisualId },
      include: {
        segment: {
          select: { id: true, order: true, speaker: true, text: true, startTime: true, duration: true },
        },
      },
    });

    // Load episode audio URL
    const episode = await prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: { audioUrl: true },
    });

    const seg = segmentVisual.segment;

    // Build VideoSegment for the sidecar
    const videoSegment: VideoSegment = {
      segmentId: seg.id,
      order: seg.order,
      speaker: seg.speaker,
      text: seg.text,
      startTime: 0, // Relative to this segment (starts at 0)
      duration: segmentVisual.subDuration ?? seg.duration ?? 5,
      visualType: segmentVisual.visualType,
      assetUrl: segmentVisual.assetUrl ?? undefined,
      assetType: segmentVisual.assetType ?? undefined,
      metadata: segmentVisual.metadata as Record<string, unknown> | undefined,
      prompt: segmentVisual.prompt ?? undefined,
    };

    await job.updateProgress(30);

    // Call sidecar /clip with audio
    const response = await fetch(`${REMOTION_URL}/clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segment: videoSegment,
        durationSeconds: videoSegment.duration,
        audioUrl: episode.audioUrl ?? undefined,
        audioStartTime: seg.startTime,
        quality,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Sidecar /clip failed: ${response.status} — ${errorText}`);
    }

    await job.updateProgress(70);

    // Upload to R2
    const buffer = Buffer.from(await response.arrayBuffer());
    const r2Key = `episodes/${episodeId}/previews/${segmentVisualId}-${quality}.mp4`;
    const previewUrl = await uploadFile(r2Key, buffer, 'video/mp4');

    // Update segment visual
    await prisma.segmentVisual.update({
      where: { id: segmentVisualId },
      data: {
        previewUrl,
        previewStatus: 'ready',
        previewQuality: quality,
      },
    });

    await job.updateProgress(100);
    logger.info('Segment preview ready', { episodeId, segmentVisualId, previewUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Preview render failed';
    logger.error('Segment preview failed', { episodeId, segmentVisualId, error: message });

    await prisma.segmentVisual.update({
      where: { id: segmentVisualId },
      data: { previewStatus: 'failed' },
    });

    throw err;
  }
}
