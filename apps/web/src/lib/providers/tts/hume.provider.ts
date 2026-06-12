/**
 * Hume AI TTS provider — ultra-quality expressive voice generation via Octave.
 *
 * Expression support:
 *   - description: natural-language acting instructions per utterance (≤100 chars)
 *     e.g. "warm, inviting", "urgent, panicked", "sarcastic, dry"
 *   - speed: 0.5–2.0 (stable range 0.75–1.5)
 *   - trailing_silence: seconds of silence after utterance
 *   - Native text markers: [pause], [long pause]
 *   - Octave infers emotion from text content — description refines/overrides
 *   - Octave v1: acting instructions via description field
 *   - Octave v2: 2x faster, half price, 11 languages, word/phoneme timestamps — no acting instructions yet
 *
 * @tts-research-date 2026-03-21 — Added Octave v2 support (version param, skip description for v2)
 */
import { logger } from '../../logger';
import type { WordTiming } from '@sotto/shared';
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { HUME_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';
import { mapDirectionToExpression, convertInlineAudioTags } from '../../tts-expression-mapper';

// HOST/GUEST → host voice slot; EXPERT/SKEPTIC → expert slot.
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);
import type { VoiceMatchMetadata } from '../../voice-pool';

interface HumeTimestamp {
  word: string;
  start: number;
  end: number;
}

interface HumeTtsResponse {
  generations: Array<{
    audio: string; // base64
    duration: number;
    generation_id?: string;
    timestamps?: HumeTimestamp[];
  }>;
}

export class HumeProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'hume';
  private apiKey: string;
  private model: string;
  private lastGenerationId: string | null = null;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? 'octave-v2';
  }

  private get octaveVersion(): '1' | '2' {
    return this.model === 'octave-v1' ? '1' : '2';
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const isV1 = this.octaveVersion === '1';

    // Acting instructions + expression params only supported on Octave v1
    const expression = isV1
      ? mapDirectionToExpression(params.direction, params.speaker, 'hume')
      : undefined;
    const description = expression?.hume?.description;

    const utterance: Record<string, unknown> = {
      text: convertInlineAudioTags(params.text, 'hume'),
      voice: { id: params.voiceId },
      speed: expression?.hume?.speed ?? 1,
      trailing_silence: expression?.hume?.trailingSilence ?? 0.3,
    };

    if (description) {
      utterance.description = description;
    }

    // Cross-chunk continuity via previous_generation_id
    if (params.continuityIds?.[0]) {
      utterance.previous_generation_id = params.continuityIds[0];
    }

    const response = await fetch('https://api.hume.ai/v0/tts', {
      method: 'POST',
      headers: {
        'X-Hume-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        utterances: [utterance],
        format: { type: 'mp3' },
        version: this.octaveVersion,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Hume AI API error (${response.status}): ${errorText}`);
    }

    const data: HumeTtsResponse = await response.json();
    if (!data.generations?.length || !data.generations[0].audio) {
      throw new Error('Hume AI returned no audio data');
    }

    this.lastGenerationId = data.generations[0].generation_id ?? null;

    logger.info('Hume AI speech generated', {
      voiceId: params.voiceId,
      chars: params.text.length,
      version: this.octaveVersion,
      description: description ?? 'none',
    });
    return Buffer.from(data.generations[0].audio, 'base64');
  }

  async generateSpeechWithTimestamps(params: SpeechParams): Promise<{ audio: Buffer; wordTimings: WordTiming[] }> {
    const isV1 = this.octaveVersion === '1';

    const expression = isV1
      ? mapDirectionToExpression(params.direction, params.speaker, 'hume')
      : undefined;
    const description = expression?.hume?.description;

    const utterance: Record<string, unknown> = {
      text: convertInlineAudioTags(params.text, 'hume'),
      voice: { id: params.voiceId },
      speed: expression?.hume?.speed ?? 1,
      trailing_silence: expression?.hume?.trailingSilence ?? 0.3,
    };

    if (description) {
      utterance.description = description;
    }

    if (params.continuityIds?.[0]) {
      utterance.previous_generation_id = params.continuityIds[0];
    }

    const response = await fetch('https://api.hume.ai/v0/tts', {
      method: 'POST',
      headers: {
        'X-Hume-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        utterances: [utterance],
        format: { type: 'mp3' },
        version: this.octaveVersion,
        include_timestamp_types: ['word'],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Hume AI API error (${response.status}): ${errorText}`);
    }

    const data: HumeTtsResponse = await response.json();
    if (!data.generations?.length || !data.generations[0].audio) {
      throw new Error('Hume AI returned no audio data');
    }

    this.lastGenerationId = data.generations[0].generation_id ?? null;

    const wordTimings: WordTiming[] = (data.generations[0].timestamps ?? []).map((t) => ({
      word: t.word,
      start: t.start,
      end: t.end,
    }));

    logger.info('Hume AI speech with timestamps generated', {
      voiceId: params.voiceId,
      chars: params.text.length,
      version: this.octaveVersion,
      wordCount: String(wordTimings.length),
    });

    return {
      audio: Buffer.from(data.generations[0].audio, 'base64'),
      wordTimings,
    };
  }

  getLastContinuityId(): string | null {
    return this.lastGenerationId;
  }

  getVoiceId(speaker: string, episodeId?: string, metadata?: VoiceMatchMetadata, _language?: string): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!episodeId) {
      return isHostVoice ? HUME_VOICE_POOL[0].id : HUME_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(HUME_VOICE_POOL, episodeId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}

// ---------------------------------------------------------------------------
// Adaptive Concurrency
// ---------------------------------------------------------------------------

const DEFAULT_HUME_CONCURRENCY = 5;

/**
 * Resolve the concurrency limit for a Hume API key.
 * Returns a cached value from Redis if available, otherwise the conservative default (5).
 * Hume has no API endpoint to query the limit — we learn it from 429 errors.
 */
export async function getHumeConcurrencyLimit(apiKey: string): Promise<number> {
  const { cache } = await import('../../redis');
  const crypto = await import('crypto');
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  const cacheKey = `tts:concurrency:hume:${keyHash}`;

  const cached = await cache.get<number>(cacheKey);
  if (cached !== null) return cached;

  return DEFAULT_HUME_CONCURRENCY;
}

/**
 * Parse a Hume 429 error body for the concurrency limit and cache it.
 * Uses a generic regex to match any limit/concurrency number in the error.
 * If no number is found, caches (default - 1) with a short TTL to re-probe quickly.
 */
export async function updateHumeConcurrencyFromError(apiKey: string, errorMessage: string): Promise<void> {
  try {
    const { cache } = await import('../../redis');
    const crypto = await import('crypto');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
    const cacheKey = `tts:concurrency:hume:${keyHash}`;

    const match = errorMessage.match(/(?:limit|concurr\w*)\D*(\d+)/i);
    if (match) {
      const limit = parseInt(match[1], 10);
      if (!isNaN(limit) && limit >= 1 && limit <= 100) {
        await cache.set(cacheKey, limit, 300);
        logger.info('Hume concurrency limit detected from 429', { limit });
        return;
      }
    }

    // No parseable limit — cache a reduced default with short TTL to re-probe quickly
    await cache.set(cacheKey, DEFAULT_HUME_CONCURRENCY - 1, 60);
    logger.info('Hume 429 without parseable limit, reducing default', { newLimit: DEFAULT_HUME_CONCURRENCY - 1 });
  } catch {
    // Swallow Redis errors — original 429 still propagates via BullMQ retry
  }
}
