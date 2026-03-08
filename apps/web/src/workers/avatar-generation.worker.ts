import { type Job, UnrecoverableError } from 'bullmq';
import type { GenerateAvatarPayload } from '@/lib/queue';
import { addJob, JobType, videoCompositionQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { logUsage } from '@/lib/usage-logger';
import { submitAvatarVideo, pollAvatarVideo, isNonRetryableHeyGenError } from '@/lib/heygen';
import { concatenateSpeakerAudio } from '@/lib/avatar-audio-concat';

export async function processAvatarGeneration(job: Job<GenerateAvatarPayload>): Promise<void> {
  const { podcastId, videoGenerationId, avatarOverlayId, speaker, avatarId } = job.data;

  logger.info('Starting avatar generation', { podcastId, speaker, avatarId });

  const overlay = await prisma.avatarOverlay.findUnique({
    where: { id: avatarOverlayId },
  });

  if (!overlay) {
    logger.warn('AvatarOverlay not found, skipping', { avatarOverlayId });
    return;
  }

  // Idempotency: skip if already has a video
  if (overlay.videoUrl) {
    logger.info('Avatar overlay already has video, skipping', { avatarOverlayId });
    await checkAllAvatarsReady(videoGenerationId, podcastId);
    return;
  }

  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    throw new Error('HEYGEN_API_KEY is not configured');
  }

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { mkdtemp, readFile, rm } = await import('fs/promises');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const execFileAsync = promisify(execFile);

  const tmpDir = await mkdtemp(join(tmpdir(), 'avatar-'));

  try {
    let concatAudioUrl: string;
    let durationSeconds: number;
    let heygenVideoId: string;

    // Checkpoint 1: Skip concat + upload if already done on a previous attempt
    if (overlay.concatAudioUrl && overlay.durationSeconds) {
      logger.info('Concat audio already exists, skipping concat', { avatarOverlayId });
      concatAudioUrl = overlay.concatAudioUrl;
      durationSeconds = overlay.durationSeconds;
      await job.updateProgress(30);
    } else {
      // Step 1: Update status
      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { status: 'concatenating' },
      });
      await job.updateProgress(10);

      // Step 2: Fetch segments for this speaker
      const segments = await prisma.segment.findMany({
        where: { podcastId, speaker },
        orderBy: { order: 'asc' },
        select: { id: true, order: true, audioUrl: true },
      });

      if (segments.length === 0) {
        throw new Error(`No segments found for speaker "${speaker}"`);
      }

      const segmentsWithAudio = segments.filter((s) => s.audioUrl);
      if (segmentsWithAudio.length === 0) {
        throw new Error(`No audio segments found for speaker "${speaker}"`);
      }

      // Step 3: Concatenate speaker audio
      const concatOutputPath = join(tmpDir, `${speaker}-concat.mp3`);
      const concatResult = await concatenateSpeakerAudio({
        segments: segmentsWithAudio.map((s) => ({ audioUrl: s.audioUrl!, order: s.order })),
        outputPath: concatOutputPath,
      });
      durationSeconds = concatResult.durationSeconds;

      await job.updateProgress(25);

      // Step 4: Upload concat audio to R2
      const concatAudioBuffer = await readFile(concatOutputPath);
      const concatAudioKey = `podcasts/${podcastId}/avatars/${speaker}-audio.mp3`;
      concatAudioUrl = await uploadFile(concatAudioKey, concatAudioBuffer, 'audio/mpeg');

      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { concatAudioUrl, durationSeconds, status: 'submitting' },
      });

      await job.updateProgress(30);
    }

    // Checkpoint 2: Skip HeyGen submission if already submitted (prevents credit waste on retry)
    if (overlay.heygenVideoId) {
      logger.info('HeyGen video already submitted, skipping to polling', {
        avatarOverlayId,
        heygenVideoId: overlay.heygenVideoId,
      });
      heygenVideoId = overlay.heygenVideoId;
    } else {
      // Step 5: Submit to HeyGen
      heygenVideoId = await submitAvatarVideo({
        apiKey,
        avatarId,
        audioUrl: concatAudioUrl,
      });

      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { heygenVideoId, status: 'processing' },
      });
    }

    await job.updateProgress(35);

    // Step 6: Poll HeyGen until completed (up to 15 min)
    const { videoUrl: heygenVideoUrl } = await pollAvatarVideo({
      apiKey,
      videoId: heygenVideoId,
    });

    await job.updateProgress(70);

    // Step 7: Download green-screen video
    const greenVideoRes = await fetch(heygenVideoUrl);
    if (!greenVideoRes.ok) {
      throw new Error(`Failed to download HeyGen video: ${greenVideoRes.status}`);
    }
    const greenVideoPath = join(tmpDir, 'green.mp4');
    const greenVideoBuffer = Buffer.from(await greenVideoRes.arrayBuffer());
    const { writeFile } = await import('fs/promises');
    await writeFile(greenVideoPath, greenVideoBuffer);

    await job.updateProgress(80);

    // Step 8: Chromakey to transparent WebM
    const transparentPath = join(tmpDir, 'transparent.webm');
    const chromakeyTimeout = Math.max(300_000, Math.round(durationSeconds * 3000));
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', greenVideoPath,
      '-vf', 'chromakey=0x00ff00:0.15:0.1',
      '-c:v', 'libvpx-vp9',
      '-auto-alt-ref', '0',
      '-an',
      transparentPath,
    ], { timeout: chromakeyTimeout });

    await job.updateProgress(90);

    // Step 9: Upload transparent WebM to R2
    const webmBuffer = await readFile(transparentPath);
    const webmKey = `podcasts/${podcastId}/avatars/${speaker}-avatar.webm`;
    const videoUrl = await uploadFile(webmKey, webmBuffer, 'video/webm');

    // Step 10: Update overlay as ready
    await prisma.avatarOverlay.update({
      where: { id: avatarOverlayId },
      data: { videoUrl, status: 'ready' },
    });

    // Step 11: Log cost
    logUsage({
      service: 'heygen',
      category: 'avatar_generation',
      totalCost: (durationSeconds / 60) * 0.10,
      podcastId,
      durationMs: Math.round(durationSeconds * 1000),
      metadata: { speaker, avatarId, durationSeconds },
    });

    await job.updateProgress(95);

    // Step 12: Check if all avatars are ready
    await checkAllAvatarsReady(videoGenerationId, podcastId);

    await job.updateProgress(100);
    logger.info('Avatar generation complete', { podcastId, speaker, avatarOverlayId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.avatarOverlay.update({
      where: { id: avatarOverlayId },
      data: { status: 'failed', failureReason: message },
    });

    // Check if all avatars are done (some may have failed)
    await checkAllAvatarsReady(videoGenerationId, podcastId);

    // Billing/credit errors should never be retried — prevents burning more credits
    if (isNonRetryableHeyGenError(err)) {
      logger.error('Non-retryable HeyGen error, stopping retries', { message, avatarOverlayId });
      throw new UnrecoverableError(message);
    }

    throw err;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function checkAllAvatarsReady(videoGenerationId: string, podcastId: string): Promise<void> {
  const pending = await prisma.avatarOverlay.count({
    where: {
      videoGenerationId,
      status: { in: ['pending', 'concatenating', 'submitting', 'processing'] },
    },
  });

  if (pending > 0) return;

  const failed = await prisma.avatarOverlay.count({
    where: { videoGenerationId, status: 'failed' },
  });

  if (failed > 0) {
    // Avatar failure is non-critical — the base video is already generated.
    // Keep status as READY so the video remains visible; individual overlay
    // records already track their own status/failureReason.
    await prisma.videoGeneration.update({
      where: { id: videoGenerationId },
      data: { status: 'READY' },
    });
    return;
  }

  // All avatars ready — proceed to composition or mark ready
  if (process.env.ENABLE_VIDEO_EXPORT === 'true') {
    await addJob(videoCompositionQueue, JobType.COMPOSE_VIDEO, {
      podcastId,
      videoGenerationId,
    });
  } else {
    await prisma.videoGeneration.update({
      where: { id: videoGenerationId },
      data: { status: 'READY' },
    });
  }
}
