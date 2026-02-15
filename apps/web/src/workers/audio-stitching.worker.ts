import { Job } from 'bullmq';
import {
  StitchAudioPayload,
  addJob,
  JobType,
  notificationQueue,
  twitterReplyQueue,
} from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { markPodcastFailed } from '@/lib/pipeline-resume';
import { downloadFile, uploadPodcastAudio } from '@/lib/r2';
import { stitchWithEffects, type SfxInsert } from '@/lib/audio-stitcher';
import { generateSoundEffect } from '@/lib/elevenlabs';
import { LIMITS } from '@/lib/stripe';
import { type SoundCue } from '@/lib/script-generator';
import { logger } from '@/lib/logger';

import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { writeFile, mkdir, rm } from 'fs/promises';

/** Map SoundCue types to stock SFX filenames bundled in the app */
const STOCK_SFX: Record<SoundCue['type'], string> = {
  intro: 'intro-warm.mp3',
  transition: 'transition-whoosh.mp3',
  outro: 'outro-gentle.mp3',
  ambient: 'ambient-soft.mp3',
};

export async function processAudioStitching(job: Job<StitchAudioPayload>): Promise<void> {
  const { podcastId, segmentIds, skipSfx } = job.data;
  const tmpDir = path.join(os.tmpdir(), `sotto-stitch-${crypto.randomUUID()}`);

  logger.info('Stitching audio', { podcastId, segmentCount: String(segmentIds.length) });
  await job.updateProgress(5);

  try {
    await mkdir(tmpDir, { recursive: true });

    // 1. Fetch ordered segments from database
    const segments = await prisma.segment.findMany({
      where: { id: { in: segmentIds } },
      orderBy: { order: 'asc' },
    });

    if (segments.length === 0) {
      throw new Error(`No segments found for podcast ${podcastId}`);
    }

    // 2. Fetch the script for sound cues
    const script = await prisma.script.findUnique({
      where: { podcastId },
      select: { soundCues: true },
    });

    const soundCues = (script?.soundCues ?? []) as SoundCue[];

    // 3. Load podcast metadata
    const podcast = await prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { userId: true, title: true, source: true, sourceTweetId: true },
    });
    const usePremiumSfx = LIMITS.hasPremiumSfx;

    await job.updateProgress(10);

    // 4. Download segment audio files from R2 to temp directory
    const segmentPaths: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg.audioUrl) {
        throw new Error(`Segment ${seg.id} (order ${seg.order}) has no audioUrl`);
      }

      const segPath = path.join(tmpDir, `seg-${String(i).padStart(3, '0')}.mp3`);
      const audioBuffer = await downloadFile(seg.audioUrl);
      await writeFile(segPath, audioBuffer);
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
      logger.info('Skipping SFX (re-stitch after incorporation)', { podcastId });
    }
    for (let i = 0; !skipSfx && i < soundCues.length; i++) {
      const cue = soundCues[i];
      const sfxPath = path.join(tmpDir, `sfx-${i}.mp3`);

      if (usePremiumSfx) {
        // Creator tier: generate custom SFX via ElevenLabs
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
        // Free/Pro tier: use bundled stock SFX (zero marginal cost)
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
      });

      // Update progress: SFX generation is 50-65%
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

    // 7. Post-stitch duration hard check
    const maxDurationSeconds = LIMITS.maxDurationMinutes * 60 * 1.1; // 10% grace
    if (duration > maxDurationSeconds) {
      await markPodcastFailed(podcastId);

      await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
        userId: podcast.userId,
        type: 'PODCAST_READY',
        title: 'Podcast generation failed',
        message: `"${podcast.title}" exceeded the ${LIMITS.maxDurationMinutes}-minute duration limit (${Math.round(duration / 60)} minutes). Please try with a shorter duration target.`,
        data: { podcastId },
      });

      logger.error('Podcast exceeded duration limit', {
        podcastId,
        durationSeconds: String(Math.round(duration)),
        maxSeconds: String(Math.round(maxDurationSeconds)),
      });

      await job.updateProgress(100);
      return;
    }

    // 8. Read final audio and upload to R2
    const { readFile } = await import('fs/promises');
    const finalAudio = await readFile(outputPath);
    const audioUrl = await uploadPodcastAudio(podcastId, finalAudio);

    await job.updateProgress(90);

    // 9. Create version snapshot before updating podcast record
    const currentPodcast = await prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { currentVersion: true, audioUrl: true },
    });

    const newVersion = currentPodcast.currentVersion + (currentPodcast.audioUrl ? 1 : 0);
    const changeType = currentPodcast.audioUrl
      ? skipSfx
        ? 'incorporation'
        : 'regeneration'
      : 'initial';

    await prisma.podcastVersion.create({
      data: {
        podcastId,
        version: newVersion,
        audioUrl,
        duration: Math.round(duration),
        changeType,
      },
    });

    // Update podcast record
    await prisma.podcast.update({
      where: { id: podcastId },
      data: {
        status: 'READY',
        audioUrl,
        duration: Math.round(duration),
        fileSize: finalAudio.length,
        currentVersion: newVersion,
      },
    });

    // 9. Update segment start times based on actual durations from FFprobe
    // Re-fetch segments to get the latest duration values written by audio-generation worker
    const freshSegments = await prisma.segment.findMany({
      where: { id: { in: segmentIds } },
      orderBy: { order: 'asc' },
      select: { id: true, duration: true },
    });
    let cumulativeTime = 0;
    for (const seg of freshSegments) {
      await prisma.segment.update({
        where: { id: seg.id },
        data: { startTime: cumulativeTime },
      });
      cumulativeTime += seg.duration ?? 0;
    }

    await job.updateProgress(95);

    // 10. Send notification
    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId: podcast.userId,
      type: 'PODCAST_READY',
      title: 'Your podcast is ready!',
      message: `"${podcast.title}" is ready to play.`,
      data: { podcastId },
    });

    // 11. If generated from Twitter, queue a reply to the original tweet
    if (podcast.source === 'TWITTER' && podcast.sourceTweetId) {
      const mention = await prisma.tweetMention.findFirst({
        where: { podcastId, status: { in: ['GENERATING'] } },
        select: { id: true, tweetId: true },
      });
      if (mention) {
        await addJob(twitterReplyQueue, JobType.REPLY_TWITTER, {
          podcastId,
          tweetMentionId: mention.id,
          originalTweetId: mention.tweetId,
        });
        await prisma.tweetMention.update({
          where: { id: mention.id },
          data: { status: 'READY' },
        });
      }
    }

    await job.updateProgress(100);
    logger.info('Audio stitching complete', {
      podcastId,
      duration: String(Math.round(duration)),
      fileSize: String(finalAudio.length),
      sfxCount: String(sfxInserts.length),
      premiumSfx: String(usePremiumSfx),
    });
  } catch (err) {
    // Mark podcast as failed on unrecoverable error
    await markPodcastFailed(podcastId).catch(() => {});

    // If Twitter-sourced, queue failure reply
    if (job.data.podcastId) {
      const mention = await prisma.tweetMention
        .findFirst({
          where: { podcastId: job.data.podcastId, status: { in: ['GENERATING', 'READY'] } },
          select: { id: true, tweetId: true },
        })
        .catch(() => null);
      if (mention) {
        await addJob(twitterReplyQueue, JobType.REPLY_TWITTER, {
          podcastId: job.data.podcastId,
          tweetMentionId: mention.id,
          originalTweetId: mention.tweetId,
        }).catch(() => {});
      }
    }

    throw err;
  } finally {
    // 11. Clean up temp directory
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
