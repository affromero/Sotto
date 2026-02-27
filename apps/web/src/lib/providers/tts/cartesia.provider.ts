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
import { mapDirectionToExpression } from '../../tts-expression-mapper';

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
      transcript: params.text,
      model_id: this.model,
      voice: { mode: 'id', id: params.voiceId },
      output_format: {
        container: 'mp3',
        bit_rate: 128000,
        sample_rate: 44100,
      },
    };

    // Add generation_config with emotion if available
    if (emotion) {
      body.generation_config = { emotion };
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

  getVoiceId(speaker: string, podcastId?: string, metadata?: VoiceMatchMetadata): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!podcastId) {
      return isHostVoice ? CARTESIA_VOICE_POOL[0].id : CARTESIA_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(CARTESIA_VOICE_POOL, podcastId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
