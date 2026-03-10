import { Job } from 'bullmq';
import type { GenerateDemoTransitionPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

const execFileAsync = promisify(execFile);

export async function processDemoTransition(job: Job<GenerateDemoTransitionPayload>): Promise<void> {
  const { projectId, sceneId } = job.data;

  const scene = await prisma.demoScene.findUniqueOrThrow({
    where: { id: sceneId },
    select: { order: true, transitionType: true, recordingUrl: true, projectId: true },
  });

  if (scene.projectId !== projectId) {
    throw new Error('Scene does not belong to project');
  }

  if (!scene.transitionType) {
    logger.info('No transition configured for scene, skipping', { projectId, sceneId });
    return;
  }

  // Find the next scene
  const nextScene = await prisma.demoScene.findFirst({
    where: { projectId, order: scene.order + 1 },
    select: { recordingUrl: true },
  });

  if (!scene.recordingUrl || !nextScene?.recordingUrl) {
    throw new Error('Both current and next scene must have recordings for a transition');
  }

  logger.info('Generating demo transition', { projectId, sceneId, type: scene.transitionType });
  await job.updateProgress(10);

  await prisma.demoScene.update({
    where: { id: sceneId },
    data: { transitionStatus: 'GENERATING' },
  });

  try {
    // Download both recordings to temp files
    const tmpDir = path.join(os.tmpdir(), `sotto-transition-${sceneId}`);
    await fs.mkdir(tmpDir, { recursive: true });

    const currentPath = path.join(tmpDir, 'current.mp4');
    const nextPath = path.join(tmpDir, 'next.mp4');
    const outputPath = path.join(tmpDir, 'transition.mp4');

    // Download current scene recording (last 1 second)
    const currentResponse = await fetch(scene.recordingUrl);
    await fs.writeFile(currentPath, Buffer.from(await currentResponse.arrayBuffer()));

    // Download next scene recording (first 1 second)
    const nextResponse = await fetch(nextScene.recordingUrl);
    await fs.writeFile(nextPath, Buffer.from(await nextResponse.arrayBuffer()));

    await job.updateProgress(40);

    // Generate transition using FFmpeg crossfade
    const transitionDuration = 1;
    const filterComplex = buildTransitionFilter(scene.transitionType, transitionDuration);

    await execFileAsync('ffmpeg', [
      '-y',
      '-sseof', `-${transitionDuration}`, '-i', currentPath,
      '-t', String(transitionDuration), '-i', nextPath,
      '-filter_complex', filterComplex,
      '-map', '[v]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-an',
      outputPath,
    ], { timeout: 60000 });

    await job.updateProgress(70);

    // Upload to R2
    const transitionBuffer = await fs.readFile(outputPath);
    const r2Key = `demos/${projectId}/scenes/${sceneId}/transition.mp4`;
    const transitionUrl = await uploadFile(r2Key, transitionBuffer, 'video/mp4');

    await prisma.demoScene.update({
      where: { id: sceneId },
      data: { transitionUrl, transitionStatus: 'READY' },
    });

    // Clean up
    await fs.rm(tmpDir, { recursive: true }).catch(() => {});

    await job.updateProgress(100);
    logger.info('Demo transition complete', { projectId, sceneId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Demo transition failed', { projectId, sceneId, error: message });

    await prisma.demoScene.update({
      where: { id: sceneId },
      data: { transitionStatus: 'FAILED' },
    });

    throw err;
  }
}

function buildTransitionFilter(type: string, duration: number): string {
  switch (type) {
    case 'dissolve':
    case 'fade':
      return `[0:v][1:v]xfade=transition=fade:duration=${duration}:offset=0[v]`;
    case 'wipe':
      return `[0:v][1:v]xfade=transition=wipeleft:duration=${duration}:offset=0[v]`;
    default:
      return `[0:v][1:v]xfade=transition=fade:duration=${duration}:offset=0[v]`;
  }
}
