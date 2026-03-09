import { Job } from 'bullmq';
import { GenerateAudioPayload, addJob, JobType, audioStitchingQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { resolveTtsProvider, createTtsProviderAsync } from '@/lib/providers';
import { getProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import type { TtsProvider } from '@/lib/providers/tts';
import { uploadSegmentAudio } from '@/lib/r2';
import { getAudioDuration } from '@/lib/audio-stitcher';
import { getElevenLabsConcurrencyLimit } from '@/lib/elevenlabs';
import { getCartesiaConcurrencyLimit, updateCartesiaConcurrencyFromError } from '@/lib/providers/tts/cartesia.provider';
import { getHumeConcurrencyLimit, updateHumeConcurrencyFromError } from '@/lib/providers/tts/hume.provider';
import { semaphore } from '@/lib/redis';
import { getByokKey } from '@/lib/byok';
import { cleanTextForTts } from '@/lib/tts-text-cleaner';
import { estimateDurationFromText } from '@/lib/duration';
import type { VoiceMatchMetadata } from '@/lib/voice-pool';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { writeFile, rm } from 'fs/promises';

/** Return the platform API key for a given TTS provider (not BYOK). */
function getPlatformTtsKey(pid: TtsProviderId): string | undefined {
  switch (pid) {
    case 'elevenlabs': return process.env.ELEVENLABS_API_KEY;
    case 'openai': return process.env.OPENAI_API_KEY;
    case 'cartesia': return process.env.CARTESIA_API_KEY;
    case 'hume': return process.env.HUME_API_KEY;
    case 'fal': case 'minimax': return process.env.FAL_KEY;
    case 'replicate': return process.env.REPLICATE_API_TOKEN;
    case 'kittentts': return undefined;
    default: return undefined;
  }
}

export async function processAudioGeneration(job: Job<GenerateAudioPayload>): Promise<void> {
  const { podcastId, segmentId, speaker, text, previousText, nextText, direction } = job.data;

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

  // Idempotency: skip if segment already has audio; also fetch per-segment TTS overrides
  const existingSegment = await prisma.segment.findUnique({
    where: { id: segmentId },
    select: { audioUrl: true, ttsProvider: true, ttsModel: true, ttsVoiceId: true },
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

  // Fetch podcast + user plan to determine voice configuration
  const podcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: {
      userId: true,
      voices: { select: { speaker: true, voiceId: true, provider: true } },
      ttsProvider: true,
      ttsModel: true,
      user: { select: { plan: true } },
    },
  });

  // Fetch discovery metadata for topic-aware voice selection
  const discovery = await prisma.discovery.findUnique({
    where: { podcastId },
    select: { tone: true, audienceLevel: true, audience: true },
  });

  let voiceMetadata: VoiceMatchMetadata | undefined = discovery
    ? {
        tone: discovery.tone as VoiceMatchMetadata['tone'],
        audienceLevel: discovery.audienceLevel as VoiceMatchMetadata['audienceLevel'],
        audience: discovery.audience as VoiceMatchMetadata['audience'],
      }
    : undefined;

  // When discovery doesn't have a tone, infer from script delivery directions
  if (!voiceMetadata?.tone) {
    const script = await prisma.script.findUnique({
      where: { podcastId },
      select: { turns: true },
    });
    if (script?.turns) {
      const turns = script.turns as Array<{ direction?: string }>;
      const directions = turns
        .map((t) => t.direction?.toLowerCase() ?? '')
        .filter(Boolean)
        .join(' ');
      if (directions) {
        const casualPatterns = /excited|enthusiastic|laughing|playful|humorous|energetic|fun/;
        const professionalPatterns = /serious|academic|formal|whispering|soft|calm|measured|thoughtful/;
        const casualCount = (directions.match(casualPatterns) || []).length;
        const professionalCount = (directions.match(professionalPatterns) || []).length;
        if (casualCount > 0 || professionalCount > 0) {
          const inferredTone = casualCount >= professionalCount ? 'casual' : 'professional';
          voiceMetadata = { ...voiceMetadata, tone: inferredTone };
        }
      }
    }
  }

  const startTime = Date.now();

  let provider: TtsProvider;
  let providerId: TtsProviderId;
  let source: string;
  let voiceId: string;

  if (existingSegment?.ttsProvider) {
    // ---- Per-segment TTS override (admin showcase builder) ----
    const segProviderId = existingSegment.ttsProvider as TtsProviderId;
    const platformKey = getPlatformTtsKey(segProviderId);
    provider = await createTtsProviderAsync(segProviderId, platformKey, undefined, existingSegment.ttsModel ?? undefined);
    providerId = segProviderId;
    source = 'platform';

    voiceId = existingSegment.ttsVoiceId ?? provider.getVoiceId(speaker, podcastId, voiceMetadata);

    // Persist resolved voice for consistency
    try {
      await prisma.podcastVoice.upsert({
        where: { podcastId_speaker: { podcastId, speaker } },
        update: { voiceId, provider: providerId },
        create: { podcastId, speaker, voiceId, provider: providerId },
      });
    } catch (err) {
      logger.warn('Failed to persist voice assignment', {
        podcastId, speaker, error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    // ---- Standard flow: resolve provider at podcast level ----
    const resolved = await resolveTtsProvider({
      userId: podcast.userId,
      podcastId,
      requestedProvider: (podcast.ttsProvider as TtsProviderId | null) ?? undefined,
      requestedModel: podcast.ttsModel,
      plan: podcast.user.plan as 'FREE' | 'PRO',
    });
    provider = resolved.provider;
    providerId = resolved.providerId;
    source = resolved.source;

    const ttsModelId = provider.getModelId();

    // Write back resolved provider and model if not already set
    if (!podcast.ttsProvider || !podcast.ttsModel) {
      await prisma.podcast.update({
        where: { id: podcastId },
        data: { ttsProvider: providerId, ttsModel: ttsModelId },
      }).catch((err) => {
        logger.warn('Failed to write back TTS provider to podcast', { podcastId, error: err instanceof Error ? err.message : String(err) });
      });
    }

    // Use custom voice ID if set and provider matches, otherwise let the provider pick from its pool
    const podcastVoice = podcast.voices.find(v => v.speaker === speaker);
    voiceId = (podcastVoice?.voiceId && podcastVoice.provider === providerId)
      ? podcastVoice.voiceId
      : provider.getVoiceId(speaker, podcastId, voiceMetadata);

    // Persist resolved voice for retry consistency and analytics
    if (!podcastVoice || podcastVoice.provider !== providerId || podcastVoice.voiceId !== voiceId) {
      try {
        await prisma.podcastVoice.upsert({
          where: { podcastId_speaker: { podcastId, speaker } },
          update: { voiceId, provider: providerId },
          create: { podcastId, speaker, voiceId, provider: providerId },
        });
      } catch (err) {
        logger.warn('Failed to persist voice assignment', {
          podcastId, speaker, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Resolve the raw API key for concurrency lookups
  const resolvedApiKey = await getByokKey(podcast.userId, providerId)
    || getPlatformTtsKey(providerId);

  let concurrencyLimit = 5;
  if (providerId === 'elevenlabs' && resolvedApiKey) {
    concurrencyLimit = await getElevenLabsConcurrencyLimit(resolvedApiKey);
  } else if (providerId === 'cartesia' && resolvedApiKey) {
    concurrencyLimit = await getCartesiaConcurrencyLimit(resolvedApiKey);
  } else if (providerId === 'hume' && resolvedApiKey) {
    concurrencyLimit = await getHumeConcurrencyLimit(resolvedApiKey);
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
  const ttsText = cleanTextForTts(text);

  let audioBuffer: Buffer;
  let semaphoreReleased = false;
  try {
    audioBuffer = await provider.generateSpeech({ text: ttsText, voiceId, previousText, nextText, direction, speaker });
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
      logger.warn('TTS 429 — concurrency limit cached, BullMQ will retry', { providerId, podcastId, segmentId });
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

  logUsage({
    service,
    category: 'audio_generation',
    inputTokens: charCount,
    totalCost,
    durationMs,
    podcastId,
    userId: podcast.userId,
    metadata: { voiceId, speaker, source },
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
