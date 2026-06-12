/**
 * Shared TTS generation core — used by the listening audio pipeline.
 *
 * Handles: API key resolution → concurrency limit → semaphore acquire/release →
 * text cleaning → generateSpeech (full params) → BYOK 404 fallback → 429 concurrency
 * update → FFprobe duration measurement → usage logging.
 *
 * Does NOT handle: DB reads/writes, provider resolution, voice assignment,
 * R2 upload, stitching queue — those stay in each worker.
 */
import type { WordTiming } from '@sotto/shared';
import type { TtsProvider } from '@/lib/providers/tts';
import { getProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { getElevenLabsConcurrencyLimit } from '@/lib/elevenlabs';
import {
  getCartesiaConcurrencyLimit,
  updateCartesiaConcurrencyFromError,
} from '@/lib/providers/tts/cartesia.provider';
import {
  getHumeConcurrencyLimit,
  updateHumeConcurrencyFromError,
} from '@/lib/providers/tts/hume.provider';
import { semaphore } from '@/lib/redis';
import { getByokKey } from '@/lib/byok';
import { cleanTextForTts, splitTextForTts } from '@/lib/tts-text-cleaner';
import { getAudioDuration } from '@/lib/audio-stitcher';
import { estimateDurationFromText } from '@/lib/duration';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { writeFile, rm } from 'fs/promises';

// ---------------------------------------------------------------------------
// Platform key helper — shared by audio-generation and TTS tooling.
// ---------------------------------------------------------------------------

/** Return the platform API key for a given TTS provider (not BYOK). */
export function getPlatformTtsKey(pid: TtsProviderId): string | undefined {
  switch (pid) {
    case 'elevenlabs':
      return process.env.ELEVENLABS_API_KEY;
    case 'openai':
      return process.env.OPENAI_API_KEY;
    case 'cartesia':
      return process.env.CARTESIA_API_KEY;
    case 'hume':
      return process.env.HUME_API_KEY;
    case 'fal':
    case 'minimax':
      return process.env.FAL_KEY;
    case 'replicate':
      return process.env.REPLICATE_API_TOKEN;
    case 'mistral':
      return process.env.MISTRAL_API_KEY;
    case 'kokoro':
      // Keyless local sidecar — the Kokoro server ignores auth, but callers that
      // gate on "has a platform key" need a non-empty value. Return a placeholder
      // so kokoro is never rejected for a missing key (mirrors getSttPlatformKey('local')).
      // TTS_API_KEY overrides it only when the sidecar sits behind auth.
      return process.env.TTS_API_KEY?.trim() || 'kokoro';
    case 'local':
      // Generic keyless local sidecar. TTS_API_KEY is optional and only used when
      // the sidecar is protected by a reverse proxy or custom auth layer.
      return process.env.TTS_API_KEY?.trim() || 'local';
    default:
      return undefined;
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
  /** ISO 639-1 language code for the episode (passed as hint to providers that accept it). */
  language?: string | null;

  /** Already-resolved provider instance. */
  provider: TtsProvider;
  providerId: TtsProviderId;
  source: string;

  /** User context for semaphore key, BYOK lookup, usage logging. */
  userId: string;
  episodeId: string;

  requestedModel?: string | null;

  /** Usage logging category (e.g. 'audio_generation', 'segment_regeneration'). */
  usageCategory: string;

  /** Extra metadata merged into logUsage (e.g. { segmentId }). */
  extraMetadata?: Record<string, unknown>;

  /**
   * Fail-fast callback: called during semaphore wait to check if the parent
   * entity has already failed. Return true to abort.
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
  /** Word-level timestamps from the TTS provider or STT fallback, null when unavailable. */
  wordTimings: WordTiming[] | null;
}

/**
 * Execute TTS generation with semaphore-controlled concurrency, BYOK 404 fallback,
 * FFprobe duration measurement, and usage logging.
 *
 * Returns null if the job was aborted (parent entity failed during semaphore wait).
 */
export async function generateTtsAudio(
  params: TtsGenerationParams
): Promise<TtsGenerationResult | null> {
  const {
    text,
    voiceId,
    speaker,
    previousText,
    nextText,
    direction,
    language,
    provider,
    providerId,
    source,
    userId,
    episodeId,
    requestedModel: _requestedModel,
    usageCategory,
    extraMetadata,
    isAborted,
  } = params;

  const langHint = language ?? undefined;

  const startTime = Date.now();

  // 1. Resolve raw API key for concurrency lookups
  const resolvedApiKey = (await getByokKey(userId, providerId)) || getPlatformTtsKey(providerId);

  // 2. Get provider-specific concurrency limit
  let concurrencyLimit = 5;
  if (providerId === 'elevenlabs' && resolvedApiKey) {
    concurrencyLimit = await getElevenLabsConcurrencyLimit(resolvedApiKey);
  } else if (providerId === 'cartesia' && resolvedApiKey) {
    concurrencyLimit = await getCartesiaConcurrencyLimit(resolvedApiKey);
  } else if (providerId === 'hume' && resolvedApiKey) {
    concurrencyLimit = await getHumeConcurrencyLimit(resolvedApiKey);
  } else if (providerId === 'replicate') {
    concurrencyLimit = 1;
  }

  const semaphoreKey = `tts:sem:${userId}:${providerId}`;

  logger.info('Using TTS provider', {
    speaker,
    providerId,
    source,
    voiceId,
    episodeId,
    concurrencyLimit,
  });

  // 3. Acquire semaphore slot with exponential backoff
  let acquired = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    acquired = await semaphore.acquire(semaphoreKey, concurrencyLimit);
    if (acquired) break;
    const delay = Math.min(1000 * Math.pow(1.5, attempt), 15000);
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (await isAborted()) {
      logger.info('Parent entity failed while waiting for semaphore, aborting', { episodeId });
      return null;
    }
  }

  if (!acquired) {
    throw new Error(
      `Timed out waiting for TTS semaphore (${providerId}, limit ${concurrencyLimit})`
    );
  }

  // 4. Clean text and split into chunks if it exceeds provider char limit
  const ttsText = cleanTextForTts(text);
  const meta = getProviderMeta(providerId);
  const chunks = splitTextForTts(ttsText, meta.maxSegmentChars);

  if (chunks.length > 1) {
    logger.info('Text exceeds provider limit, splitting into chunks', {
      episodeId,
      providerId,
      originalLength: ttsText.length,
      maxSegmentChars: meta.maxSegmentChars,
      chunkCount: chunks.length,
    });
  }

  let audioBuffer: Buffer;
  let wordTimings: WordTiming[] | null = null;
  let semaphoreReleased = false;
  const effectiveSource = source;
  const supportsTimestamps = typeof provider.generateSpeechWithTimestamps === 'function';
  try {
    if (chunks.length === 1) {
      // Fast path — single chunk, no splitting needed
      const speechParams = {
        text: ttsText,
        voiceId,
        previousText,
        nextText,
        direction,
        speaker,
        language: langHint,
      };
      if (supportsTimestamps) {
        const result = await provider.generateSpeechWithTimestamps!(speechParams);
        audioBuffer = result.audio;
        wordTimings = result.wordTimings;
      } else {
        audioBuffer = await provider.generateSpeech(speechParams);
      }
    } else {
      // Multi-chunk: generate each with context bridging for voice continuity
      const chunkBuffers: Buffer[] = [];
      const allWordTimings: WordTiming[] = [];
      let cumulativeDuration = 0;
      const skipTextContext = meta.modelsWithoutTextContext.includes(provider.getModelId());
      const continuityIds: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const isFirst = i === 0;
        const isLast = i === chunks.length - 1;

        // Bridge context: first chunk uses the original previousText, last uses
        // original nextText, inner chunks use adjacent chunk text for continuity.
        // Skip text context for models that don't support it (e.g. eleven_v3).
        const chunkPrev = skipTextContext
          ? undefined
          : isFirst
            ? previousText
            : chunks[i - 1].slice(-500);
        const chunkNext = skipTextContext
          ? undefined
          : isLast
            ? nextText
            : chunks[i + 1].slice(0, 500);

        const speechParams = {
          text: chunks[i],
          voiceId,
          direction,
          speaker,
          previousText: chunkPrev,
          nextText: chunkNext,
          continuityIds: continuityIds.length > 0 ? continuityIds.slice(-3) : undefined,
          language: langHint,
        };

        if (supportsTimestamps) {
          const result = await provider.generateSpeechWithTimestamps!(speechParams);
          chunkBuffers.push(result.audio);

          // Offset word timings by cumulative duration of previous chunks
          for (const wt of result.wordTimings) {
            allWordTimings.push({
              word: wt.word,
              start: wt.start + cumulativeDuration,
              end: wt.end + cumulativeDuration,
            });
          }

          // Estimate chunk duration from word timings (last word's end time)
          if (result.wordTimings.length > 0) {
            cumulativeDuration = allWordTimings[allWordTimings.length - 1].end;
          }
        } else {
          chunkBuffers.push(await provider.generateSpeech(speechParams));
        }

        // Collect continuity ID for next chunk (if provider supports it)
        const contId = provider.getLastContinuityId?.();
        if (contId) continuityIds.push(contId);
      }

      // Concatenate chunk audio via FFmpeg (lossless concat demuxer)
      audioBuffer = await concatAudioBuffers(chunkBuffers);
      if (allWordTimings.length > 0) {
        wordTimings = allWordTimings;
      }
    }
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
      logger.warn('TTS 429 — concurrency limit cached, BullMQ will retry', {
        providerId,
        episodeId,
      });
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
      episodeId,
      error: err instanceof Error ? err.message : String(err),
    });
    segmentDuration = estimateDurationFromText(text);
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {});
  }

  // 9. Log TTS cost
  const charCount = text.length;
  const totalCost = (charCount / 1000) * meta.platformCostPerKChar;

  logUsage({
    service,
    category: usageCategory,
    inputTokens: charCount,
    totalCost,
    durationMs,
    episodeId,
    userId,
    metadata: { voiceId, speaker, source: effectiveSource, ...extraMetadata },
  });

  return { audioBuffer, segmentDuration, service, durationMs, wordTimings };
}

// ---------------------------------------------------------------------------
// FFmpeg concat for multi-chunk TTS audio
// ---------------------------------------------------------------------------

/**
 * Concatenate multiple audio buffers using FFmpeg's concat demuxer.
 * Each buffer is written to a temp file, concatenated losslessly, and cleaned up.
 */
async function concatAudioBuffers(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 1) return buffers[0];

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { readFile } = await import('fs/promises');
  const execFileAsync = promisify(execFile);

  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const chunkPaths: string[] = [];
  const concatListPath = path.join(tmpDir, `sotto-concat-${id}.txt`);
  const outputPath = path.join(tmpDir, `sotto-concat-${id}.mp3`);

  try {
    // Write each chunk to a temp file
    for (let i = 0; i < buffers.length; i++) {
      const chunkPath = path.join(tmpDir, `sotto-chunk-${id}-${i}.mp3`);
      await writeFile(chunkPath, buffers[i]);
      chunkPaths.push(chunkPath);
    }

    // Write concat demuxer list
    const listContent = chunkPaths.map((p) => `file '${p}'`).join('\n');
    await writeFile(concatListPath, listContent);

    // Concatenate — re-encode to ensure consistent format across chunks
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-ac',
      '1',
      outputPath,
    ]);

    return await readFile(outputPath);
  } finally {
    // Clean up all temp files
    const cleanups = [...chunkPaths, concatListPath, outputPath].map((p) =>
      rm(p, { force: true }).catch(() => {})
    );
    await Promise.all(cleanups);
  }
}
