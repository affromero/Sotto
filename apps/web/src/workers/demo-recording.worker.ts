import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { encode } from '@auth/core/jwt';
import type { GenerateDemoRecordingPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';

if (!process.env.REMOTION_URL) {
  throw new Error('REMOTION_URL is not set — demo recording worker cannot start');
}

const REMOTION_URL = process.env.REMOTION_URL;
const POLL_INTERVAL_MS = 3000;
const RECORD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export async function processDemoRecording(job: Job<GenerateDemoRecordingPayload>): Promise<void> {
  const { projectId, sceneId } = job.data;

  const scene = await prisma.demoScene.findUniqueOrThrow({
    where: { id: sceneId },
    select: { actions: true, projectId: true },
  });

  if (scene.projectId !== projectId) {
    throw new Error('Scene does not belong to project');
  }

  logger.info('Starting demo recording', { projectId, sceneId });
  await job.updateProgress(10);

  // Mark as generating
  await prisma.demoScene.update({
    where: { id: sceneId },
    data: { recordingStatus: 'GENERATING', failedReason: null },
  });

  try {
    const project = await prisma.demoProject.findUniqueOrThrow({
      where: { id: projectId },
      select: { userId: true },
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: project.userId },
      select: { id: true, name: true, email: true, image: true, role: true },
    });

    const appUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const isSecure = appUrl.startsWith('https://');
    const cookieName = isSecure ? '__Secure-authjs.session-token' : 'authjs.session-token';
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error('AUTH_SECRET is not set');

    const maxAge = 30 * 60; // 30 minutes
    const sessionToken = await encode({
      token: {
        sub: user.id,
        name: user.name,
        email: user.email,
        picture: user.image,
        role: user.role,
      },
      secret,
      maxAge,
      salt: cookieName,
    });

    // POST to Remotion sidecar /record
    const recordResponse = await fetch(`${REMOTION_URL}/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actions: scene.actions,
        sessionToken,
        cookieName,
        appUrl,
        viewport: { width: 1920, height: 1080 },
        gradeVideo: true,
      }),
    });

    if (!recordResponse.ok) {
      const text = await recordResponse.text().catch(() => 'unknown');
      throw new Error(`Record request failed (${recordResponse.status}): ${text}`);
    }

    const { jobId: recordJobId } = (await recordResponse.json()) as { jobId: string };
    await job.updateProgress(20);

    // Poll for completion
    const deadline = Date.now() + RECORD_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const statusResponse = await fetch(`${REMOTION_URL}/record/${recordJobId}/status`);
      if (!statusResponse.ok) {
        throw new Error(`Failed to check record status: ${statusResponse.status}`);
      }

      const status = (await statusResponse.json()) as {
        status: string;
        progress: number;
        error?: string;
        actionTimingLog?: Array<{ type: string; timestampMs: number; meta?: Record<string, unknown> }>;
      };

      if (status.status === 'done') {
        // Store timing log for SFX placement during composition
        if (status.actionTimingLog) {
          await prisma.demoScene.update({
            where: { id: sceneId },
            data: { actionTimingLog: status.actionTimingLog as unknown as Prisma.InputJsonValue },
          });
        }
        await job.updateProgress(70);
        break;
      }
      if (status.status === 'error') {
        throw new Error(`Recording failed: ${status.error ?? 'unknown'}`);
      }

      const progress = Math.min(60, 20 + Math.round((status.progress ?? 0) * 0.4));
      await job.updateProgress(progress);
    }

    if (Date.now() >= deadline) {
      throw new Error('Recording timed out (10 min)');
    }

    // Download the output
    const outputResponse = await fetch(`${REMOTION_URL}/record/${recordJobId}/output`);
    if (!outputResponse.ok) {
      throw new Error(`Failed to download recording: ${outputResponse.status}`);
    }

    const videoBuffer = Buffer.from(await outputResponse.arrayBuffer());
    await job.updateProgress(80);

    // Upload to R2
    const r2Key = `demos/${projectId}/scenes/${sceneId}/recording.mp4`;
    const recordingUrl = await uploadFile(r2Key, videoBuffer, 'video/mp4');

    // Update scene
    await prisma.demoScene.update({
      where: { id: sceneId },
      data: { recordingUrl, recordingStatus: 'READY', compositedStatus: 'PENDING' },
    });

    await job.updateProgress(100);
    logger.info('Demo recording complete', { projectId, sceneId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Demo recording failed', { projectId, sceneId, error: message });

    await prisma.demoScene.update({
      where: { id: sceneId },
      data: { recordingStatus: 'FAILED', failedReason: message },
    });

    throw err;
  }
}
