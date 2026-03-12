/**
 * Shared TTS generation core — used by audio-generation and voice-track-audio workers.
 *
 * Handles: API key resolution → concurrency limit → semaphore acquire/release →
 * text cleaning → generateSpeech (full params) → BYOK 404 fallback → 429 concurrency
 * update → FFprobe duration measurement → usage logging.
 *
 * Does NOT handle: DB reads/writes, provider resolution, voice assignment,
 * R2 upload, stitching queue — those stay in each worker.
 */
import type { TtsProvider } from '@/lib/providers/tts';
import { getProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { getElevenLabsConcurrencyLimit } from '@/lib/elevenlabs';
import { getCartesiaConcurrencyLimit, updateCartesiaConcurrencyFromError } from '@/lib/providers/tts/cartesia.provider';
import { getHumeConcurrencyLimit, updateHumeConcurrencyFromError } from '@/lib/providers/tts/hume.provider';
import { semaphore } from '@/lib/redis';
import { getByokKey } from '@/lib/byok';
import { cleanTextForTts } from '@/lib/tts-text-cleaner';
import { getAudioDuration } from '@/lib/audio-stitcher';
import { estimateDurationFromText } from '@/lib/duration';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { writeFile, rm } from 'fs/promises';

// ---------------------------------------------------------------------------
// Platform key helper — shared by audio-generation, voice-track, demo-voiceover
// ---------------------------------------------------------------------------

/** Return the platform API key for a given TTS provider (not BYOK). */
export function getPlatformTtsKey(pid: TtsProviderId): string | undefined {
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

// ---------------------------------------------------------------------------
// Shared TTS generation
// ---------------------------------------------------------------------------

export interface TtsGenerationParams {
  /** Raw text (before cleanTextForTts). */
  text: string;
  voiceId: string;
  speaker: string;
  previousText?: string;
  nextText?: string;
  direction?: string;

  /** Already-resolved provider instance. */
  provider: TtsProvider;
  providerId: TtsProviderId;
  source: string;

  /** User context for semaphore key, BYOK lookup, usage logging. */
  userId: string;
  podcastId: string;

  requestedModel?: string | null;
  plan: 'FREE' | 'PRO';

  /** Usage logging category (e.g. 'audio_generation', 'voice_track_audio'). */
  usageCategory: string;

  /** Extra metadata merged into logUsage (e.g. { voiceTrackId }). */
  extraMetadata?: Record<string, unknown>;

  /**
   * Fail-fast callback: called during semaphore wait to check if the parent
   * entity (Podcast or VoiceTrack) has already failed. Return true to abort.
   */
  isAborted: () => Promise<boolean>;
}

export interface TtsGenerationResult {
  audioBuffer: Buffer;
  segmentDuration: number;
  /** Service string for analytics (e.g. 'elevenlabs' or 'elevenlabs_byok'). */
  service: string;
  /** Wall-clock time in ms. */
  durationMs: number;
}

/**
 * Execute TTS generation with semaphore-controlled concurrency, BYOK 404 fallback,
 * FFprobe duration measurement, and usage logging.
 *
 * Returns null if the job was aborted (parent entity failed during semaphore wait).
 */
export async function generateTtsAudio(params: TtsGenerationParams): Promise<TtsGenerationResult | null> {
  const {
    text, voiceId, speaker, previousText, nextText, direction,
    provider, providerId, source,
    userId, podcastId,
    requestedModel: _requestedModel, plan: _plan,
    usageCategory, extraMetadata,
    isAborted,
  } = params;

  const startTime = Date.now();

  // 1. Resolve raw API key for concurrency lookups
  const resolvedApiKey = await getByokKey(userId, providerId) || getPlatformTtsKey(providerId);

  // 2. Get provider-specific concurrency limit
  let concurrencyLimit = 5;
  if (providerId === 'elevenlabs' && resolvedApiKey) {
    concurrencyLimit = await getElevenLabsConcurrencyLimit(resolvedApiKey);
  } else if (providerId === 'cartesia' && resolvedApiKey) {
    concurrencyLimit = await getCartesiaConcurrencyLimit(resolvedApiKey);
  } else if (providerId === 'hume' && resolvedApiKey) {
    concurrencyLimit = await getHumeConcurrencyLimit(resolvedApiKey);
  }

  const semaphoreKey = `tts:sem:${userId}:${providerId}`;

  logger.info('Using TTS provider', {
    speaker, providerId, source, voiceId, podcastId, concurrencyLimit,
  });

  // 3. Acquire semaphore slot with exponential backoff
  let acquired = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    acquired = await semaphore.acquire(semaphoreKey, concurrencyLimit);
    if (acquired) break;
    const delay = Math.min(1000 * Math.pow(1.5, attempt), 15000);
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (await isAborted()) {
      logger.info('Parent entity failed while waiting for semaphore, aborting', { podcastId });
      return null;
    }
  }

  if (!acquired) {
    throw new Error(`Timed out waiting for TTS semaphore (${providerId}, limit ${concurrencyLimit})`);
  }

  // 4. Clean text and call TTS
  const ttsText = cleanTextForTts(text);
  const speechParams = { text: ttsText, voiceId, previousText, nextText, direction, speaker };

  let audioBuffer: Buffer;
  let semaphoreReleased = false;
  const effectiveSource = source;
  try {
    audioBuffer = await provider.generateSpeech(speechParams);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await semaphore.release(semaphoreKey);
    semaphoreReleased = true;

    // 5. On 429, update cached concurrency limit
    if (resolvedApiKey && /\(429\)/.test(errMsg)) {
      if (providerId === 'cartesia') {
        await updateCartesiaConcurrencyFromError(resolvedApiKey, errMsg);
      } else if (providerId === 'hume') {
        await updateHumeConcurrencyFromError(resolvedApiKey, errMsg);
      }
      logger.warn('TTS 429 — concurrency limit cached, BullMQ will retry', { providerId, podcastId });
    }
    throw err;
  } finally {
    // 6. Release semaphore
    if (!semaphoreReleased) {
      await semaphore.release(semaphoreKey);
    }
  }

  const service = effectiveSource === 'byok' ? `${providerId}_byok` : providerId;
  const durationMs = Date.now() - startTime;

  // 8. Measure audio duration via FFprobe
  let segmentDuration: number;
  const tmpPath = path.join(os.tmpdir(), `sotto-probe-${crypto.randomUUID()}.mp3`);
  try {
    await writeFile(tmpPath, audioBuffer);
    segmentDuration = await getAudioDuration(tmpPath);
  } catch (err) {
    logger.warn('FFprobe duration extraction failed, estimating from text length', {
      podcastId,
      error: err instanceof Error ? err.message : String(err),
    });
    segmentDuration = estimateDurationFromText(text);
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {});
  }

  // 9. Log TTS cost
  const charCount = text.length;
  const meta = getProviderMeta(providerId);
  const totalCost = (charCount / 1000) * meta.platformCostPerKChar;

  logUsage({
    service,
    category: usageCategory,
    inputTokens: charCount,
    totalCost,
    durationMs,
    podcastId,
    userId,
    metadata: { voiceId, speaker, source: effectiveSource, ...extraMetadata },
  });

  return { audioBuffer, segmentDuration, service, durationMs };
}
