/**
 * Shared TTS generation core — used by the listening audio pipeline.
 *
 * Handles: captured provider concurrency → semaphore acquire/release →
 * text cleaning → generateSpeech (full params) → provider errors → 429 concurrency
 * update → FFprobe duration measurement → usage logging.
 *
 * Does NOT handle: DB reads/writes, provider resolution, voice assignment,
 * R2 upload, stitching queue — those stay in each worker.
 */
import type { WordTiming } from '@sotto/shared';
import type { TtsProvider } from '@/lib/providers/tts';
import { getProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { openSottoSemaphore } from '@/lib/sidedoor/jobs/core/redis-semaphore';
import { cleanTextForTts, splitTextForTts } from '@/lib/tts-text-cleaner';
import { concatenateTtsAudio, measureTtsAudio } from '@/lib/audio/tts-media';
import { estimateDurationFromText } from '@/lib/duration';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';
import { rethrowMediaInterruption } from '@/lib/audio/media-process';

export interface TtsGenerationParams {
  signal?: AbortSignal;
  executionDirectory?: string;
  onDispatch?: () => void;
  onSettled?: () => void;
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
  source: 'credential' | 'local';

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
  /** Provider identifier used for analytics. */
  service: string;
  /** Wall-clock time in ms. */
  durationMs: number;
  /** Word-level timestamps from the TTS provider or STT fallback, null when unavailable. */
  wordTimings: WordTiming[] | null;
}

/**
 * Execute TTS generation with semaphore-controlled concurrency, explicit provider errors,
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
    usageCategory,
    extraMetadata,
    isAborted,
  } = params;

  const langHint = language ?? undefined;

  const startTime = Date.now();

  params.signal?.throwIfAborted();
  const concurrencyLimit = provider.getConcurrencyLimit
    ? await provider.getConcurrencyLimit(params.signal)
    : providerId === 'replicate'
      ? 1
      : 5;

  const semaphoreKey = `tts:sem:${userId}:${providerId}`;

  logger.info('Using TTS provider', {
    speaker,
    providerId,
    source,
    voiceId,
    episodeId,
    concurrencyLimit,
  });

  const meta = getProviderMeta(providerId);
  let audioBuffer: Buffer;
  let wordTimings: WordTiming[] | null = null;
  // 3. Acquire one exact-token provider slot. The dedicated session never replays commands.
  const capacity = await openSottoSemaphore({
    resource: semaphoreKey,
    limit: concurrencyLimit,
    ttlMs: 120_000,
  });
  let parentStopped = false;
  const acquired = await capacity.wait({
    signal: params.signal,
    delaysMs: Array.from({ length: 29 }, (_, attempt) =>
      Math.round(Math.min(1000 * Math.pow(1.5, attempt), 15_000))
    ),
    shouldStop: async () => {
      parentStopped = await isAborted();
      return parentStopped;
    },
  });

  if (!acquired) {
    if (parentStopped) {
      logger.info('Parent entity failed while waiting for semaphore, aborting', { episodeId });
      return null;
    }
    throw new Error(
      `Timed out waiting for TTS semaphore (${providerId}, limit ${concurrencyLimit})`
    );
  }

  let primaryFailure: unknown;
  let failed = false;
  try {
    params.signal?.throwIfAborted();
    // 4. Clean text and split into chunks if it exceeds provider char limit
    const ttsText = cleanTextForTts(text);
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

    const supportsTimestamps = typeof provider.generateSpeechWithTimestamps === 'function';
    try {
      if (chunks.length === 1) {
        // Fast path — single chunk, no splitting needed
        const speechParams = {
          signal: params.signal,
          text: ttsText,
          voiceId,
          previousText,
          nextText,
          direction,
          speaker,
          language: langHint,
          onDispatch: params.onDispatch,
          onSettled: params.onSettled,
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
            signal: params.signal,
            text: chunks[i],
            voiceId,
            direction,
            speaker,
            previousText: chunkPrev,
            nextText: chunkNext,
            continuityIds: continuityIds.length > 0 ? continuityIds.slice(-3) : undefined,
            language: langHint,
            onDispatch: params.onDispatch,
            onSettled: params.onSettled,
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
        audioBuffer = await concatenateTtsAudio(chunkBuffers, {
          signal: params.signal,
          directory: params.executionDirectory,
        });
        if (allWordTimings.length > 0) {
          wordTimings = allWordTimings;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // 5. On 429, update cached concurrency limit
      if (provider.observeConcurrencyError && /\(429\)/.test(errMsg)) {
        try {
          await provider.observeConcurrencyError(errMsg, params.signal);
        } catch (observationError) {
          try {
            rethrowMediaInterruption(observationError, params.signal);
          } catch {
            throw new AggregateError(
              [err, observationError],
              'TTS generation and concurrency observation failed',
              { cause: err }
            );
          }
          logger.warn('TTS concurrency observation failed', {
            providerId,
            error:
              observationError instanceof Error
                ? observationError.message
                : String(observationError),
          });
        }
        logger.warn('TTS provider rate limit rejected generation', {
          providerId,
          episodeId,
        });
      }
      throw err;
    }
  } catch (error) {
    failed = true;
    primaryFailure = error;
    throw error;
  } finally {
    try {
      await capacity.release();
    } catch (releaseError) {
      throw new AggregateError(
        failed ? [primaryFailure, releaseError] : [releaseError],
        'TTS semaphore release could not be confirmed',
        { cause: releaseError }
      );
    }
  }

  const service = providerId;
  const durationMs = Date.now() - startTime;

  // 8. Measure audio duration via FFprobe
  let segmentDuration: number;
  try {
    segmentDuration = await measureTtsAudio(audioBuffer, {
      signal: params.signal,
      directory: params.executionDirectory,
    });
  } catch (err) {
    rethrowMediaInterruption(err, params.signal);
    logger.warn('FFprobe duration extraction failed, estimating from text length', {
      episodeId,
      error: err instanceof Error ? err.message : String(err),
    });
    segmentDuration = estimateDurationFromText(text);
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
    metadata: { voiceId, speaker, source, ...extraMetadata },
  });

  return { audioBuffer, segmentDuration, service, durationMs, wordTimings };
}
