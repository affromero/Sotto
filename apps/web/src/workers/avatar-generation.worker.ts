import { type Job, UnrecoverableError } from 'bullmq';
import type { GenerateAvatarPayload } from '@/lib/queue';
import { addJob, JobType, videoCompositionQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { uploadFile, deleteFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { logUsage } from '@/lib/usage-logger';
import { submitAvatarVideo, pollAvatarVideo, isNonRetryableHeyGenError } from '@/lib/heygen';
import { isNonRetryableRunwayError } from '@/lib/runway';
import { concatenateSpeakerAudio } from '@/lib/avatar-audio-concat';

export async function processAvatarGeneration(job: Job<GenerateAvatarPayload>): Promise<void> {
  const provider = job.data.avatarProvider ?? 'heygen';
  if (provider === 'runway') {
    return processRunwayAvatar(job);
  }
  return processHeyGenAvatar(job);
}

// ── HeyGen path (existing logic, extracted verbatim) ──

async function processHeyGenAvatar(job: Job<GenerateAvatarPayload>): Promise<void> {
  const { podcastId, videoGenerationId, avatarOverlayId, speaker, avatarId } = job.data;

  logger.info('Starting HeyGen avatar generation', { podcastId, speaker, avatarId });

  const overlay = await prisma.avatarOverlay.findUnique({
    where: { id: avatarOverlayId },
  });

  if (!overlay) {
    logger.warn('AvatarOverlay not found, skipping', { avatarOverlayId });
    return;
  }

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

    if (overlay.concatAudioUrl && overlay.durationSeconds) {
      logger.info('Concat audio already exists, skipping concat', { avatarOverlayId });
      concatAudioUrl = overlay.concatAudioUrl;
      durationSeconds = overlay.durationSeconds;
      await job.updateProgress(30);
    } else {
      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { status: 'concatenating' },
      });
      await job.updateProgress(10);

      const segments = await prisma.segment.findMany({
        where: { podcastId, speaker },
        orderBy: { order: 'asc' },
        select: { id: true, order: true, audioUrl: true },
      });

      if (segments.length === 0) {
        throw new Error(`No segments found for speaker "${speaker}"`);
      }

      // Filter to enabled segments only (empty array = all enabled)
      const enabled = overlay.enabledSegmentIds;
      const filteredSegments = enabled.length > 0
        ? segments.filter((s) => enabled.includes(s.id))
        : segments;

      const segmentsWithAudio = filteredSegments.filter((s) => s.audioUrl);
      if (segmentsWithAudio.length === 0) {
        throw new Error(`No audio segments found for speaker "${speaker}"`);
      }

      const concatOutputPath = join(tmpDir, `${speaker}-concat.mp3`);
      const concatResult = await concatenateSpeakerAudio({
        segments: segmentsWithAudio.map((s) => ({ audioUrl: s.audioUrl!, order: s.order })),
        outputPath: concatOutputPath,
      });
      durationSeconds = concatResult.durationSeconds;

      await job.updateProgress(25);

      const concatAudioBuffer = await readFile(concatOutputPath);
      const concatAudioKey = `podcasts/${podcastId}/avatars/${speaker}-audio.mp3`;
      concatAudioUrl = await uploadFile(concatAudioKey, concatAudioBuffer, 'audio/mpeg');

      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { concatAudioUrl, durationSeconds, status: 'submitting' },
      });

      await job.updateProgress(30);
    }

    if (overlay.heygenVideoId) {
      logger.info('HeyGen video already submitted, skipping to polling', {
        avatarOverlayId,
        heygenVideoId: overlay.heygenVideoId,
      });
      heygenVideoId = overlay.heygenVideoId;
    } else {
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

    const { videoUrl: heygenVideoUrl } = await pollAvatarVideo({
      apiKey,
      videoId: heygenVideoId,
    });

    await job.updateProgress(70);

    const greenVideoRes = await fetch(heygenVideoUrl);
    if (!greenVideoRes.ok) {
      throw new Error(`Failed to download HeyGen video: ${greenVideoRes.status}`);
    }
    const greenVideoPath = join(tmpDir, 'green.mp4');
    const greenVideoBuffer = Buffer.from(await greenVideoRes.arrayBuffer());
    const { writeFile } = await import('fs/promises');
    await writeFile(greenVideoPath, greenVideoBuffer);

    await job.updateProgress(80);

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

    const webmBuffer = await readFile(transparentPath);
    const webmKey = `podcasts/${podcastId}/avatars/${speaker}-avatar.webm`;
    const videoUrl = await uploadFile(webmKey, webmBuffer, 'video/webm');

    await prisma.avatarOverlay.update({
      where: { id: avatarOverlayId },
      data: { videoUrl, status: 'ready' },
    });

    logUsage({
      service: 'heygen',
      category: 'avatar_generation',
      totalCost: (durationSeconds / 60) * 0.10,
      podcastId,
      durationMs: Math.round(durationSeconds * 1000),
      metadata: { speaker, avatarId, durationSeconds },
    });

    await job.updateProgress(95);

    await checkAllAvatarsReady(videoGenerationId, podcastId);

    await job.updateProgress(100);
    logger.info('HeyGen avatar generation complete', { podcastId, speaker, avatarOverlayId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.avatarOverlay.update({
      where: { id: avatarOverlayId },
      data: { status: 'failed', failureReason: message },
    });

    await checkAllAvatarsReady(videoGenerationId, podcastId);

    if (isNonRetryableHeyGenError(err)) {
      logger.error('Non-retryable HeyGen error, stopping retries', { message, avatarOverlayId });
      throw new UnrecoverableError(message);
    }

    throw err;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Runway path (realtime sessions via Playwright) ──

async function processRunwayAvatar(job: Job<GenerateAvatarPayload>): Promise<void> {
  const { podcastId, videoGenerationId, avatarOverlayId, speaker, avatarId, isPreset } = job.data;

  logger.info('Starting Runway avatar generation', { podcastId, speaker, avatarId });

  const overlay = await prisma.avatarOverlay.findUnique({
    where: { id: avatarOverlayId },
  });

  if (!overlay) {
    logger.warn('AvatarOverlay not found, skipping', { avatarOverlayId });
    return;
  }

  if (overlay.videoUrl) {
    logger.info('Avatar overlay already has video, skipping', { avatarOverlayId });
    await checkAllAvatarsReady(videoGenerationId, podcastId);
    return;
  }

  const apiKey = process.env.RUNWAY_API_KEY;
  if (!apiKey) {
    throw new Error('RUNWAY_API_KEY is not configured');
  }

  const { mkdtemp, readFile, rm } = await import('fs/promises');
  const { join } = await import('path');
  const { tmpdir } = await import('os');

  const tmpDir = await mkdtemp(join(tmpdir(), 'runway-'));

  try {
    let concatAudioUrl: string;
    let durationSeconds: number;

    // Checkpoint 1: Concat speaker audio → R2
    if (overlay.concatAudioUrl && overlay.durationSeconds) {
      logger.info('Concat audio already exists, skipping concat', { avatarOverlayId });
      concatAudioUrl = overlay.concatAudioUrl;
      durationSeconds = overlay.durationSeconds;
      await job.updateProgress(10);
    } else {
      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { status: 'concatenating' },
      });

      const segments = await prisma.segment.findMany({
        where: { podcastId, speaker },
        orderBy: { order: 'asc' },
        select: { id: true, order: true, audioUrl: true },
      });

      if (segments.length === 0) {
        throw new Error(`No segments found for speaker "${speaker}"`);
      }

      // Filter to enabled segments only (empty array = all enabled)
      const enabled = overlay.enabledSegmentIds;
      const filteredSegments = enabled.length > 0
        ? segments.filter((s) => enabled.includes(s.id))
        : segments;

      const segmentsWithAudio = filteredSegments.filter((s) => s.audioUrl);
      if (segmentsWithAudio.length === 0) {
        throw new Error(`No audio segments found for speaker "${speaker}"`);
      }

      const concatOutputPath = join(tmpDir, `${speaker}-concat.mp3`);
      const concatResult = await concatenateSpeakerAudio({
        segments: segmentsWithAudio.map((s) => ({ audioUrl: s.audioUrl!, order: s.order })),
        outputPath: concatOutputPath,
      });
      durationSeconds = concatResult.durationSeconds;

      const concatAudioBuffer = await readFile(concatOutputPath);
      const concatAudioKey = `podcasts/${podcastId}/avatars/${speaker}-audio.mp3`;
      concatAudioUrl = await uploadFile(concatAudioKey, concatAudioBuffer, 'audio/mpeg');

      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { concatAudioUrl, durationSeconds, status: 'processing' },
      });

      await job.updateProgress(10);
    }

    // Checkpoint 2: Split into chunks
    const { splitAudioIntoChunks, concatenateVideoChunks } = await import('@/lib/runway-chunker');

    // Download concat audio to local disk for chunking
    const localAudioPath = join(tmpDir, 'concat-audio.mp3');
    const audioRes = await fetch(concatAudioUrl);
    if (!audioRes.ok) throw new Error(`Failed to download concat audio: ${audioRes.status}`);
    const { writeFile } = await import('fs/promises');
    await writeFile(localAudioPath, Buffer.from(await audioRes.arrayBuffer()));

    const chunks = await splitAudioIntoChunks({
      audioPath: localAudioPath,
      totalDuration: durationSeconds,
      tmpDir,
    });

    await prisma.avatarOverlay.update({
      where: { id: avatarOverlayId },
      data: { runwayTotalChunks: chunks.length },
    });

    await job.updateProgress(20);

    // Process each chunk (resume from checkpoint)
    const startChunkIndex = overlay.runwayChunkIndex ?? 0;
    const { createRealtimeSession, pollSessionReady, consumeSession, deleteSession } = await import('@/lib/runway');
    const { recordRunwaySession } = await import('@/lib/runway-session');

    for (let i = startChunkIndex; i < chunks.length; i++) {
      const chunk = chunks[i];
      let sessionId: string | undefined;

      try {
        // Create session
        sessionId = await createRealtimeSession({
          apiKey,
          avatarId,
          isPreset: isPreset ?? false,
          maxDuration: 300,
        });

        await prisma.avatarOverlay.update({
          where: { id: avatarOverlayId },
          data: { runwaySessionId: sessionId },
        });

        // Poll until READY
        const sessionKey = await pollSessionReady({ apiKey, sessionId });

        // Consume → LiveKit credentials
        const credentials = await consumeSession({ sessionKey, sessionId });

        // Record via Playwright
        await recordRunwaySession({
          credentials,
          audioFilePath: chunk.inputPath,
          outputVideoPath: chunk.outputPath,
          onProgress: (pct) => {
            const chunkProgress = 20 + ((i + pct / 100) / chunks.length) * 50;
            job.updateProgress(Math.round(chunkProgress)).catch(() => {});
          },
        });

        // Upload chunk to R2 for progressive playback
        const chunkBuffer = await readFile(chunk.outputPath);
        const chunkR2Key = `podcasts/${podcastId}/avatars/${speaker}-chunk-${i}.webm`;
        const chunkR2Url = await uploadFile(chunkR2Key, chunkBuffer, 'video/webm');
        const cumulativeDuration = chunks.slice(0, i + 1).reduce((sum, c) => sum + c.durationSeconds, 0);

        // Update chunk checkpoint + progressive preview URL
        await prisma.avatarOverlay.update({
          where: { id: avatarOverlayId },
          data: {
            runwayChunkIndex: i + 1,
            runwaySessionId: null,
            chunkVideoUrl: chunkR2Url,
            chunkDurationSeconds: cumulativeDuration,
          },
        });
      } finally {
        // Always clean up session
        if (sessionId) {
          await deleteSession({ apiKey, sessionId });
        }
      }
    }

    await job.updateProgress(75);

    // Concatenate chunks if multiple
    const finalVideoPath = join(tmpDir, 'final.webm');
    await concatenateVideoChunks({ chunks, outputPath: finalVideoPath });

    await job.updateProgress(85);

    // Upload to R2 (no chromakey — Runway has scene background)
    const webmBuffer = await readFile(finalVideoPath);
    const webmKey = `podcasts/${podcastId}/avatars/${speaker}-avatar.webm`;
    const videoUrl = await uploadFile(webmKey, webmBuffer, 'video/webm');

    // Clean up chunk files from R2
    for (let i = 0; i < chunks.length; i++) {
      const chunkKey = `podcasts/${podcastId}/avatars/${speaker}-chunk-${i}.webm`;
      await deleteFile(chunkKey).catch(() => {});
    }

    // Update overlay as ready with rounded mask, clear chunk preview fields
    await prisma.avatarOverlay.update({
      where: { id: avatarOverlayId },
      data: { videoUrl, status: 'ready', maskShape: 'rounded', chunkVideoUrl: null, chunkDurationSeconds: null },
    });

    logUsage({
      service: 'runway',
      category: 'avatar_generation',
      totalCost: (durationSeconds / 60) * 0.10,
      podcastId,
      durationMs: Math.round(durationSeconds * 1000),
      metadata: { speaker, avatarId, durationSeconds, chunks: chunks.length },
    });

    await job.updateProgress(95);

    await checkAllAvatarsReady(videoGenerationId, podcastId);

    await job.updateProgress(100);
    logger.info('Runway avatar generation complete', { podcastId, speaker, avatarOverlayId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.avatarOverlay.update({
      where: { id: avatarOverlayId },
      data: { status: 'failed', failureReason: message },
    });

    await checkAllAvatarsReady(videoGenerationId, podcastId);

    if (isNonRetryableRunwayError(err)) {
      logger.error('Non-retryable Runway error, stopping retries', { message, avatarOverlayId });
      throw new UnrecoverableError(message);
    }

    throw err;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Shared ──

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
    await prisma.videoGeneration.update({
      where: { id: videoGenerationId },
      data: { status: 'READY' },
    });
    return;
  }

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
