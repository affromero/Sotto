/**
 * Cartesia TTS provider — premium voice generation via Sonic 3.
 *
 * API docs: https://docs.cartesia.ai/api-reference/tts/bytes
 * Sonic 3 supports [laughter] markers natively in transcript text.
 */
import { logger } from '../../logger';
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { CARTESIA_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';

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
    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Cartesia-Version': CARTESIA_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcript: params.text,
        model_id: this.model,
        voice: { mode: 'id', id: params.voiceId },
        output_format: {
          container: 'mp3',
          bit_rate: 128000,
          sample_rate: 44100,
        },
      }),
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
