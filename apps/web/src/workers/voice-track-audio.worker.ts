import { Job } from 'bullmq';
import { GenerateVoiceTrackAudioPayload, addJob, JobType, voiceTrackStitchingQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveTtsProvider } from '@/lib/providers';
import { getProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { uploadVoiceTrackSegmentAudio } from '@/lib/r2';
import { getAudioDuration } from '@/lib/audio-stitcher';
import { getElevenLabsConcurrencyLimit } from '@/lib/elevenlabs';
import { getCartesiaConcurrencyLimit, updateCartesiaConcurrencyFromError } from '@/lib/providers/tts/cartesia.provider';
import { getHumeConcurrencyLimit, updateHumeConcurrencyFromError } from '@/lib/providers/tts/hume.provider';
import { semaphore } from '@/lib/redis';
import { getByokKey } from '@/lib/byok';
import { cleanTextForTts } from '@/lib/tts-text-cleaner';
import { estimateDurationFromText } from '@/lib/duration';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { writeFile, rm } from 'fs/promises';

export async function processVoiceTrackAudio(job: Job<GenerateVoiceTrackAudioPayload>): Promise<void> {
  const { podcastId, voiceTrackId, voiceTrackSegmentId, segmentId, speaker, text } = job.data;

  logger.info('Generating voice track audio for segment', { podcastId, voiceTrackId, segmentId, speaker });
  await job.updateProgress(10);

  // Fail-fast: skip if voice track already failed (another segment errored first)
  const trackStatus = await prisma.voiceTrack.findUnique({
    where: { id: voiceTrackId },
    select: { status: true },
  });

  if (trackStatus?.status === 'FAILED') {
    logger.info('Voice track already failed, skipping segment', { voiceTrackId, segmentId });
    await job.updateProgress(100);
    return;
  }

  // Idempotency: skip if segment already has audio
  const existingSegment = await prisma.voiceTrackSegment.findUnique({
    where: { id: voiceTrackSegmentId },
    select: { audioUrl: true },
  });

  if (existingSegment?.audioUrl) {
    logger.info('Voice track segment already has audio, skipping TTS', { voiceTrackId, segmentId });

    // Still check if all segments are done
    const pendingSegments = await prisma.voiceTrackSegment.count({
      where: { voiceTrackId, audioUrl: null },
    });

    if (pendingSegments === 0) {
      const segments = await prisma.voiceTrackSegment.findMany({
        where: { voiceTrackId },
        orderBy: { order: 'asc' },
        select: { id: true },
      });

      await addJob(voiceTrackStitchingQueue, JobType.STITCH_VOICE_TRACK, {
        podcastId,
        voiceTrackId,
        voiceTrackSegmentIds: segments.map((s) => s.id),
      });

      await prisma.voiceTrack.update({
        where: { id: voiceTrackId },
        data: { status: 'STITCHING' },
      });
    }

    await job.updateProgress(100);
    return;
  }

  // Fetch voice track to determine voice configuration
  const voiceTrack = await prisma.voiceTrack.findUniqueOrThrow({
    where: { id: voiceTrackId },
    select: {
      ttsProvider: true,
      ttsModel: true,
      voices: { select: { speaker: true, voiceId: true, provider: true } },
      podcast: {
        select: { userId: true, user: { select: { plan: true } } },
      },
    },
  });

  const userId = voiceTrack.podcast.userId;
  const startTime = Date.now();

  // Resolve provider per-speaker: use the speaker's VoiceTrackVoice.provider if set, else fall back to track-level
  const trackVoice = voiceTrack.voices.find(v => v.speaker === speaker);
  const requestedProvider = (trackVoice?.provider || voiceTrack.ttsProvider) as TtsProviderId | null;

  const { provider, source, providerId } = await resolveTtsProvider({
    userId,
    podcastId,
    requestedProvider: requestedProvider ?? undefined,
    requestedModel: voiceTrack.ttsModel,
    plan: voiceTrack.podcast.user.plan as 'FREE' | 'PRO',
  });

  const ttsModelId = provider.getModelId();

  // Write back resolved provider and model if not already set
  if (!voiceTrack.ttsProvider || !voiceTrack.ttsModel) {
    await prisma.voiceTrack.update({
      where: { id: voiceTrackId },
      data: { ttsProvider: providerId, ttsModel: ttsModelId },
    }).catch((err) => {
      logger.warn('Failed to write back TTS provider to voice track', { voiceTrackId, error: err instanceof Error ? err.message : String(err) });
    });
  }

  // Use voice track voice assignment if provider matches, otherwise let provider pick from pool
  const voiceId = (trackVoice?.voiceId && trackVoice.provider === providerId)
    ? trackVoice.voiceId
    : provider.getVoiceId(speaker, podcastId);

  // Persist resolved voice for retry consistency
  if (!trackVoice || trackVoice.provider !== providerId || trackVoice.voiceId !== voiceId) {
    try {
      await prisma.voiceTrackVoice.upsert({
        where: { voiceTrackId_speaker: { voiceTrackId, speaker } },
        update: { voiceId, provider: providerId },
        create: { voiceTrackId, speaker, voiceId, provider: providerId },
      });
    } catch (err) {
      logger.warn('Failed to persist voice track voice assignment', {
        podcastId, voiceTrackId, speaker, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Resolve the raw API key for concurrency lookups
  const resolvedApiKey = await getByokKey(userId, providerId)
    || (providerId === 'elevenlabs' ? process.env.ELEVENLABS_API_KEY
      : providerId === 'cartesia' ? process.env.CARTESIA_API_KEY
      : providerId === 'hume' ? process.env.HUME_API_KEY
      : undefined);

  let concurrencyLimit = 5;
  if (providerId === 'elevenlabs' && resolvedApiKey) {
    concurrencyLimit = await getElevenLabsConcurrencyLimit(resolvedApiKey);
  } else if (providerId === 'cartesia' && resolvedApiKey) {
    concurrencyLimit = await getCartesiaConcurrencyLimit(resolvedApiKey);
  } else if (providerId === 'hume' && resolvedApiKey) {
    concurrencyLimit = await getHumeConcurrencyLimit(resolvedApiKey);
  }

  const semaphoreKey = `tts:sem:${userId}:${providerId}`;

  logger.info('Using TTS provider for voice track', {
    speaker,
    providerId,
    source,
    voiceId,
    voiceTrackId,
    concurrencyLimit,
  });

  // Acquire a semaphore slot
  let acquired = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    acquired = await semaphore.acquire(semaphoreKey, concurrencyLimit);
    if (acquired) break;
    const delay = Math.min(1000 * Math.pow(1.5, attempt), 15000);
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Re-check if voice track failed while waiting
    const check = await prisma.voiceTrack.findUnique({
      where: { id: voiceTrackId },
      select: { status: true },
    });
    if (check?.status === 'FAILED') {
      logger.info('Voice track failed while waiting for semaphore, skipping', { voiceTrackId, segmentId });
      await job.updateProgress(100);
      return;
    }
  }

  if (!acquired) {
    throw new Error(`Timed out waiting for TTS semaphore (${providerId}, limit ${concurrencyLimit})`);
  }

  const ttsText = cleanTextForTts(text);

  let audioBuffer: Buffer;
  let semaphoreReleased = false;
  try {
    audioBuffer = await provider.generateSpeech({ text: ttsText, voiceId });
  } catch (err) {
    await semaphore.release(semaphoreKey);
    semaphoreReleased = true;

    // On 429, update cached concurrency limit so BullMQ retry uses the correct value
    const errMsg = err instanceof Error ? err.message : String(err);
    if (resolvedApiKey && /\(429\)/.test(errMsg)) {
      if (providerId === 'cartesia') {
        await updateCartesiaConcurrencyFromError(resolvedApiKey, errMsg);
      } else if (providerId === 'hume') {
        await updateHumeConcurrencyFromError(resolvedApiKey, errMsg);
      }
      logger.warn('TTS 429 — concurrency limit cached, BullMQ will retry', { providerId, voiceTrackId, segmentId });
    }
    throw err;
  } finally {
    if (!semaphoreReleased) {
      await semaphore.release(semaphoreKey);
    }
  }

  const service = source === 'byok' ? `${providerId}_byok` : providerId;
  const durationMs = Date.now() - startTime;

  await job.updateProgress(60);

  // Upload to R2
  const audioUrl = await uploadVoiceTrackSegmentAudio(podcastId, voiceTrackId, segmentId, audioBuffer);

  // Measure actual audio duration via FFprobe
  let segmentDuration: number;
  const tmpPath = path.join(os.tmpdir(), `sotto-probe-vt-${crypto.randomUUID()}.mp3`);
  try {
    await writeFile(tmpPath, audioBuffer);
    segmentDuration = await getAudioDuration(tmpPath);
  } catch (err) {
    logger.warn('FFprobe duration extraction failed, estimating from text length', {
      voiceTrackSegmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    segmentDuration = estimateDurationFromText(text);
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {});
  }

  // Update voice track segment with audio URL and duration
  await prisma.voiceTrackSegment.update({
    where: { id: voiceTrackSegmentId },
    data: { audioUrl, duration: segmentDuration },
  });

  // Log TTS cost
  const charCount = text.length;
  const meta = getProviderMeta(providerId);
  const totalCost = (charCount / 1000) * meta.platformCostPerKChar;

  logUsage({
    service,
    category: 'voice_track_audio',
    inputTokens: charCount,
    totalCost,
    durationMs,
    podcastId,
    userId,
    metadata: { voiceId, speaker, source, voiceTrackId },
  });

  await job.updateProgress(90);

  // Check if all segments for this voice track are done
  const pendingSegments = await prisma.voiceTrackSegment.count({
    where: { voiceTrackId, audioUrl: null },
  });

  if (pendingSegments === 0) {
    const segments = await prisma.voiceTrackSegment.findMany({
      where: { voiceTrackId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });

    await addJob(voiceTrackStitchingQueue, JobType.STITCH_VOICE_TRACK, {
      podcastId,
      voiceTrackId,
      voiceTrackSegmentIds: segments.map((s) => s.id),
    });

    await prisma.voiceTrack.update({
      where: { id: voiceTrackId },
      data: { status: 'STITCHING' },
    });
  }

  await job.updateProgress(100);
  logger.info('Voice track audio generation complete for segment', { voiceTrackId, segmentId, service });
}
