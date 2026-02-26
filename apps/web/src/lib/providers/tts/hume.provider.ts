/**
 * Hume AI TTS provider — ultra-quality expressive voice generation.
 */
import { logger } from '../../logger';
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { HUME_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';

// HOST/GUEST → host voice slot; EXPERT/SKEPTIC → expert slot.
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);
import type { VoiceMatchMetadata } from '../../voice-pool';

interface HumeTtsResponse {
  generations: Array<{
    audio: string; // base64
    duration: number;
  }>;
}

export class HumeProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'hume';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? 'octave';
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const response = await fetch('https://api.hume.ai/v0/tts', {
      method: 'POST',
      headers: {
        'X-Hume-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        utterances: [
          {
            text: params.text,
            voice: { id: params.voiceId },
            speed: 1,
          },
        ],
        format: { type: 'mp3' },
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

    logger.info('Hume AI speech generated', { voiceId: params.voiceId, chars: params.text.length });
    return Buffer.from(data.generations[0].audio, 'base64');
  }

  getVoiceId(speaker: string, podcastId?: string, metadata?: VoiceMatchMetadata): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!podcastId) {
      return isHostVoice ? HUME_VOICE_POOL[0].id : HUME_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(HUME_VOICE_POOL, podcastId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
