import { Job } from 'bullmq';
import type { ComposeDemoPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import type { LaunchSceneInput, LaunchVideoInput } from '@sotto/video';
import { DEFAULT_RENDER_CONFIG } from '@sotto/video';

if (!process.env.REMOTION_URL) {
  throw new Error('REMOTION_URL is not set — demo composition worker cannot start');
}

const REMOTION_URL = process.env.REMOTION_URL;
const POLL_INTERVAL_MS = 5000;
const RENDER_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/** Probe media duration via the sidecar /probe endpoint. */
async function probeDuration(url: string): Promise<number> {
  const response = await fetch(`${REMOTION_URL}/probe?url=${encodeURIComponent(url)}`);
  if (!response.ok) {
    throw new Error(`Probe failed for ${url}: ${response.status}`);
  }
  const { durationSec } = (await response.json()) as { durationSec: number };
  return durationSec;
}

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
    // Probe durations for all scenes in parallel
    const durationProbes = project.scenes.map(async (scene) => {
      const [recordingDurationSec, voiceoverDurationSec] = await Promise.all([
        probeDuration(scene.recordingUrl!),
        scene.voiceoverUrl ? probeDuration(scene.voiceoverUrl) : Promise.resolve(undefined),
      ]);
      return { recordingDurationSec, voiceoverDurationSec };
    });
    const durations = await Promise.all(durationProbes);
    await job.updateProgress(8);

    // Build LaunchVideo payload with pre-calculated durations
    const scenes: LaunchSceneInput[] = project.scenes.map((scene, i) => ({
      recordingUrl: scene.recordingUrl!,
      voiceoverUrl: scene.voiceoverUrl ?? undefined,
      transitionUrl: scene.transitionUrl ?? undefined,
      timingSegments: (scene.timingSegments as unknown as LaunchSceneInput['timingSegments']) ?? undefined,
      sfxConfig: (scene.sfxConfig as unknown as LaunchSceneInput['sfxConfig']) ?? undefined,
      actionTimingLog: (scene.actionTimingLog as unknown as LaunchSceneInput['actionTimingLog']) ?? undefined,
      providerBanner: (scene.providerBanner as unknown as LaunchSceneInput['providerBanner']) ?? undefined,
      overlays: (scene.overlays as unknown as LaunchSceneInput['overlays']) ?? undefined,
      subtitles: (scene.subtitles as unknown as LaunchSceneInput['subtitles']) ?? undefined,
      narration: scene.narration ?? undefined,
      avatarConfig: (scene.avatarConfig as unknown as LaunchSceneInput['avatarConfig']) ?? undefined,
      recordingDurationSec: durations[i].recordingDurationSec,
      voiceoverDurationSec: durations[i].voiceoverDurationSec,
    }));

    const renderPayload: LaunchVideoInput & { compositionId: string } = {
      compositionId: 'LaunchVideo',
      scenes,
      backgroundMusicUrl: project.backgroundMusicUrl ?? undefined,
      backgroundMusicVolume: project.backgroundMusicVolume ?? undefined,
      gradeVideo: true,
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
    await job.updateProgress(10);

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
        await job.updateProgress(70);
        break;
      }
      if (status.status === 'error') {
        throw new Error(`Rendering failed: ${status.error ?? 'unknown'}`);
      }

      const progress = Math.min(65, 10 + Math.round((status.progress ?? 0) * 0.55));
      await job.updateProgress(progress);
    }

    if (Date.now() >= deadline) {
      throw new Error('Composition timed out (15 min)');
    }

    // Download the output
    const outputResponse = await fetch(`${REMOTION_URL}/render/${renderJobId}/output`);
    if (!outputResponse.ok) {
      throw new Error(`Failed to download rendered video: ${outputResponse.status}`);
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
