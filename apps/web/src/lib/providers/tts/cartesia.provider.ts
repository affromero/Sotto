/**
 * Cartesia TTS provider — premium voice generation via Sonic 3.
 *
 * Expression support:
 *   - generation_config.emotion: 60 emotion values (excited, calm, sarcastic, etc.)
 *   - generation_config.speed: 0.6–1.5 multiplier
 *   - Inline SSML: <emotion value="..."/>, <break time="..."/>, <speed ratio="..."/>
 *   - Native [laughter] marker in transcript text
 *   - Emotion is guidance, not strict — works best when text aligns with emotion
 *
 * API docs: https://docs.cartesia.ai/api-reference/tts/bytes
 * @tts-research-date 2026-02-27 — Sonic 3 generation_config, SSML tags, [laughter]
 */
import { logger } from '../../logger';
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { CARTESIA_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';
import { mapDirectionToExpression, convertInlineAudioTags } from '../../tts-expression-mapper';
import { applyPronunciationAliases } from '../../pronunciation-dictionary';

const CARTESIA_API_VERSION = '2025-04-16';

// HOST/GUEST → host voice slot; EXPERT/SKEPTIC → expert slot.
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);
import type { VoiceMatchMetadata } from '../../voice-pool';

export class CartesiaProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'cartesia';
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || process.env.CARTESIA_API_KEY;
    if (!key) throw new Error('Cartesia requires an API key (BYOK or CARTESIA_API_KEY env var)');
    this.apiKey = key;
    this.model = model ?? 'sonic-3';
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    // Map direction to Cartesia emotion
    const expression = mapDirectionToExpression(params.direction, params.speaker, 'cartesia');
    const emotion = expression.cartesia?.emotion;

    const body: Record<string, unknown> = {
      transcript: convertInlineAudioTags(applyPronunciationAliases(params.text), 'cartesia'),
      model_id: this.model,
      voice: { mode: 'id', id: params.voiceId },
      output_format: {
        container: 'mp3',
        bit_rate: 192000,
        sample_rate: 44100,
      },
    };

    // Pass language hint to Cartesia API when available
    if (params.language) {
      body.language = params.language;
    }

    // Add generation_config with emotion, speed, and/or volume if available
    const speed = expression.cartesia?.speed;
    const volume = expression.cartesia?.volume;
    if (emotion || speed || volume) {
      body.generation_config = {
        ...(emotion && { emotion }),
        ...(speed && { speed }),
        ...(volume && { volume }),
      };
    }

    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Cartesia-Version': CARTESIA_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cartesia API error (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    logger.info('Cartesia speech generated', {
      model: this.model,
      voiceId: params.voiceId,
      chars: params.text.length,
      emotion: emotion ?? 'none',
    });
    return Buffer.from(arrayBuffer);
  }

  getVoiceId(speaker: string, episodeId?: string, metadata?: VoiceMatchMetadata, _language?: string): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!episodeId) {
      return isHostVoice ? CARTESIA_VOICE_POOL[0].id : CARTESIA_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(CARTESIA_VOICE_POOL, episodeId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}

// ---------------------------------------------------------------------------
// Adaptive Concurrency
// ---------------------------------------------------------------------------

const DEFAULT_CARTESIA_CONCURRENCY = 2;

/**
 * Resolve the concurrency limit for a Cartesia API key.
 * Returns a cached value from Redis if available, otherwise the conservative default (2).
 * Unlike ElevenLabs, Cartesia has no API endpoint to query the limit — we learn it from 429 errors.
 */
export async function getCartesiaConcurrencyLimit(apiKey: string): Promise<number> {
  const { cache } = await import('../../redis');
  const crypto = await import('crypto');
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  const cacheKey = `tts:concurrency:cartesia:${keyHash}`;

  const cached = await cache.get<number>(cacheKey);
  if (cached !== null) return cached;

  return DEFAULT_CARTESIA_CONCURRENCY;
}

/**
 * Parse a Cartesia 429 error body for the actual concurrency limit and cache it.
 * Cartesia's 429 response includes "Current limit: N" — we extract and cache that value.
 */
export async function updateCartesiaConcurrencyFromError(apiKey: string, errorMessage: string): Promise<void> {
  try {
    const match = errorMessage.match(/Current limit:\s*(\d+)/i);
    if (!match) return;
    const limit = parseInt(match[1], 10);
    if (isNaN(limit) || limit <= 0) return;

    const { cache } = await import('../../redis');
    const crypto = await import('crypto');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
    await cache.set(`tts:concurrency:cartesia:${keyHash}`, limit, 300);
    logger.info('Cartesia concurrency limit detected from 429', { limit });
  } catch {
    // Swallow Redis errors — original 429 still propagates via BullMQ retry
  }
}
