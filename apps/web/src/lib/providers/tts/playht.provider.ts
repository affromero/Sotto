/**
 * PlayHT TTS provider — premium voice generation.
 */
import { logger } from '../../logger';
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { PLAYHT_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';

export class PlayHTProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'playht';
  private apiKey: string;
  private userId: string;

  constructor(apiKey: string, userId: string) {
    this.apiKey = apiKey;
    this.userId = userId;
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const response = await fetch('https://api.play.ht/api/v2/tts/stream', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'X-USER-ID': this.userId,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: params.text,
        voice: params.voiceId,
        output_format: 'mp3',
        quality: 'premium',
        speed: 1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PlayHT API error (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    logger.info('PlayHT speech generated', { voiceId: params.voiceId, chars: params.text.length });
    return Buffer.from(arrayBuffer);
  }

  getVoiceId(speaker: 'HOST' | 'EXPERT', podcastId?: string): string {
    if (!podcastId) {
      return speaker === 'HOST' ? PLAYHT_VOICE_POOL[0].id : PLAYHT_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(PLAYHT_VOICE_POOL, podcastId);
    return speaker === 'HOST' ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return 'premium';
  }
}
