import { Job } from 'bullmq';
import type { ComposeDemoScenePayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import type { LaunchSceneInput, LaunchVideoInput } from '@sotto/video';
import { DEFAULT_RENDER_CONFIG } from '@sotto/video';

if (!process.env.REMOTION_URL) {
  throw new Error('REMOTION_URL is not set — demo scene composition worker cannot start');
}

const REMOTION_URL = process.env.REMOTION_URL;
const POLL_INTERVAL_MS = 3000;
const RENDER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

async function probeDuration(url: string): Promise<number> {
  const response = await fetch(`${REMOTION_URL}/probe?url=${encodeURIComponent(url)}`);
  if (!response.ok) {
    throw new Error(`Probe failed for ${url}: ${response.status}`);
  }
  const { durationSec } = (await response.json()) as { durationSec: number };
  return durationSec;
}

/**
 * Compose a single scene: recording + voiceover + SFX + overlays.
 * Renders via Remotion LaunchVideo with a single-scene payload (no background
 * music, no grading — those are applied in the final full-video composition).
 */
export async function processDemoSceneComposition(job: Job<ComposeDemoScenePayload>): Promise<void> {
  const { projectId, sceneId } = job.data;

  const scene = await prisma.demoScene.findFirstOrThrow({
    where: { id: sceneId, projectId },
  });

  if (scene.recordingStatus !== 'READY' || !scene.recordingUrl) {
    throw new Error('Recording not ready');
  }
  if (scene.voiceoverStatus !== 'READY' || !scene.voiceoverUrl) {
    throw new Error('Voiceover not ready');
  }

  logger.info('Starting scene composition', { projectId, sceneId, title: scene.title });
  await job.updateProgress(5);

  try {
    // Probe durations
    const [recordingDurationSec, voiceoverDurationSec] = await Promise.all([
      probeDuration(scene.recordingUrl),
      probeDuration(scene.voiceoverUrl),
    ]);
    await job.updateProgress(10);

    // Build single-scene payload
    const sceneInput: LaunchSceneInput = {
      recordingUrl: scene.recordingUrl,
      voiceoverUrl: scene.voiceoverUrl ?? undefined,
      transitionUrl: undefined, // transitions applied in final assembly only
      timingSegments: (scene.timingSegments as unknown as LaunchSceneInput['timingSegments']) ?? undefined,
      sfxConfig: (scene.sfxConfig as unknown as LaunchSceneInput['sfxConfig']) ?? undefined,
      actionTimingLog: (scene.actionTimingLog as unknown as LaunchSceneInput['actionTimingLog']) ?? undefined,
      providerBanner: (scene.providerBanner as unknown as LaunchSceneInput['providerBanner']) ?? undefined,
      overlays: (scene.overlays as unknown as LaunchSceneInput['overlays']) ?? undefined,
      subtitles: (scene.subtitles as unknown as LaunchSceneInput['subtitles']) ?? undefined,
      narration: scene.narration ?? undefined,
      avatarConfig: (scene.avatarConfig as unknown as LaunchSceneInput['avatarConfig']) ?? undefined,
      recordingDurationSec,
      voiceoverDurationSec,
    };

    const renderPayload: LaunchVideoInput & { compositionId: string } = {
      compositionId: 'LaunchVideo',
      scenes: [sceneInput],
      // No background music or grading for per-scene preview
      gradeVideo: false,
      config: { ...DEFAULT_RENDER_CONFIG, width: 1280, height: 720, fps: 30 },
    };

    const renderResponse = await fetch(`${REMOTION_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(renderPayload),
    });

    if (!renderResponse.ok) {
      const text = await renderResponse.text().catch(() => 'unknown');
      throw new Error(`Render request failed (${renderResponse.status}): ${text}`);
    }

    const { jobId: renderJobId } = (await renderResponse.json()) as { jobId: string };
    await job.updateProgress(15);

    // Poll for completion
    const deadline = Date.now() + RENDER_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const statusResponse = await fetch(`${REMOTION_URL}/render/${renderJobId}/status`);
      if (!statusResponse.ok) {
        throw new Error(`Failed to check render status: ${statusResponse.status}`);
      }

      const status = (await statusResponse.json()) as { status: string; progress: number; error?: string };

      if (status.status === 'done') {
        await job.updateProgress(75);
        break;
      }
      if (status.status === 'error') {
        throw new Error(`Rendering failed: ${status.error ?? 'unknown'}`);
      }

      const progress = Math.min(70, 15 + Math.round((status.progress ?? 0) * 0.55));
      await job.updateProgress(progress);
    }

    if (Date.now() >= deadline) {
      throw new Error('Scene composition timed out (10 min)');
    }

    // Download the output
    const outputResponse = await fetch(`${REMOTION_URL}/render/${renderJobId}/output`);
    if (!outputResponse.ok) {
      throw new Error(`Failed to download rendered video: ${outputResponse.status}`);
    }

    const videoBuffer = Buffer.from(await outputResponse.arrayBuffer());
    await job.updateProgress(85);

    // Upload to R2
    const r2Key = `demos/${projectId}/scenes/${sceneId}/composited.mp4`;
    const compositedUrl = await uploadFile(r2Key, videoBuffer, 'video/mp4');

    await prisma.demoScene.update({
      where: { id: sceneId },
      data: { compositedUrl, compositedStatus: 'READY' },
    });

    await job.updateProgress(100);
    logger.info('Scene composition complete', { projectId, sceneId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Scene composition failed', { projectId, sceneId, error: message });

    await prisma.demoScene.update({
      where: { id: sceneId },
      data: { compositedStatus: 'FAILED', failedReason: message },
    });

    throw err;
  }
}
