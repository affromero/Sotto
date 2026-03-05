import { Job } from 'bullmq';
import { StitchVoiceTrackPayload, addJob, JobType, notificationQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { downloadToFile, uploadVoiceTrackAudio } from '@/lib/r2';
import { stitchWithEffects, type SfxInsert } from '@/lib/audio-stitcher';
import { type SoundCue } from '@/lib/script-generator';
import { consumeFreeGeneration } from '@/lib/generation-gate';
import { hasByokKey } from '@/lib/byok';
import { logger } from '@/lib/logger';

import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { mkdir, rm } from 'fs/promises';

/** Map SoundCue types to stock SFX filenames bundled in the app */
const STOCK_SFX: Record<SoundCue['type'], string> = {
  intro: 'intro-warm.mp3',
  transition: 'transition-whoosh.mp3',
  outro: 'outro-gentle.mp3',
  ambient: 'ambient-soft.mp3',
};

export async function processVoiceTrackStitching(job: Job<StitchVoiceTrackPayload>): Promise<void> {
  const { podcastId, voiceTrackId, voiceTrackSegmentIds } = job.data;
  const tmpDir = path.join(os.tmpdir(), `sotto-vt-stitch-${crypto.randomUUID()}`);

  logger.info('Stitching voice track audio', {
    podcastId,
    voiceTrackId,
    segmentCount: String(voiceTrackSegmentIds.length),
  });
  await job.updateProgress(5);

  try {
    await mkdir(tmpDir, { recursive: true });

    // 1. Fetch ordered voice track segments
    const vtSegments = await prisma.voiceTrackSegment.findMany({
      where: { id: { in: voiceTrackSegmentIds } },
      orderBy: { order: 'asc' },
    });

    if (vtSegments.length === 0) {
      throw new Error(`No voice track segments found for voice track ${voiceTrackId}`);
    }

    // 2. Fetch the script for sound cues
    const script = await prisma.script.findUnique({
      where: { podcastId },
      select: { soundCues: true },
    });

    const soundCues = (script?.soundCues ?? []) as SoundCue[];

    // 3. Load podcast metadata for notification
    const podcast = await prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { userId: true, title: true },
    });

    const voiceTrack = await prisma.voiceTrack.findUniqueOrThrow({
      where: { id: voiceTrackId },
      select: { name: true },
    });

    await job.updateProgress(10);

    // 4. Download voice track segment audio files from R2 to temp directory
    const segmentPaths: string[] = [];
    for (let i = 0; i < vtSegments.length; i++) {
      const seg = vtSegments[i];
      if (!seg.audioUrl) {
        throw new Error(`Voice track segment ${seg.id} (order ${seg.order}) has no audioUrl`);
      }

      const segPath = path.join(tmpDir, `seg-${String(i).padStart(3, '0')}.mp3`);
      await downloadToFile(seg.audioUrl, segPath);
      segmentPaths.push(segPath);

      const downloadProgress = 10 + Math.round((i / vtSegments.length) * 40);
      await job.updateProgress(downloadProgress);
    }

    await job.updateProgress(50);

    // 4b. Build cumulative duration map for SFX delay computation
    const cumulativeDurations: number[] = [];
    let cumDur = 0;
    for (const seg of vtSegments) {
      cumDur += (seg.duration ?? 0) * 1000; // convert to ms
      cumulativeDurations.push(cumDur);
    }

    // 5. Load SFX files (stock only for voice tracks)
    const sfxInserts: SfxInsert[] = [];
    for (let i = 0; i < soundCues.length; i++) {
      const cue = soundCues[i];
      const sfxPath = path.join(tmpDir, `sfx-${i}.mp3`);

      // Voice tracks always use stock SFX (no premium SFX generation)
      const stockFile = STOCK_SFX[cue.type];
      if (stockFile) {
        const stockPath = path.resolve(__dirname, '..', 'assets', 'sfx', stockFile);
        const { copyFile } = await import('fs/promises');
        await copyFile(stockPath, sfxPath);
      }

      const insertIdx = Math.min(cue.insertAfterTurn, cumulativeDurations.length - 1);
      const delayMs = insertIdx >= 0 ? Math.round(cumulativeDurations[insertIdx] ?? 0) : 0;

      sfxInserts.push({
        path: sfxPath,
        insertAfterSegment: cue.insertAfterTurn,
        durationMs: cue.durationSeconds * 1000,
        delayMs,
        type: cue.type,
      });

      const sfxProgress = 50 + Math.round((i / soundCues.length) * 15);
      await job.updateProgress(sfxProgress);
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

    // 7. Read final audio and upload to R2
    const { readFile } = await import('fs/promises');
    const finalAudio = await readFile(outputPath);
    const audioUrl = await uploadVoiceTrackAudio(podcastId, voiceTrackId, finalAudio);

    await job.updateProgress(90);

    // 8. Compute per-segment startTimes
    const freshSegments = await prisma.voiceTrackSegment.findMany({
      where: { id: { in: voiceTrackSegmentIds } },
      orderBy: { order: 'asc' },
      select: { id: true, duration: true },
    });
    let cumulativeTime = 0;
    for (const seg of freshSegments) {
      await prisma.voiceTrackSegment.update({
        where: { id: seg.id },
        data: { startTime: cumulativeTime },
      });
      cumulativeTime += seg.duration ?? 0;
    }

    // 9. Update voice track record
    await prisma.voiceTrack.update({
      where: { id: voiceTrackId },
      data: {
        status: 'READY',
        audioUrl,
        duration: Math.round(duration),
        fileSize: finalAudio.length,
      },
    });

    await job.updateProgress(95);

    // 10. Consume free-tier quota on successful voice track generation
    const podcastUser = await prisma.user.findUniqueOrThrow({
      where: { id: podcast.userId },
      select: { role: true, plan: true },
    });
    const isByok = await hasByokKey(podcast.userId);
    const isPrivileged = podcastUser.role === 'ADMIN' || podcastUser.role === 'SYSTEM';
    if (!isByok && podcastUser.plan !== 'PRO' && !isPrivileged) {
      await consumeFreeGeneration(podcast.userId).catch((err) => {
        logger.warn('Failed to consume free generation for voice track', {
          podcastId,
          voiceTrackId,
          userId: podcast.userId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // 11. Send notification
    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId: podcast.userId,
      type: 'VOICE_TRACK_READY',
      title: 'Voice Track Ready',
      message: `Voice track "${voiceTrack.name}" for "${podcast.title}" is ready to play.`,
      data: { podcastId, voiceTrackId },
    });

    await job.updateProgress(100);
    logger.info('Voice track stitching complete', {
      podcastId,
      voiceTrackId,
      duration: String(Math.round(duration)),
      fileSize: String(finalAudio.length),
    });
  } catch (err) {
    // Mark voice track as failed on unrecoverable error
    await prisma.voiceTrack.update({
      where: { id: voiceTrackId },
      data: {
        status: 'FAILED',
        failureReason: err instanceof Error ? err.message : String(err),
      },
    }).catch(() => {});

    throw err;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
