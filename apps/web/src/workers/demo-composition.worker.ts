import { Job } from 'bullmq';
import type { ComposeDemoPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';

if (!process.env.REMOTION_URL) {
  throw new Error('REMOTION_URL is not set — demo composition worker cannot start');
}

const REMOTION_URL = process.env.REMOTION_URL;
const POLL_INTERVAL_MS = 5000;
const STITCH_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export async function processDemoComposition(job: Job<ComposeDemoPayload>): Promise<void> {
  const { projectId } = job.data;

  const project = await prisma.demoProject.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      scenes: { orderBy: { order: 'asc' } },
    },
  });

  // Verify all scenes have at minimum recording + voiceover READY
  for (const scene of project.scenes) {
    if (scene.recordingStatus !== 'READY' || !scene.recordingUrl) {
      throw new Error(`Scene ${scene.order} recording not ready`);
    }
    if (scene.voiceoverStatus !== 'READY' || !scene.voiceoverUrl) {
      throw new Error(`Scene ${scene.order} voiceover not ready`);
    }
  }

  logger.info('Starting demo composition', { projectId, sceneCount: project.scenes.length });
  await job.updateProgress(5);

  await prisma.demoProject.update({
    where: { id: projectId },
    data: { status: 'COMPOSING' },
  });

  try {
    // Build stitch payload
    const scenes = project.scenes.map((scene) => ({
      recordingUrl: scene.recordingUrl!,
      voiceoverUrl: scene.voiceoverUrl ?? undefined,
      visualUrl: scene.visualUrl ?? undefined,
      visualType: scene.visualType ?? undefined,
      transitionUrl: scene.transitionUrl ?? undefined,
    }));

    const stitchResponse = await fetch(`${REMOTION_URL}/stitch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenes,
        output: { width: 1280, height: 720, fps: 30 },
        gradeVideo: true,
      }),
    });

    if (!stitchResponse.ok) {
      const text = await stitchResponse.text().catch(() => 'unknown');
      throw new Error(`Stitch request failed (${stitchResponse.status}): ${text}`);
    }

    const { jobId: stitchJobId } = (await stitchResponse.json()) as { jobId: string };
    await job.updateProgress(10);

    // Poll for completion
    const deadline = Date.now() + STITCH_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const statusResponse = await fetch(`${REMOTION_URL}/stitch/${stitchJobId}/status`);
      if (!statusResponse.ok) {
        throw new Error(`Failed to check stitch status: ${statusResponse.status}`);
      }

      const status = (await statusResponse.json()) as { status: string; progress: number; error?: string };

      if (status.status === 'done') {
        await job.updateProgress(70);
        break;
      }
      if (status.status === 'error') {
        throw new Error(`Stitching failed: ${status.error ?? 'unknown'}`);
      }

      const progress = Math.min(65, 10 + Math.round((status.progress ?? 0) * 0.55));
      await job.updateProgress(progress);
    }

    if (Date.now() >= deadline) {
      throw new Error('Composition timed out (15 min)');
    }

    // Download the output
    const outputResponse = await fetch(`${REMOTION_URL}/stitch/${stitchJobId}/output`);
    if (!outputResponse.ok) {
      throw new Error(`Failed to download stitched video: ${outputResponse.status}`);
    }

    const videoBuffer = Buffer.from(await outputResponse.arrayBuffer());
    await job.updateProgress(80);

    // Upload to R2
    const r2Key = `demos/${projectId}/final.mp4`;
    const videoUrl = await uploadFile(r2Key, videoBuffer, 'video/mp4');

    await prisma.demoProject.update({
      where: { id: projectId },
      data: { videoUrl, status: 'READY' },
    });

    await job.updateProgress(100);
    logger.info('Demo composition complete', { projectId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Demo composition failed', { projectId, error: message });

    await prisma.demoProject.update({
      where: { id: projectId },
      data: { status: 'FAILED', failedReason: message },
    });

    throw err;
  }
}
