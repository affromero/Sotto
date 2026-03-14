import { Job } from 'bullmq';
import {
  StitchAudioPayload,
  addJob,
  JobType,
  notificationQueue,
  pdfGenerationQueue,
  featureComputationQueue,
  twitterReplyQueue,
  telegramReplyQueue,
  twitterAutoTweetQueue,
  visualClassificationQueue,
  waveformGenerationQueue,
  quizGenerationQueue,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { markPodcastFailed } from '@/lib/pipeline-resume';
import { downloadToFile, uploadPodcastAudio } from '@/lib/r2';
import { stitchWithEffects, type SfxInsert } from '@/lib/audio-stitcher';
import { generateSoundEffect } from '@/lib/elevenlabs';
import { LIMITS } from '@/lib/stripe';
import { type SoundCue } from '@/lib/script-generator';
import { logger } from '@/lib/logger';
import { capturePodcastPayments } from '@/lib/voice-pricing';
import { generateFingerprint } from '@/lib/audio-fingerprint';
import { verifyReferral } from '@/lib/referrals';
import { consumeFreeGeneration } from '@/lib/generation-gate';
import { hasByokKey } from '@/lib/byok';

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
      select: { userId: true, title: true, source: true, sourceTweetId: true,
                user: { select: { telegramEnabled: true, telegramChatId: true } } },
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
      await markPodcastFailed(podcastId, {
        failureReason: `"${podcast.title}" exceeded the ${LIMITS.maxDurationMinutes}-minute duration limit (${Math.round(duration / 60)} minutes). Please try with a shorter duration target.`,
        technicalError: `Duration ${Math.round(duration)}s exceeded max ${Math.round(maxDurationSeconds)}s`,
      });

      await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
        userId: podcast.userId,
        type: 'PODCAST_FAILED',
        title: 'Podcast generation failed',
        message: `"${podcast.title}" exceeded the ${LIMITS.maxDurationMinutes}-minute duration limit (${Math.round(duration / 60)} minutes). Please try with a shorter duration target.`,
        data: { podcastId },
      });

      logger.error('Podcast exceeded duration limit', {
        podcastId,
        durationSeconds: String(Math.round(duration)),
        maxSeconds: String(Math.round(maxDurationSeconds)),
      });

      // Queue Twitter failure reply for duration-exceeded
      if (podcast.source === 'TWITTER' && podcast.sourceTweetId) {
        const mention = await prisma.tweetMention.findFirst({
          where: { podcastId, status: { in: ['GENERATING', 'READY'] } },
          select: { id: true, tweetId: true },
        }).catch(() => null);
        if (mention) {
          await addJob(twitterReplyQueue, JobType.REPLY_TWITTER, {
            podcastId, tweetMentionId: mention.id, originalTweetId: mention.tweetId,
          }).catch(() => {});
        }
      }

      // Queue Telegram failure reply for duration-exceeded
      if (podcast.user.telegramEnabled && podcast.user.telegramChatId) {
        const tgMsg = await prisma.telegramMessage.findFirst({
          where: { podcastId, status: { in: ['GENERATING', 'READY'] } },
          select: { id: true, chatId: true },
        }).catch(() => null);
        await addJob(telegramReplyQueue, JobType.REPLY_TELEGRAM, {
          podcastId,
          telegramMessageId: tgMsg?.id,
          chatId: tgMsg?.chatId ?? podcast.user.telegramChatId,
        }).catch(() => {});
      }

      await job.updateProgress(100);
      return;
    }

    // 8. Read final audio and upload to R2
    const { readFile } = await import('fs/promises');
    const finalAudio = await readFile(outputPath);
    const audioUrl = await uploadPodcastAudio(podcastId, finalAudio);

    // Store audio fingerprint for future duplicate detection
    try {
      const fp = await generateFingerprint(outputPath);
      await prisma.audioFingerprint.upsert({
        where: { podcastId },
        update: { fingerprint: fp.fingerprint, duration: fp.duration },
        create: { podcastId, fingerprint: fp.fingerprint, duration: fp.duration },
      });
    } catch (err) {
      logger.warn('Failed to store audio fingerprint', {
        podcastId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

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

    // Compute duration deviation from target
    const discovery = await prisma.discovery.findUnique({
      where: { podcastId },
      select: { durationTarget: true },
    });
    const durationDeviation = discovery?.durationTarget
      ? Math.round(duration) - discovery.durationTarget * 60
      : null;

    if (durationDeviation !== null) {
      logger.info('Duration deviation from target', {
        podcastId,
        actualSeconds: String(Math.round(duration)),
        targetSeconds: String(discovery!.durationTarget! * 60),
        deviationSeconds: String(durationDeviation),
      });
    }

    // Update podcast record
    await prisma.podcast.update({
      where: { id: podcastId },
      data: {
        status: 'READY',
        audioUrl,
        duration: Math.round(duration),
        durationDeviation,
        fileSize: finalAudio.length,
        currentVersion: newVersion,
      },
    });

    // Consume free-tier quota on successful generation (not at creation time)
    const podcastUser = await prisma.user.findUniqueOrThrow({
      where: { id: podcast.userId },
      select: { role: true, plan: true },
    });
    const isByok = await hasByokKey(podcast.userId);
    const isPrivileged = podcastUser.role === 'ADMIN' || podcastUser.role === 'SYSTEM';
    if (!isByok && podcastUser.plan !== 'PRO' && !isPrivileged) {
      await consumeFreeGeneration(podcast.userId).catch((err) => {
        logger.warn('Failed to consume free generation', {
          podcastId,
          userId: podcast.userId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Record pipeline completion event for accurate timing metrics
    await prisma.pipelineEvent.create({
      data: {
        podcastId,
        stage: 'audio-stitching',
        type: 'complete',
        message: `Pipeline completed — ${Math.round(duration)}s of audio`,
      },
    });

    // 9a. Capture voice payments on successful generation
    await capturePodcastPayments(podcastId).catch((err) => {
      logger.error('Failed to capture voice payments', {
        podcastId,
        error: err instanceof Error ? err.message : String(err),
      });
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

    // Note: segment audio files are NEVER deleted from R2 — they are needed by
    // avatar generation, voice tracks, and future provider-versioned audio.

    await job.updateProgress(95);

    // 10. Send notification
    const isBriefing = podcast.source === 'BRIEFING';
    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId: podcast.userId,
      type: isBriefing ? 'BRIEFING_READY' : 'PODCAST_READY',
      title: isBriefing ? 'Your daily briefing is ready' : 'Your podcast is ready!',
      message: isBriefing
        ? `Your morning briefing "${podcast.title}" is ready to play.`
        : `"${podcast.title}" is ready to play.`,
      data: { podcastId },
    });

    // 10a. Verify referral (grants referrer bonus if this is the user's first READY podcast)
    await verifyReferral(podcast.userId).catch((err) => {
      logger.warn('Failed to verify referral', {
        userId: podcast.userId,
        podcastId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // 10c. Auto-generate transcript
    await addJob(pdfGenerationQueue, JobType.GENERATE_PDF, {
      podcastId,
      userId: podcast.userId,
    });

    // 10c2. Compute ML features for this podcast
    await addJob(featureComputationQueue, JobType.COMPUTE_FEATURES, {
      scope: 'podcast' as const,
      targetId: podcastId,
    });

    // 10c3. Generate waveform visualization data
    await addJob(waveformGenerationQueue, JobType.GENERATE_WAVEFORM, {
      podcastId,
      userId: podcast.userId,
    });

    // 10c4. Generate post-listen quiz
    await addJob(quizGenerationQueue, JobType.GENERATE_QUIZ, { podcastId }).catch(() => {});

    // 10d. If this podcast has a pending trend auto-tweet, queue it
    const pendingAutoTweet = await prisma.twitterAutoTweet.findFirst({
      where: { podcastId, trigger: 'trend', status: 'pending' },
    });
    if (pendingAutoTweet) {
      await addJob(twitterAutoTweetQueue, JobType.AUTO_TWEET, {
        podcastId,
        trigger: 'trend' as const,
      });
    }

    // 11. If generated from Twitter, queue a reply to the original tweet
    if (podcast.source === 'TWITTER' && podcast.sourceTweetId) {
      const mention = await prisma.tweetMention.findFirst({
        where: { podcastId, status: { in: ['GENERATING', 'FAILED'] } },
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

    // 11b. Auto-trigger video generation if tweet requested it
    if (!skipSfx && podcast.source === 'TWITTER') {
      const mentionWithVideoPrefs = await prisma.tweetMention.findFirst({
        where: { podcastId },
        select: { videoPrefs: true },
      });
      const videoPrefs = mentionWithVideoPrefs?.videoPrefs as { imageModel?: string; videoModel?: string; avatarModel?: string; wantsVideo?: boolean; wantsAvatar?: boolean } | null;
      if (videoPrefs?.wantsVideo) {
        const { checkVideoGenerationGate, tryIncrementVideoGeneration } = await import('@/lib/video-gate');
        const gate = await checkVideoGenerationGate(podcast.userId);
        if (gate.allowed) {
          // Increment daily counter for non-BYOK users; skip video if limit reached
          let videoLimitOk = true;
          if (!gate.isByokUser) {
            videoLimitOk = await tryIncrementVideoGeneration(podcast.userId, gate.dailyLimit);
            if (!videoLimitOk) {
              logger.info('Skipped auto video generation: daily limit reached', { podcastId });
            }
          }
          const existing = await prisma.videoGeneration.findUnique({ where: { podcastId } });
          if (videoLimitOk && !existing) {
            const videoGen = await prisma.videoGeneration.create({
              data: {
                podcastId,
                status: 'PENDING',
                imageModel: videoPrefs.imageModel ?? null,
                videoModel: videoPrefs.videoModel ?? null,
              },
            });
            // Auto-create avatar overlays if requested
            if (videoPrefs.wantsAvatar) {
              try {
                const avatarId = await pickDefaultAvatarId(podcastId);
                const speakers = ['HOST', 'EXPERT'];
                for (const speaker of speakers) {
                  await prisma.avatarOverlay.create({
                    data: {
                      videoGenerationId: videoGen.id,
                      speaker,
                      avatarId,
                      status: 'pending',
                    },
                  });
                }
                logger.info('Auto-created avatar overlays from tweet', {
                  podcastId,
                  avatarId,
                  avatarModel: videoPrefs.avatarModel ?? 'default',
                });
              } catch (avatarErr) {
                logger.warn('Failed to auto-create avatar overlays', {
                  podcastId,
                  error: avatarErr instanceof Error ? avatarErr.message : String(avatarErr),
                });
              }
            }

            await addJob(visualClassificationQueue, JobType.CLASSIFY_VISUALS, {
              podcastId,
              videoGenerationId: videoGen.id,
              userId: podcast.userId,
            });
            logger.info('Auto-triggered video generation from tweet', {
              podcastId,
              imageModel: videoPrefs.imageModel ?? 'default',
              videoModel: videoPrefs.videoModel ?? 'default',
              wantsAvatar: String(!!videoPrefs.wantsAvatar),
            });
          }
        } else {
          logger.info('Skipping video auto-trigger — user not gated for video', {
            podcastId,
            reason: gate.reason,
          });
        }
      }
    }

    // 12. If user has Telegram enabled, send a notification
    if (!skipSfx && podcast.user.telegramEnabled && podcast.user.telegramChatId) {
      const telegramMsg = podcast.source === 'TELEGRAM'
        ? await prisma.telegramMessage.findFirst({
            where: { podcastId, status: { in: ['GENERATING', 'FAILED'] } },
            select: { id: true, chatId: true },
          })
        : null;
      await addJob(telegramReplyQueue, JobType.REPLY_TELEGRAM, {
        podcastId,
        telegramMessageId: telegramMsg?.id,
        chatId: telegramMsg?.chatId ?? podcast.user.telegramChatId,
      });
      if (telegramMsg) {
        await prisma.telegramMessage.update({
          where: { id: telegramMsg.id },
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
    throw err;
  } finally {
    // 11. Clean up temp directory
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Pick a default HeyGen stock avatar ID for auto-triggered avatar generation.
 * Uses Redis-cached avatar list (same cache as GET /api/podcasts/[id]/video/avatars),
 * then deterministically selects one by hashing the podcastId.
 */
async function pickDefaultAvatarId(podcastId: string): Promise<string> {
  const { createHash } = await import('crypto');
  const { listAvatars } = await import('@/lib/heygen');
  const { getRedisClient } = await import('@/lib/redis');

  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) throw new Error('HEYGEN_API_KEY is not configured');

  const redis = getRedisClient();
  const cacheKey = 'heygen:avatars:stock';
  let avatars: Array<{ avatar_id: string; premium: boolean }>;

  const cached = await redis.get(cacheKey);
  if (cached) {
    avatars = JSON.parse(cached);
  } else {
    const all = await listAvatars(apiKey);
    avatars = all.filter((a) => !a.premium);
    await redis.set(cacheKey, JSON.stringify(avatars), 'EX', 3600).catch(() => {});
  }

  if (avatars.length === 0) throw new Error('No stock avatars available');

  const hash = createHash('sha256').update(podcastId).digest();
  const index = hash.readUInt32BE(0) % avatars.length;
  return avatars[index].avatar_id;
}
