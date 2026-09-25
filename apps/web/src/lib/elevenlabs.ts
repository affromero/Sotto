import { logger } from './logger';
import { detectAudioFormat, isRecognizedAudio } from './audio-format';
import { constants as bufferConstants } from 'node:buffer';
import { getProviderMeta } from './providers/tts-registry';
import type { ProviderTransport } from 'thesidedoor-core/providers/transport';
import { abortable, readResponseBytes, readResponseText } from 'thesidedoor-core/runtime/stream';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

// ---------------------------------------------------------------------------
// Text-to-Speech
// ---------------------------------------------------------------------------

export async function generateSpeech(params: {
  text: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
  seed?: number;
  apiKey: string;
  transport: ProviderTransport;
  signal?: AbortSignal;
  previousText?: string;
  nextText?: string;
  previousRequestIds?: string[];
  /** ISO 639-1 language hint (e.g. 'es', 'ja'). Passed as language_code to ElevenLabs API. */
  language?: string;
  onDispatch?: () => void;
  onSettled?: () => void;
}): Promise<{ audio: Buffer; requestId: string | null }> {
  const apiKey = params.apiKey;
  if (!apiKey) {
    throw new Error('No ElevenLabs credential is saved');
  }

  const meta = getProviderMeta('elevenlabs');
  const modelId = params.modelId || meta.defaultModel;
  const skipTextContext = meta.modelsWithoutTextContext.includes(modelId);

  const stability = params.stability ?? 0.5;

  const body: Record<string, unknown> = {
    text: params.text,
    model_id: modelId,
    voice_settings: {
      stability,
      similarity_boost: params.similarityBoost ?? 0.85,
      // style 0.0 per ElevenLabs recommendation — higher values add latency and instability
      style: params.style ?? 0.0,
      use_speaker_boost: true,
      ...(params.speed && { speed: params.speed }),
    },
  };

  if (params.seed != null) {
    body.seed = params.seed;
  }

  if (params.language) {
    body.language_code = params.language;
  }

  if (skipTextContext) {
    // eleven_v3 rejects both previous_text/next_text AND previous_request_ids.
    // No cross-chunk continuity is available — chunks are generated independently.
  } else {
    if (params.previousText) body.previous_text = params.previousText;
    if (params.nextText) body.next_text = params.nextText;
  }

  const response = await params.transport.authenticatedFetch(
    `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(params.voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      signal: params.signal,
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    },
    {
      onDispatch: params.onDispatch ?? (() => {}),
      onConsumed: ({ status }) => {
        if (status < 500) params.onSettled?.();
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  params.signal?.throwIfAborted();
  return {
    audio: Buffer.from(arrayBuffer),
    requestId: response.headers.get('request-id'),
  };
}

// ---------------------------------------------------------------------------
// Text-to-Speech with Word Timestamps
// ---------------------------------------------------------------------------

interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface WordTimingResult {
  word: string;
  start: number;
  end: number;
}

/**
 * Convert character-level alignment data to word-level timings.
 * Groups consecutive non-whitespace characters into words and uses the
 * first character's start time and last character's end time for each word.
 */
export function characterTimingsToWordTimings(alignment: ElevenLabsAlignment): WordTimingResult[] {
  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;
  const words: WordTimingResult[] = [];

  let currentWord = '';
  let wordStart = 0;
  let wordEnd = 0;

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];

    if (char === ' ' || char === '\n' || char === '\t') {
      // Whitespace — flush current word
      if (currentWord.length > 0) {
        words.push({ word: currentWord, start: wordStart, end: wordEnd });
        currentWord = '';
      }
    } else {
      if (currentWord.length === 0) {
        // Starting a new word
        wordStart = character_start_times_seconds[i];
      }
      currentWord += char;
      wordEnd = character_end_times_seconds[i];
    }
  }

  // Flush final word
  if (currentWord.length > 0) {
    words.push({ word: currentWord, start: wordStart, end: wordEnd });
  }

  return words;
}

/**
 * Generate speech with word-level timestamps using ElevenLabs' with-timestamps endpoint.
 * Returns both the audio buffer and word timings.
 */
export async function generateSpeechWithTimestamps(params: {
  text: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
  seed?: number;
  apiKey: string;
  transport: ProviderTransport;
  signal?: AbortSignal;
  previousText?: string;
  nextText?: string;
  previousRequestIds?: string[];
  language?: string;
  onDispatch?: () => void;
  onSettled?: () => void;
}): Promise<{ audio: Buffer; wordTimings: WordTimingResult[]; requestId: string | null }> {
  const apiKey = params.apiKey;
  if (!apiKey) {
    throw new Error('No ElevenLabs credential is saved');
  }

  const meta = getProviderMeta('elevenlabs');
  const modelId = params.modelId || meta.defaultModel;
  const skipTextContext = meta.modelsWithoutTextContext.includes(modelId);

  const stability = params.stability ?? 0.5;

  const body: Record<string, unknown> = {
    text: params.text,
    model_id: modelId,
    voice_settings: {
      stability,
      similarity_boost: params.similarityBoost ?? 0.85,
      style: params.style ?? 0.0,
      use_speaker_boost: true,
      ...(params.speed && { speed: params.speed }),
    },
  };

  if (params.seed != null) {
    body.seed = params.seed;
  }

  if (params.language) {
    body.language_code = params.language;
  }

  if (!skipTextContext) {
    if (params.previousText) body.previous_text = params.previousText;
    if (params.nextText) body.next_text = params.nextText;
  }

  const response = await params.transport.authenticatedFetch(
    `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(params.voiceId)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: 'POST',
      signal: params.signal,
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    },
    {
      onDispatch: params.onDispatch ?? (() => {}),
      onConsumed: ({ status }) => {
        if (status < 500) params.onSettled?.();
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    audio_base64: string;
    alignment: ElevenLabsAlignment;
  };

  const audio = Buffer.from(data.audio_base64, 'base64');
  params.signal?.throwIfAborted();
  const wordTimings = characterTimingsToWordTimings(data.alignment);

  return {
    audio,
    wordTimings,
    requestId: response.headers.get('request-id'),
  };
}

// ---------------------------------------------------------------------------
// Sound Effects — generate ambient audio, transitions, intros
// ---------------------------------------------------------------------------

export async function generateSoundEffect(params: {
  prompt: string;
  durationSeconds?: number;
  apiKey: string;
  transport: ProviderTransport;
  signal?: AbortSignal;
  onDispatch?: () => void;
  onSettled?: () => void;
}): Promise<Buffer> {
  const onSettled = params.onSettled;
  params.signal?.throwIfAborted();
  const apiKey = params.apiKey;
  if (!apiKey?.trim()) throw new Error('ElevenLabs API key is not set');

  const body: Record<string, unknown> = { text: params.prompt };
  if (params.durationSeconds) {
    body.duration_seconds = Math.min(params.durationSeconds, 30);
  }

  const signal = params.signal ?? new AbortController().signal;
  const response = await params.transport.authenticatedFetch(
    `${ELEVENLABS_BASE_URL}/sound-generation`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
      signal,
    },
    params.onDispatch ? { onDispatch: params.onDispatch } : undefined
  );

  if (!response.ok) {
    const errorText = await readResponseText(response, {
      signal,
      maxBytes: bufferConstants.MAX_LENGTH,
    });
    // Documented synchronous request rejections, not a general rule for provider HTTP failures.
    // https://elevenlabs.io/docs/eleven-api/resources/errors
    if ([400, 401, 402, 403, 404, 422, 429].includes(response.status)) onSettled?.();
    throw new Error(`ElevenLabs Sound Effects API error (${response.status}): ${errorText}`);
  }

  const bytes = await readResponseBytes(response, { signal, maxBytes: bufferConstants.MAX_LENGTH });
  const audio = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    response.status !== 200 ||
    !isRecognizedAudio(audio) ||
    detectAudioFormat(audio).ext !== 'mp3'
  )
    throw new Error('ElevenLabs sound effects returned an unexpected synchronous audio response');
  onSettled?.();
  logger.info('Sound effect generated', {
    prompt: params.prompt,
    durationSeconds: String(params.durationSeconds ?? 'auto'),
  });
  return audio;
}

// ---------------------------------------------------------------------------
// Subscription Concurrency
// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 2;

/**
 * Query the ElevenLabs API and read the `maximum-concurrent-requests` response
 * header to determine the concurrency limit for the given API key.
 * Caches the result in Redis for 5 minutes so plan upgrades are picked up quickly.
 */
export async function getElevenLabsConcurrencyLimit(
  apiKey: string,
  transport: ProviderTransport,
  signal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  const { cache } = await import('./redis');
  const crypto = await import('crypto');
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  const cacheKey = `elevenlabs:concurrency:${keyHash}`;

  const cached = await cache.get<number>(cacheKey);
  signal?.throwIfAborted();
  if (cached !== null) return cached;

  const response = await transport.authenticatedFetch(`${ELEVENLABS_BASE_URL}/user/subscription`, {
    headers: { 'xi-api-key': apiKey },
    signal,
  });
  const failure = response.ok
    ? null
    : new Error(`ElevenLabs subscription error (${response.status})`);
  try {
    if (response.body) await abortable(response.body.cancel(), AbortSignal.timeout(1_000));
  } catch (cleanup) {
    if (failure) throw new AggregateError([failure, cleanup], failure.message, { cause: cleanup });
    throw cleanup;
  }
  if (failure) throw failure;
  signal?.throwIfAborted();
  const maxConcurrent = response.headers.get('maximum-concurrent-requests');
  const limit = maxConcurrent === null ? DEFAULT_CONCURRENCY : Number(maxConcurrent);
  if (
    (maxConcurrent !== null && !/^[1-9]\d*$/.test(maxConcurrent)) ||
    !Number.isSafeInteger(limit) ||
    limit <= 0
  )
    throw new Error('Invalid ElevenLabs concurrency limit');
  await cache.set(cacheKey, limit, 300);
  signal?.throwIfAborted();
  logger.info('ElevenLabs concurrency resolved from API header', { limit });
  return limit;
}

// ---------------------------------------------------------------------------
// Cost Tracking
// ---------------------------------------------------------------------------

/**
 * Get the OpenAI TTS cost per 1,000 characters.
 * tts-1-hd: $15/1M chars = $0.015/1K chars
 */
export function getOpenAiPerKCharRate(): number {
  return 0.015;
}
