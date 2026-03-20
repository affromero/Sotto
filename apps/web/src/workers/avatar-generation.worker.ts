import { type Job, UnrecoverableError } from 'bullmq';
import type { GenerateAvatarPayload } from '@/lib/queue';
import { addJob, JobType, videoCompositionQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { logUsage } from '@/lib/usage-logger';
import { submitAvatarVideo, pollAvatarVideo, isNonRetryableHeyGenError } from '@/lib/heygen';
import { isNonRetryableRunwayError } from '@/lib/runway';
import { concatenateSpeakerAudio } from '@/lib/avatar-audio-concat';

/**
 * Fetch segments for avatar audio concatenation.
 * When voiceTrackId is set, reads from VoiceTrackSegment (alternate audio).
 * Otherwise reads from the main Segment table (default behavior).
 */
async function fetchAvatarSegments(opts: {
  podcastId: string;
  speaker: string;
  voiceTrackId?: string;
  enabledSegmentIds: string[];
}): Promise<Array<{ id: string; order: number; audioUrl: string | null }>> {
  if (opts.voiceTrackId) {
    const vtSegments = await prisma.voiceTrackSegment.findMany({
      where: {
        voiceTrackId: opts.voiceTrackId,
        segment: { podcastId: opts.podcastId, speaker: opts.speaker },
      },
      orderBy: { order: 'asc' },
      select: { id: true, segmentId: true, order: true, audioUrl: true },
    });

    if (vtSegments.length === 0) {
      throw new Error(`No voice track segments found for speaker "${opts.speaker}"`);
    }

    const enabled = opts.enabledSegmentIds;
    const filtered = enabled.length > 0
      ? vtSegments.filter((s) => enabled.includes(s.segmentId))
      : vtSegments;

    return filtered.map((s) => ({ id: s.segmentId, order: s.order, audioUrl: s.audioUrl }));
  }

  const segments = await prisma.segment.findMany({
    where: { podcastId: opts.podcastId, speaker: opts.speaker },
    orderBy: { order: 'asc' },
    select: { id: true, order: true, audioUrl: true },
  });

  if (segments.length === 0) {
    throw new Error(`No segments found for speaker "${opts.speaker}"`);
  }

  const enabled = opts.enabledSegmentIds;
  return enabled.length > 0
    ? segments.filter((s) => enabled.includes(s.id))
    : segments;
}

export async function processAvatarGeneration(job: Job<GenerateAvatarPayload>): Promise<void> {
  const provider = job.data.avatarProvider ?? 'heygen';
  if (provider === 'fal') {
    return processFalLipSync(job);
  }
  if (provider === 'replicate') {
    return processReplicateLipSync(job);
  }
  if (provider === 'runway') {
    return processRunwayAvatar(job);
  }
  return processHeyGenAvatar(job);
}

// ── HeyGen path (existing logic, extracted verbatim) ──

async function processHeyGenAvatar(job: Job<GenerateAvatarPayload>): Promise<void> {
  const { podcastId, videoGenerationId, avatarOverlayId, speaker, avatarId, voiceTrackId } = job.data;

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

      const segments = await fetchAvatarSegments({
        podcastId, speaker, voiceTrackId, enabledSegmentIds: overlay.enabledSegmentIds,
      });

      const segmentsWithAudio = segments.filter((s) => s.audioUrl);
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
      const concatAudioKey = `podcasts/${podcastId}/avatars/${videoGenerationId}/${avatarOverlayId}/audio.mp3`;
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
    const webmKey = `podcasts/${podcastId}/avatars/${videoGenerationId}/${avatarOverlayId}/video.webm`;
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

// ── Fal lip-sync path (VEED Fabric / Kling Avatar) ──

async function processFalLipSync(job: Job<GenerateAvatarPayload>): Promise<void> {
  const { podcastId, videoGenerationId, avatarOverlayId, speaker, voiceTrackId, avatarImageUrl, avatarModelId } = job.data;

  logger.info('Starting Fal lip-sync avatar generation', { podcastId, speaker, avatarModelId });

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

  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error('FAL_KEY is not configured');
  }

  if (!avatarImageUrl) {
    throw new Error('avatarImageUrl is required for fal lip-sync');
  }

  const modelId = avatarModelId ?? 'fal-veed-fabric-1.0';

  const { mkdtemp, readFile, rm } = await import('fs/promises');
  const { join } = await import('path');
  const { tmpdir } = await import('os');

  const tmpDir = await mkdtemp(join(tmpdir(), 'fal-lipsync-'));

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

      const segments = await fetchAvatarSegments({
        podcastId, speaker, voiceTrackId, enabledSegmentIds: overlay.enabledSegmentIds,
      });

      const segmentsWithAudio = segments.filter((s) => s.audioUrl);
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
      const concatAudioKey = `podcasts/${podcastId}/avatars/${videoGenerationId}/${avatarOverlayId}/audio.mp3`;
      concatAudioUrl = await uploadFile(concatAudioKey, concatAudioBuffer, 'audio/mpeg');

      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { concatAudioUrl, durationSeconds, status: 'processing' },
      });

      await job.updateProgress(10);
    }

    // Optional: trim audio for quick test runs (set testMaxSeconds in job data)
    const testMaxSeconds = (job.data as Record<string, unknown>).testMaxSeconds as number | undefined;
    if (testMaxSeconds && durationSeconds > testMaxSeconds) {
      const { execSync } = await import('child_process');
      const trimmedPath = join(tmpDir, 'trimmed.mp3');
      execSync(`ffmpeg -i "${join(tmpDir, `${speaker}-concat.mp3`)}" -t ${testMaxSeconds} -y "${trimmedPath}" 2>/dev/null`);
      // Re-upload trimmed audio
      const trimmedBuffer = await readFile(trimmedPath);
      const trimmedKey = `podcasts/${podcastId}/avatars/${videoGenerationId}/${avatarOverlayId}/audio-test.mp3`;
      concatAudioUrl = await uploadFile(trimmedKey, trimmedBuffer, 'audio/mpeg');
      durationSeconds = testMaxSeconds;
      logger.info('Trimmed audio for test', { avatarOverlayId, testMaxSeconds });
    }

    // Checkpoint 2: Determine chunking based on model limits
    const { LIP_SYNC_CONFIG } = await import('@/lib/providers/fal-endpoints');
    const lipSyncConfig = LIP_SYNC_CONFIG[modelId];
    const maxAudioSeconds = lipSyncConfig?.maxAudioSeconds ?? 300;
    const defaultPrompt = lipSyncConfig?.defaultPrompt;

    const { submitFalLipSync, pollFalLipSync } = await import('@/lib/fal-lip-sync');

    if (durationSeconds <= maxAudioSeconds) {
      // Single submission — no chunking needed
      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { falTotalChunks: 1, avatarModelId: modelId, avatarImageUrl },
      });

      const { statusUrl, resultUrl } = await submitFalLipSync({
        modelId,
        imageUrl: avatarImageUrl,
        audioUrl: concatAudioUrl,
        apiKey,
        prompt: defaultPrompt,
      });

      await job.updateProgress(30);

      // Premium models (Kling) take longer — use generous timeout
      const timeoutMs = durationSeconds * 10_000 + 300_000;
      const result = await pollFalLipSync(statusUrl, resultUrl, apiKey, timeoutMs);

      await job.updateProgress(80);

      // Download and upload to R2
      const videoRes = await fetch(result.videoUrl);
      if (!videoRes.ok) throw new Error(`Failed to download fal lip-sync video: ${videoRes.status}`);
      const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
      const videoKey = `podcasts/${podcastId}/avatars/${videoGenerationId}/${avatarOverlayId}/video.mp4`;
      const videoUrl = await uploadFile(videoKey, videoBuffer, 'video/mp4');

      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { videoUrl, status: 'ready', durationSeconds, falChunkIndex: 1 },
      });
    } else {
      // Multi-chunk: split audio and process each chunk
      const { splitAudioIntoChunks, concatenateVideoChunks } = await import('@/lib/runway-chunker');

      const localAudioPath = join(tmpDir, 'concat-audio.mp3');
      const audioRes = await fetch(concatAudioUrl);
      if (!audioRes.ok) throw new Error(`Failed to download concat audio: ${audioRes.status}`);
      const { writeFile } = await import('fs/promises');
      await writeFile(localAudioPath, Buffer.from(await audioRes.arrayBuffer()));

      const chunks = await splitAudioIntoChunks({
        audioPath: localAudioPath,
        totalDuration: durationSeconds,
        tmpDir,
        chunkTargetSeconds: Math.floor(maxAudioSeconds * 0.9),
      });

      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { falTotalChunks: chunks.length, avatarModelId: modelId, avatarImageUrl },
      });

      await job.updateProgress(15);

      const startChunkIndex = overlay.falChunkIndex ?? 0;

      for (let i = startChunkIndex; i < chunks.length; i++) {
        const chunk = chunks[i];

        // Upload chunk audio to R2 for fal to access
        const chunkAudioBuffer = await readFile(chunk.inputPath);
        const chunkAudioKey = `podcasts/${podcastId}/avatars/${videoGenerationId}/${avatarOverlayId}/chunk-audio-${i}.mp3`;
        const chunkAudioUrl = await uploadFile(chunkAudioKey, chunkAudioBuffer, 'audio/mpeg');

        const { statusUrl, resultUrl } = await submitFalLipSync({
          modelId,
          imageUrl: avatarImageUrl,
          audioUrl: chunkAudioUrl,
          apiKey,
          prompt: defaultPrompt,
        });

        const timeoutMs = chunk.durationSeconds * 3000 + 120_000;
        const result = await pollFalLipSync(statusUrl, resultUrl, apiKey, timeoutMs);

        // Download chunk video to tmpDir
        const chunkVideoRes = await fetch(result.videoUrl);
        if (!chunkVideoRes.ok) throw new Error(`Failed to download fal chunk video ${i}: ${chunkVideoRes.status}`);
        // Override outputPath extension to mp4 for fal
        chunk.outputPath = chunk.outputPath.replace(/\.webm$/, '.mp4');
        await writeFile(chunk.outputPath, Buffer.from(await chunkVideoRes.arrayBuffer()));

        await prisma.avatarOverlay.update({
          where: { id: avatarOverlayId },
          data: { falChunkIndex: i + 1 },
        });

        const chunkProgress = 15 + ((i + 1) / chunks.length) * 55;
        await job.updateProgress(Math.round(chunkProgress));
      }

      await job.updateProgress(75);

      // Concatenate video chunks
      const finalVideoPath = join(tmpDir, 'final.mp4');
      await concatenateVideoChunks({ chunks, outputPath: finalVideoPath });

      await job.updateProgress(85);

      const finalBuffer = await readFile(finalVideoPath);
      const videoKey = `podcasts/${podcastId}/avatars/${videoGenerationId}/${avatarOverlayId}/video.mp4`;
      const videoUrl = await uploadFile(videoKey, finalBuffer, 'video/mp4');

      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { videoUrl, status: 'ready', durationSeconds },
      });
    }

    logUsage({
      service: 'fal',
      category: 'avatar_generation',
      totalCost: (durationSeconds / 60) * (LIP_SYNC_CONFIG[modelId]?.maxAudioSeconds === 60 ? 0.168 : 4.80),
      podcastId,
      durationMs: Math.round(durationSeconds * 1000),
      metadata: { speaker, modelId, durationSeconds },
    });

    await job.updateProgress(95);

    await checkAllAvatarsReady(videoGenerationId, podcastId);

    await job.updateProgress(100);
    logger.info('Fal lip-sync avatar generation complete', { podcastId, speaker, avatarOverlayId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.avatarOverlay.update({
      where: { id: avatarOverlayId },
      data: { status: 'failed', failureReason: message },
    });

    await checkAllAvatarsReady(videoGenerationId, podcastId);

    throw err;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Replicate lip-sync path (Wav2Lip / SadTalker / VEED Fabric) ──

async function processReplicateLipSync(job: Job<GenerateAvatarPayload>): Promise<void> {
  const { podcastId, videoGenerationId, avatarOverlayId, speaker, voiceTrackId, avatarImageUrl, avatarModelId } = job.data;

  logger.info('Starting Replicate lip-sync avatar generation', { podcastId, speaker, avatarModelId });

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

  const apiKey = process.env.REPLICATE_API_TOKEN;
  if (!apiKey) {
    throw new Error('REPLICATE_API_TOKEN is not configured');
  }

  if (!avatarImageUrl) {
    throw new Error('avatarImageUrl is required for Replicate lip-sync');
  }

  const modelId = avatarModelId ?? 'replicate-wav2lip';

  const { mkdtemp, readFile, rm } = await import('fs/promises');
  const { join } = await import('path');
  const { tmpdir } = await import('os');

  const tmpDir = await mkdtemp(join(tmpdir(), 'replicate-lipsync-'));

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

      const segments = await fetchAvatarSegments({
        podcastId, speaker, voiceTrackId, enabledSegmentIds: overlay.enabledSegmentIds,
      });

      const segmentsWithAudio = segments.filter((s) => s.audioUrl);
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
      const concatAudioKey = `podcasts/${podcastId}/avatars/${videoGenerationId}/${avatarOverlayId}/audio.mp3`;
      concatAudioUrl = await uploadFile(concatAudioKey, concatAudioBuffer, 'audio/mpeg');

      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { concatAudioUrl, durationSeconds, status: 'processing' },
      });

      await job.updateProgress(10);
    }

    // Checkpoint 2: Determine chunking based on model limits
    const { REPLICATE_LIP_SYNC_CONFIG, submitReplicateLipSync, pollReplicateLipSync } = await import('@/lib/replicate-lip-sync');
    const lipSyncConfig = REPLICATE_LIP_SYNC_CONFIG[modelId];
    const maxAudioSeconds = lipSyncConfig?.maxAudioSeconds ?? 120;

    if (durationSeconds <= maxAudioSeconds) {
      // Single submission — no chunking needed
      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { falTotalChunks: 1, avatarModelId: modelId, avatarImageUrl },
      });

      const { predictionId } = await submitReplicateLipSync({
        modelId,
        imageUrl: avatarImageUrl,
        audioUrl: concatAudioUrl,
        apiKey,
      });

      await job.updateProgress(30);

      const timeoutMs = durationSeconds * 5000 + 120_000;
      const result = await pollReplicateLipSync(predictionId, apiKey, timeoutMs);

      await job.updateProgress(80);

      // Download and upload to R2
      const videoRes = await fetch(result.videoUrl);
      if (!videoRes.ok) throw new Error(`Failed to download Replicate lip-sync video: ${videoRes.status}`);
      const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
      const videoKey = `podcasts/${podcastId}/avatars/${videoGenerationId}/${avatarOverlayId}/video.mp4`;
      const videoUrl = await uploadFile(videoKey, videoBuffer, 'video/mp4');

      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { videoUrl, status: 'ready', durationSeconds, falChunkIndex: 1 },
      });
    } else {
      // Multi-chunk: split audio and process each chunk
      const { splitAudioIntoChunks, concatenateVideoChunks } = await import('@/lib/runway-chunker');

      const localAudioPath = join(tmpDir, 'concat-audio.mp3');
      const audioRes = await fetch(concatAudioUrl);
      if (!audioRes.ok) throw new Error(`Failed to download concat audio: ${audioRes.status}`);
      const { writeFile } = await import('fs/promises');
      await writeFile(localAudioPath, Buffer.from(await audioRes.arrayBuffer()));

      const chunks = await splitAudioIntoChunks({
        audioPath: localAudioPath,
        totalDuration: durationSeconds,
        tmpDir,
        chunkTargetSeconds: Math.floor(maxAudioSeconds * 0.9),
      });

      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { falTotalChunks: chunks.length, avatarModelId: modelId, avatarImageUrl },
      });

      await job.updateProgress(15);

      const startChunkIndex = overlay.falChunkIndex ?? 0;

      for (let i = startChunkIndex; i < chunks.length; i++) {
        const chunk = chunks[i];

        // Upload chunk audio to R2 for Replicate to access
        const chunkAudioBuffer = await readFile(chunk.inputPath);
        const chunkAudioKey = `podcasts/${podcastId}/avatars/${videoGenerationId}/${avatarOverlayId}/chunk-audio-${i}.mp3`;
        const chunkAudioUrl = await uploadFile(chunkAudioKey, chunkAudioBuffer, 'audio/mpeg');

        const { predictionId } = await submitReplicateLipSync({
          modelId,
          imageUrl: avatarImageUrl,
          audioUrl: chunkAudioUrl,
          apiKey,
        });

        const timeoutMs = chunk.durationSeconds * 5000 + 120_000;
        const result = await pollReplicateLipSync(predictionId, apiKey, timeoutMs);

        // Download chunk video to tmpDir
        const chunkVideoRes = await fetch(result.videoUrl);
        if (!chunkVideoRes.ok) throw new Error(`Failed to download Replicate chunk video ${i}: ${chunkVideoRes.status}`);
        chunk.outputPath = chunk.outputPath.replace(/\.webm$/, '.mp4');
        await writeFile(chunk.outputPath, Buffer.from(await chunkVideoRes.arrayBuffer()));

        await prisma.avatarOverlay.update({
          where: { id: avatarOverlayId },
          data: { falChunkIndex: i + 1 },
        });

        const chunkProgress = 15 + ((i + 1) / chunks.length) * 55;
        await job.updateProgress(Math.round(chunkProgress));
      }

      await job.updateProgress(75);

      // Concatenate video chunks
      const finalVideoPath = join(tmpDir, 'final.mp4');
      await concatenateVideoChunks({ chunks, outputPath: finalVideoPath });

      await job.updateProgress(85);

      const finalBuffer = await readFile(finalVideoPath);
      const videoKey = `podcasts/${podcastId}/avatars/${videoGenerationId}/${avatarOverlayId}/video.mp4`;
      const videoUrl = await uploadFile(videoKey, finalBuffer, 'video/mp4');

      await prisma.avatarOverlay.update({
        where: { id: avatarOverlayId },
        data: { videoUrl, status: 'ready', durationSeconds },
      });
    }

    logUsage({
      service: 'replicate',
      category: 'avatar_generation',
      totalCost: (durationSeconds / 60) * (lipSyncConfig?.maxAudioSeconds === 60 ? 1.0 : 4.80),
      podcastId,
      durationMs: Math.round(durationSeconds * 1000),
      metadata: { speaker, modelId, durationSeconds },
    });

    await job.updateProgress(95);

    await checkAllAvatarsReady(videoGenerationId, podcastId);

    await job.updateProgress(100);
    logger.info('Replicate lip-sync avatar generation complete', { podcastId, speaker, avatarOverlayId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.avatarOverlay.update({
      where: { id: avatarOverlayId },
      data: { status: 'failed', failureReason: message },
    });

    await checkAllAvatarsReady(videoGenerationId, podcastId);

    throw err;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Runway path (realtime sessions via Playwright) ──

async function processRunwayAvatar(job: Job<GenerateAvatarPayload>): Promise<void> {
  const { podcastId, videoGenerationId, avatarOverlayId, speaker, avatarId, isPreset, voiceTrackId } = job.data;

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

      const segments = await fetchAvatarSegments({
        podcastId, speaker, voiceTrackId, enabledSegmentIds: overlay.enabledSegmentIds,
      });

      const segmentsWithAudio = segments.filter((s) => s.audioUrl);
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
      const concatAudioKey = `podcasts/${podcastId}/avatars/${videoGenerationId}/${avatarOverlayId}/audio.mp3`;
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
        const chunkR2Key = `podcasts/${podcastId}/avatars/${videoGenerationId}/${avatarOverlayId}/chunk-${i}.webm`;
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
    const webmKey = `podcasts/${podcastId}/avatars/${videoGenerationId}/${avatarOverlayId}/video.webm`;
    const videoUrl = await uploadFile(webmKey, webmBuffer, 'video/webm');

    // Chunk files kept in R2 — no deletion

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

  // All avatars ready — mark READY (avatars are overlays rendered client-side,
  // composition is only triggered explicitly by the user)
  await prisma.videoGeneration.update({
    where: { id: videoGenerationId },
    data: { status: 'READY' },
  });
}
