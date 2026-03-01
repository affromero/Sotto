/**
 * MiniMax Speech-02 HD TTS provider — #1 ranked on Speech Arena.
 * Accessed via Fal.ai infrastructure (shares FAL_KEY).
 * Supports 17 preset voices, 7 emotions, speed/pitch control.
 *
 * @tts-research-date 2026-03-01 — MiniMax Speech-02 HD via Fal API
 */
import { logger } from '../../logger';
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { MINIMAX_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';
import { mapDirectionToExpression } from '../../tts-expression-mapper';

// HOST/GUEST → host voice slot; EXPERT/SKEPTIC → expert slot.
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);
import type { VoiceMatchMetadata } from '../../voice-pool';

interface MinimaxTtsResponse {
  audio: { url: string; content_type: string; file_name: string; file_size: number };
}

const MODEL_ENDPOINTS: Record<string, string> = {
  'speech-02-hd': 'fal-ai/minimax/speech-02-hd',
  'speech-02-turbo': 'fal-ai/minimax/speech-02-turbo',
};

export class MinimaxProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'minimax';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? 'speech-02-hd';
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const endpoint = MODEL_ENDPOINTS[this.model] ?? MODEL_ENDPOINTS['speech-02-hd'];

    const body: Record<string, unknown> = {
      text: params.text,
      voice_id: params.voiceId,
      sample_rate: 32000,
      format: 'mp3',
    };

    // Map direction to MiniMax emotion
    if (params.direction || params.speaker) {
      const expression = mapDirectionToExpression(params.direction, params.speaker, 'minimax');
      if (expression.minimax?.emotion) {
        body.emotion = expression.minimax.emotion;
      }
    }

    const response = await fetch(`https://fal.run/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiniMax API error (${response.status}): ${errorText}`);
    }

    const data: MinimaxTtsResponse = await response.json();
    if (!data.audio?.url) {
      throw new Error('MiniMax returned no audio URL');
    }

    const audioResponse = await fetch(data.audio.url);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download MiniMax audio: ${audioResponse.status}`);
    }

    logger.info('MiniMax speech generated', { voiceId: params.voiceId, chars: params.text.length });
    const arrayBuffer = await audioResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  getVoiceId(speaker: string, podcastId?: string, metadata?: VoiceMatchMetadata): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!podcastId) {
      return isHostVoice ? MINIMAX_VOICE_POOL[0].id : MINIMAX_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(MINIMAX_VOICE_POOL, podcastId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
