import { Job } from 'bullmq';
import { GenerateAudioPayload, addJob, JobType, audioStitchingQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveTtsProvider } from '@/lib/providers';
import { getProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { uploadSegmentAudio } from '@/lib/r2';
import { getAudioDuration } from '@/lib/audio-stitcher';
import { getElevenLabsConcurrencyLimit } from '@/lib/elevenlabs';
import { semaphore } from '@/lib/redis';
import { getByokKey } from '@/lib/byok';
import { cleanTextForTts } from '@/lib/tts-text-cleaner';
import { estimateDurationFromText } from '@/lib/duration';
import type { VoiceMatchMetadata } from '@/lib/voice-pool';
import { logger } from '@/lib/logger';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { writeFile, rm } from 'fs/promises';

export async function processAudioGeneration(job: Job<GenerateAudioPayload>): Promise<void> {
  const { podcastId, segmentId, speaker, text } = job.data;

  logger.info('Generating audio for segment', { podcastId, segmentId, speaker });
  await job.updateProgress(10);

  // Fail-fast: skip if podcast already failed (another segment errored first)
  const podcastStatus = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { status: true },
  });

  if (podcastStatus?.status === 'FAILED') {
    logger.info('Podcast already failed, skipping segment', { podcastId, segmentId });
    await job.updateProgress(100);
    return;
  }

  // Idempotency: skip if segment already has audio
  const existingSegment = await prisma.segment.findUnique({
    where: { id: segmentId },
    select: { audioUrl: true },
  });

  if (existingSegment?.audioUrl) {
    logger.info('Segment already has audio, skipping TTS', { podcastId, segmentId });

    // Still check if all segments are done — may need to trigger stitching
    const pendingSegments = await prisma.segment.count({
      where: { podcastId, audioUrl: null },
    });

    if (pendingSegments === 0) {
      const segments = await prisma.segment.findMany({
        where: { podcastId },
        orderBy: { order: 'asc' },
        select: { id: true },
      });

      await addJob(audioStitchingQueue, JobType.STITCH_AUDIO, {
        podcastId,
        segmentIds: segments.map((s) => s.id),
      });

      await prisma.podcast.update({
        where: { id: podcastId },
        data: { status: 'STITCHING' },
      });
    }

    await job.updateProgress(100);
    return;
  }

  // Fetch podcast to determine voice configuration
  const podcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: {
      userId: true,
      hostVoiceId: true,
      expertVoiceId: true,
      ttsProvider: true,
      ttsModel: true,
    },
  });

  // Fetch discovery metadata for topic-aware voice selection
  const discovery = await prisma.discovery.findUnique({
    where: { podcastId },
    select: { tone: true, audienceLevel: true, audience: true },
  });

  const voiceMetadata: VoiceMatchMetadata | undefined = discovery
    ? {
        tone: discovery.tone as VoiceMatchMetadata['tone'],
        audienceLevel: discovery.audienceLevel as VoiceMatchMetadata['audienceLevel'],
        audience: discovery.audience as VoiceMatchMetadata['audience'],
      }
    : undefined;

  const startTime = Date.now();

  // Resolve provider using the multi-provider system
  const { provider, source, providerId } = await resolveTtsProvider({
    userId: podcast.userId,
    podcastId,
    requestedProvider: (podcast.ttsProvider as TtsProviderId | null) ?? undefined,
    requestedModel: podcast.ttsModel,
  });

  const ttsModelId = provider.getModelId();

  // Write back resolved provider and model if not already set
  if (!podcast.ttsProvider || !podcast.ttsModel) {
    await prisma.podcast.update({
      where: { id: podcastId },
      data: { ttsProvider: providerId, ttsModel: ttsModelId },
    }).catch(() => {});
  }

  // Use custom voice ID if set, otherwise let the provider pick from its pool
  const customVoiceId = speaker === 'HOST' ? podcast.hostVoiceId : podcast.expertVoiceId;
  const voiceId = customVoiceId || provider.getVoiceId(speaker, podcastId, voiceMetadata);

  // Resolve per-user concurrency limit for the TTS provider
  let concurrencyLimit = 5;
  if (providerId === 'elevenlabs') {
    const apiKey = await getByokKey(podcast.userId, 'elevenlabs') || process.env.ELEVENLABS_API_KEY;
    if (apiKey) {
      concurrencyLimit = await getElevenLabsConcurrencyLimit(apiKey);
    }
  }

  const semaphoreKey = `tts:sem:${podcast.userId}:${providerId}`;

  logger.info('Using TTS provider', {
    speaker,
    providerId,
    source,
    voiceId,
    podcastId,
    concurrencyLimit,
  });

  // Acquire a semaphore slot, retrying with backoff if all slots are taken
  let acquired = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    acquired = await semaphore.acquire(semaphoreKey, concurrencyLimit);
    if (acquired) break;
    const delay = Math.min(1000 * Math.pow(1.5, attempt), 15000);
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Re-check if podcast failed while waiting
    const check = await prisma.podcast.findUnique({
      where: { id: podcastId },
      select: { status: true },
    });
    if (check?.status === 'FAILED') {
      logger.info('Podcast failed while waiting for semaphore, skipping', { podcastId, segmentId });
      await job.updateProgress(100);
      return;
    }
  }

  if (!acquired) {
    throw new Error(`Timed out waiting for TTS semaphore (${providerId}, limit ${concurrencyLimit})`);
  }

  // Strip non-speech markers before sending to TTS (preserves audio tags for ElevenLabs)
  const ttsText = cleanTextForTts(text, { providerId });

  let audioBuffer: Buffer;
  try {
    audioBuffer = await provider.generateSpeech({ text: ttsText, voiceId });
  } finally {
    await semaphore.release(semaphoreKey);
  }

  const service = source === 'byok' ? `${providerId}_byok` : providerId;

  const durationMs = Date.now() - startTime;

  await job.updateProgress(60);

  // Upload to R2
  const audioUrl = await uploadSegmentAudio(podcastId, segmentId, audioBuffer);

  // Measure actual audio duration via FFprobe
  let segmentDuration: number;
  const tmpPath = path.join(os.tmpdir(), `sotto-probe-${crypto.randomUUID()}.mp3`);
  try {
    await writeFile(tmpPath, audioBuffer);
    segmentDuration = await getAudioDuration(tmpPath);
  } catch (err) {
    logger.warn('FFprobe duration extraction failed, estimating from text length', {
      segmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    segmentDuration = estimateDurationFromText(text);
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {});
  }

  // Update segment with audio URL and duration
  await prisma.segment.update({
    where: { id: segmentId },
    data: { audioUrl, duration: segmentDuration },
  });

  // Log TTS cost — always calculate regardless of key source
  const charCount = text.length;
  const meta = getProviderMeta(providerId);
  const totalCost = (charCount / 1000) * meta.platformCostPerKChar;

  await prisma.apiUsageLog.create({
    data: {
      podcastId,
      userId: podcast.userId,
      service,
      category: 'audio_generation',
      inputTokens: charCount,
      totalCost,
      durationMs,
      metadata: { voiceId, speaker, providerId, source },
    },
  });

  await job.updateProgress(90);

  // Check if all segments for this podcast are done
  const pendingSegments = await prisma.segment.count({
    where: { podcastId, audioUrl: null },
  });

  if (pendingSegments === 0) {
    // All segments generated — queue stitching
    const segments = await prisma.segment.findMany({
      where: { podcastId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });

    await addJob(audioStitchingQueue, JobType.STITCH_AUDIO, {
      podcastId,
      segmentIds: segments.map((s) => s.id),
    });

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'STITCHING' },
    });
  }

  await job.updateProgress(100);
  logger.info('Audio generation complete for segment', { podcastId, segmentId, service });
}
