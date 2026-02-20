/**
 * Cartesia TTS provider — premium voice generation.
 */
import { logger } from '../../logger';
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { CARTESIA_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';
import type { VoiceMatchMetadata } from '../../voice-pool';

export class CartesiaProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'cartesia';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? 'sonic-2';
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Cartesia-Version': '2024-06-10',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcript: params.text,
        model_id: this.model,
        voice: { mode: 'id', id: params.voiceId },
        output_format: {
          container: 'mp3',
          encoding: 'mp3',
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
      voiceId: params.voiceId,
      chars: params.text.length,
    });
    return Buffer.from(arrayBuffer);
  }

  getVoiceId(speaker: string, podcastId?: string, metadata?: VoiceMatchMetadata): string {
    if (!podcastId) {
      return speaker === 'HOST' ? CARTESIA_VOICE_POOL[0].id : CARTESIA_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(CARTESIA_VOICE_POOL, podcastId, metadata);
    return speaker === 'HOST' ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
