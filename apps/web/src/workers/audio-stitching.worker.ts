import { Job } from 'bullmq';
import {
  StitchAudioPayload,
  addJob,
  JobType,
  notificationQueue,
  pdfGenerationQueue,
  waveformGenerationQueue,
} from '@/lib/queue';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { markEpisodeFailed } from '@/lib/pipeline-resume';
import { downloadToFile, uploadEpisodeAudio } from '@/lib/r2';
import { stitchWithEffects, type SfxInsert } from '@/lib/audio-stitcher';
import { generateSoundEffect } from '@/lib/elevenlabs';
import { MAX_LESSON_DURATION_MINUTES } from '@/lib/generation-limits';
import { type SoundCue } from '@/lib/script-generator';
import { logger } from '@/lib/logger';
import { generateFingerprint } from '@/lib/audio-fingerprint';
import { verifyReferral } from '@/lib/referrals';

import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { writeFile, mkdir, rm } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Find where each segment's raw audio actually starts in the stitched output
 * by cross-correlating a short voiced snippet from each segment file against
 * the stitched audio. Returns an array of start times in seconds.
 */
async function detectSegmentBoundaries(
  stitchedPath: string,
  segmentPaths: string[],
): Promise<number[]> {
  if (segmentPaths.length === 0) return [];
  if (segmentPaths.length === 1) return [0];

  try {
  const { readFile } = await import('fs/promises');
  const SR = 16000;

  // Convert stitched audio to raw PCM for fast processing
  const stitchedPcmPath = stitchedPath + '.raw.wav';
  await execFileAsync('ffmpeg', ['-y', '-i', stitchedPath, '-ar', String(SR), '-ac', '1', stitchedPcmPath]);
  const stitchedBuf = await readFile(stitchedPcmPath);
  // Skip WAV header (44 bytes)
  const stitched = new Float32Array(stitchedBuf.length > 44 ? (stitchedBuf.length - 44) / 2 : 0);
  for (let i = 0; i < stitched.length; i++) {
    stitched[i] = stitchedBuf.readInt16LE(44 + i * 2);
  }

  const starts: number[] = [0]; // first segment always at 0
  let searchFrom = 0; // only search forward from last found position

  for (let seg = 1; seg < segmentPaths.length; seg++) {
    try {
      // Convert segment to same format
      const segPcmPath = segmentPaths[seg] + '.raw.wav';
      await execFileAsync('ffmpeg', ['-y', '-i', segmentPaths[seg], '-ar', String(SR), '-ac', '1', segPcmPath]);
      const segBuf = await readFile(segPcmPath);
      const segData = new Float32Array(segBuf.length > 44 ? (segBuf.length - 44) / 2 : 0);
      for (let i = 0; i < segData.length; i++) {
        segData[i] = segBuf.readInt16LE(44 + i * 2);
      }

      // Find voice onset in segment (first 320-sample window with RMS > 500)
      let onset = 0;
      for (let i = 0; i < segData.length - 320; i += 320) {
        let sum = 0;
        for (let j = i; j < i + 320; j++) sum += segData[j] * segData[j];
        if (Math.sqrt(sum / 320) > 500) { onset = i; break; }
      }

      // Take 1s of voiced content as search snippet
      const snippetLen = Math.min(SR, segData.length - onset);
      const snippet = segData.slice(onset, onset + snippetLen);

      // Normalize snippet
      let maxSnip = 0;
      for (let i = 0; i < snippet.length; i++) if (Math.abs(snippet[i]) > maxSnip) maxSnip = Math.abs(snippet[i]);
      if (maxSnip > 0) for (let i = 0; i < snippet.length; i++) snippet[i] /= maxSnip;

      // Search in stitched audio from last position ± 5s margin
      const windowStart = Math.max(0, searchFrom - 5 * SR);
      const windowEnd = Math.min(stitched.length, searchFrom + segData.length + 30 * SR);

      let bestCorr = -Infinity;
      let bestIdx = searchFrom;

      // Normalize search region
      let maxSearch = 0;
      for (let i = windowStart; i < windowEnd; i++) if (Math.abs(stitched[i]) > maxSearch) maxSearch = Math.abs(stitched[i]);

      // Slide snippet over search window (step by 160 samples = 10ms for speed)
      for (let pos = windowStart; pos < windowEnd - snippetLen; pos += 160) {
        let corr = 0;
        for (let j = 0; j < snippetLen; j++) {
          corr += (stitched[pos + j] / (maxSearch || 1)) * snippet[j];
        }
        if (corr > bestCorr) {
          bestCorr = corr;
          bestIdx = pos;
        }
      }

      // Actual start = match position minus onset offset
      const actualStart = (bestIdx - onset) / SR;
      starts.push(Math.max(0, actualStart));
      searchFrom = bestIdx + segData.length / 2; // advance search position

      // Cleanup temp file
      await rm(segPcmPath).catch(() => {});
    } catch {
      // Fallback: use previous start + previous segment duration estimate
      const prevStart = starts[starts.length - 1];
      starts.push(prevStart + 10); // rough fallback
    }
  }

  // Cleanup
  await rm(stitchedPcmPath).catch(() => {});

  logger.info('Segment boundaries detected via cross-correlation', {
    segmentCount: String(segmentPaths.length),
    starts: starts.map((s) => s.toFixed(3)).join(', '),
  });

  return starts;
  } catch (err) {
    logger.warn('Cross-correlation boundary detection failed, returning empty', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Map SoundCue types to stock SFX filenames bundled in the app */
const STOCK_SFX: Record<SoundCue['type'], string> = {
  intro: 'intro-warm.mp3',
  transition: 'transition-whoosh.mp3',
  outro: 'outro-gentle.mp3',
  ambient: 'ambient-soft.mp3',
  laugh_track: 'laugh-track.mp3',
  music_sting: 'music-sting.mp3',
  applause: 'applause.mp3',
  comedic_hit: 'comedic-hit.mp3',
  rim_shot: 'rim-shot.mp3',
};

export async function processAudioStitching(job: Job<StitchAudioPayload>): Promise<void> {
  const { episodeId, segmentIds, skipSfx } = job.data;
  const tmpDir = path.join(os.tmpdir(), `sotto-stitch-${crypto.randomUUID()}`);

  logger.info('Stitching audio', { episodeId, segmentCount: String(segmentIds.length) });
  await job.updateProgress(5);

  try {
    await mkdir(tmpDir, { recursive: true });

    // 1. Fetch ordered segments from database
    const segments = await prisma.segment.findMany({
      where: { id: { in: segmentIds } },
      orderBy: { order: 'asc' },
    });

    if (segments.length === 0) {
      throw new Error(`No segments found for episode ${episodeId}`);
    }

    // 2. Fetch the script for sound cues and turn text (for audience reactions)
    const script = await prisma.script.findUnique({
      where: { episodeId },
      select: { soundCues: true, turns: true },
    });

    const soundCues = (script?.soundCues ?? []) as SoundCue[];

    // 3. Load episode metadata
    const episode = await prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: { userId: true, title: true, source: true },
    });
    const usePremiumSfx = true;

    await job.updateProgress(10);

    // 4. Download segment audio files from R2 to temp directory
    const segmentPaths: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg.audioUrl) {
        throw new Error(`Segment ${seg.id} (order ${seg.order}) has no audioUrl`);
      }

      const segPath = path.join(tmpDir, `seg-${String(i).padStart(3, '0')}.mp3`);
      await downloadToFile(seg.audioUrl, segPath);
      segmentPaths.push(segPath);

      // Update progress: downloading is 10-50%
      const downloadProgress = 10 + Math.round((i / segments.length) * 40);
      await job.updateProgress(downloadProgress);
    }

    await job.updateProgress(50);

    // 4b. Build cumulative duration map for SFX delay computation
    const cumulativeDurations: number[] = [];
    let cumDur = 0;
    for (const seg of segments) {
      cumDur += (seg.duration ?? 0) * 1000; // convert to ms
      cumulativeDurations.push(cumDur);
    }

    // 5. Generate or load SFX files (skip when re-stitching after incorporation)
    const sfxInserts: SfxInsert[] = [];
    if (skipSfx) {
      logger.info('Skipping SFX (re-stitch after incorporation)', { episodeId });
    }
    for (let i = 0; !skipSfx && i < soundCues.length; i++) {
      const cue = soundCues[i];
      const sfxPath = path.join(tmpDir, `sfx-${i}.mp3`);

      if (usePremiumSfx) {
        // Premium SFX mode: generate custom SFX via ElevenLabs.
        try {
          const sfxBuffer = await generateSoundEffect({
            prompt: cue.prompt,
            durationSeconds: cue.durationSeconds,
          });
          await writeFile(sfxPath, sfxBuffer);
        } catch (err) {
          // Fall back to stock SFX if ElevenLabs fails
          logger.warn('Premium SFX generation failed, using stock', {
            prompt: cue.prompt,
            error: err instanceof Error ? err.message : String(err),
          });
          const stockFile = STOCK_SFX[cue.type];
          const stockPath = path.resolve(__dirname, '..', 'assets', 'sfx', stockFile);
          const { copyFile } = await import('fs/promises');
          await copyFile(stockPath, sfxPath);
        }
      } else {
        // Default mode: use bundled stock SFX.
        const stockFile = STOCK_SFX[cue.type];
        const stockPath = path.resolve(__dirname, '..', 'assets', 'sfx', stockFile);
        const { copyFile } = await import('fs/promises');
        await copyFile(stockPath, sfxPath);
      }

      // Compute delay from cumulative segment durations
      const insertIdx = Math.min(cue.insertAfterTurn, cumulativeDurations.length - 1);
      const delayMs = insertIdx >= 0 ? Math.round(cumulativeDurations[insertIdx] ?? 0) : 0;

      sfxInserts.push({
        path: sfxPath,
        insertAfterSegment: cue.insertAfterTurn,
        durationMs: cue.durationSeconds * 1000,
        delayMs,
        type: cue.type,
        volume: cue.volume,
        fadeOutMs: cue.fadeOutMs,
      });

      // Update progress: SFX generation is 50-65%
      const sfxProgress = 50 + Math.round((i / soundCues.length) * 15);
      await job.updateProgress(sfxProgress);
    }

    // 5b. Extract inline audience reactions from turn text and convert to SFX inserts
    if (!skipSfx) {
      const turns = (script?.turns ?? []) as Array<{ text: string }>;
      const { extractAudienceReactions } = await import('@/lib/tts-text-cleaner');

      for (let i = 0; i < turns.length && i < segments.length; i++) {
        const reactions = extractAudienceReactions(turns[i].text);
        for (const reaction of reactions) {
          const delayMs = Math.round(cumulativeDurations[i] ?? 0);
          const stockFile = STOCK_SFX[reaction.type];
          if (stockFile) {
            const reactionPath = path.join(tmpDir, `reaction-${i}-${reaction.type}.mp3`);
            const stockPath = path.resolve(__dirname, '..', 'assets', 'sfx', stockFile);
            const { copyFile } = await import('fs/promises');
            await copyFile(stockPath, reactionPath);
            sfxInserts.push({
              path: reactionPath,
              insertAfterSegment: i,
              durationMs: 2000,
              delayMs,
              type: reaction.type,
              volume: 0.3,
            });
          }
        }
      }
    }

    await job.updateProgress(65);

    // 6. Run FFmpeg stitching
    const outputPath = path.join(tmpDir, 'final.mp3');
    const { duration } = await stitchWithEffects({
      segmentPaths,
      sfxInserts,
      outputPath,
      crossfadeMs: 300,
    });

    await job.updateProgress(80);

    // 7. Post-stitch duration hard check
    const maxDurationSeconds = MAX_LESSON_DURATION_MINUTES * 60 * 1.1; // 10% grace
    if (duration > maxDurationSeconds) {
      await markEpisodeFailed(episodeId, {
        failureReason: `"${episode.title}" exceeded the ${MAX_LESSON_DURATION_MINUTES}-minute duration limit (${Math.round(duration / 60)} minutes). Please try with a shorter duration target.`,
        technicalError: `Duration ${Math.round(duration)}s exceeded max ${Math.round(maxDurationSeconds)}s`,
      });

      await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
        userId: episode.userId,
        type: 'EPISODE_FAILED',
        title: 'Lesson generation failed',
        message: `"${episode.title}" exceeded the ${MAX_LESSON_DURATION_MINUTES}-minute duration limit (${Math.round(duration / 60)} minutes). Please try with a shorter duration target.`,
        data: { episodeId },
      });

      logger.error('Episode exceeded duration limit', {
        episodeId,
        durationSeconds: String(Math.round(duration)),
        maxSeconds: String(Math.round(maxDurationSeconds)),
      });

      await job.updateProgress(100);
      return;
    }

    // 8. Read final audio and upload to R2
    const { readFile } = await import('fs/promises');
    const finalAudio = await readFile(outputPath);
    const audioUrl = await uploadEpisodeAudio(episodeId, finalAudio);

    // Store audio fingerprint for future duplicate detection
    try {
      const fp = await generateFingerprint(outputPath);
      await prisma.audioFingerprint.upsert({
        where: { episodeId },
        update: { fingerprint: fp.fingerprint, duration: fp.duration },
        create: { episodeId, fingerprint: fp.fingerprint, duration: fp.duration },
      });
    } catch (err) {
      logger.warn('Failed to store audio fingerprint', {
        episodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await job.updateProgress(90);

    // 9. Create version snapshot before updating episode record
    const currentEpisode = await prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: { currentVersion: true, audioUrl: true },
    });

    const newVersion = currentEpisode.currentVersion + (currentEpisode.audioUrl ? 1 : 0);
    const changeType = currentEpisode.audioUrl
      ? skipSfx
        ? 'incorporation'
        : 'regeneration'
      : 'initial';

    await prisma.episodeVersion.create({
      data: {
        episodeId,
        version: newVersion,
        audioUrl,
        duration: Math.round(duration),
        changeType,
      },
    });

    // Compute duration deviation from target
    const discovery = await prisma.discovery.findUnique({
      where: { episodeId },
      select: { durationTarget: true },
    });
    const durationDeviation = discovery?.durationTarget
      ? Math.round(duration) - discovery.durationTarget * 60
      : null;

    if (durationDeviation !== null) {
      logger.info('Duration deviation from target', {
        episodeId,
        actualSeconds: String(Math.round(duration)),
        targetSeconds: String(discovery!.durationTarget! * 60),
        deviationSeconds: String(durationDeviation),
      });
    }

    // Update episode record
    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        status: 'READY',
        audioUrl,
        duration: Math.round(duration),
        durationDeviation,
        fileSize: finalAudio.length,
        currentVersion: newVersion,
      },
    });
    await invalidateEpisodeCache(episodeId);
    await publishEpisodeStatus(episodeId, { status: 'READY' });

    // Record pipeline completion event for accurate timing metrics
    await prisma.pipelineEvent.create({
      data: {
        episodeId,
        stage: 'audio-stitching',
        type: 'complete',
        message: `Pipeline completed — ${Math.round(duration)}s of audio`,
      },
    });


    // 9. Update segment start times by detecting silence boundaries in the stitched audio
    // This gives exact positions regardless of crossfade/SFX/normalization
    const freshSegments = await prisma.segment.findMany({
      where: { id: { in: segmentIds } },
      orderBy: { order: 'asc' },
      select: { id: true, duration: true },
    });

    let detectedStarts = await detectSegmentBoundaries(outputPath, segmentPaths);

    // Validate monotonicity: each start must be >= previous + 50% of segment duration.
    // Cross-correlation can produce false matches for single-speaker episodes where
    // the voice is identical across segments.
    if (detectedStarts.length === freshSegments.length && detectedStarts.length > 1) {
      const isMonotonic = detectedStarts.every((start, i) => {
        if (i === 0) return true;
        const prevDuration = freshSegments[i - 1].duration ?? 0;
        const minGap = prevDuration * 0.5;
        return start >= detectedStarts[i - 1] + minGap;
      });
      if (!isMonotonic) {
        logger.warn('Cross-correlation starts failed monotonicity check, using cumulative fallback', { episodeId });
        detectedStarts = [];
      }
    }

    if (detectedStarts.length === 0 || detectedStarts.length !== freshSegments.length) {
      // Fallback: cumulative durations adjusted for crossfade overlap.
      // acrossfade=d=0.3 overlaps each pair of adjacent segments by 300ms,
      // so each segment starts 0.3s earlier than naive cumulative sum.
      const crossfadeSec = 0.3; // must match crossfadeMs: 300 in stitchWithEffects call
      let cum = 0;
      detectedStarts = freshSegments.map((seg) => {
        const t = cum;
        cum += (seg.duration ?? 0) - crossfadeSec;
        return t;
      });
    }
    for (let i = 0; i < freshSegments.length; i++) {
      await prisma.segment.update({
        where: { id: freshSegments[i].id },
        data: { startTime: detectedStarts[i] },
      });
    }

    // Note: segment audio files are NEVER deleted from R2 — they are needed by
    // avatar generation, voice tracks, and future provider-versioned audio.

    await job.updateProgress(95);

    // 10. Send notification
    const notificationType = 'EPISODE_READY';

    // Idempotency: skip if a notification for this episode+type already exists (stalled job retry)
    const existingNotif = await prisma.notification.findFirst({
      where: {
        userId: episode.userId,
        type: notificationType as never,
        data: { path: ['episodeId'], equals: episodeId },
      },
      select: { id: true },
    });

    if (!existingNotif) {
      await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
        userId: episode.userId,
        type: notificationType,
        title: 'Your lesson is ready!',
        message: `"${episode.title}" is ready to play.`,
        data: { episodeId },
      });
    } else {
      logger.info('Skipping duplicate notification (already exists)', { episodeId, notificationType });
    }

    // 10a. Verify referral (grants referrer bonus if this is the user's first READY episode)
    await verifyReferral(episode.userId).catch((err) => {
      logger.warn('Failed to verify referral', {
        userId: episode.userId,
        episodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // 10c. Auto-generate transcript
    await addJob(pdfGenerationQueue, JobType.GENERATE_PDF, {
      episodeId,
      userId: episode.userId,
    });

    // 10c2. Generate waveform visualization data
    await addJob(waveformGenerationQueue, JobType.GENERATE_WAVEFORM, {
      episodeId,
      userId: episode.userId,
    });

    await job.updateProgress(100);
    logger.info('Audio stitching complete', {
      episodeId,
      duration: String(Math.round(duration)),
      fileSize: String(finalAudio.length),
      sfxCount: String(sfxInserts.length),
      premiumSfx: String(usePremiumSfx),
    });
  } catch (err) {
    throw err;
  } finally {
    // 11. Clean up temp directory
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
