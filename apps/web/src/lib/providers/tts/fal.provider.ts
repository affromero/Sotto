/**
 * Fal.ai TTS provider — Qwen3-TTS open-source voice generation.
 * No expression/emotion controls — relies on text content for prosody.
 *
 * Models:
 *   - qwen3-tts-1.7b / qwen3-tts-0.6b: Named preset voices + voice cloning
 */
import { logger } from '../../logger';
import type { TtsProvider, SpeechParams } from '../tts';
import { getProviderMeta, type TtsProviderId } from '../tts-registry';
import { FAL_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';

// HOST/GUEST → host voice slot; EXPERT/SKEPTIC → expert slot.
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);
import type { VoiceMatchMetadata } from '../../voice-pool';

interface FalTtsResponse {
  audio: { url: string; duration: number; sample_rate: number };
}

/** Full endpoint URLs per model. */
const MODEL_ENDPOINTS: Record<string, string> = {
  'qwen3-tts-1.7b': 'https://fal.run/fal-ai/qwen-3-tts/text-to-speech/1.7b',
  'qwen3-tts-0.6b': 'https://fal.run/fal-ai/qwen-3-tts/text-to-speech/0.6b',
};

export class FalProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'fal';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? getProviderMeta('fal').defaultModel;
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const url = MODEL_ENDPOINTS[this.model] ?? MODEL_ENDPOINTS['qwen3-tts-1.7b'];
    const isClonedVoice = params.voiceId.startsWith('https://');

    // Qwen3 uses { text, voice } or { text, speaker_voice_embedding_file_url }
    const body: Record<string, unknown> = { text: params.text };
    if (isClonedVoice) {
      body.speaker_voice_embedding_file_url = params.voiceId;
    } else {
      body.voice = params.voiceId;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fal API error (${response.status}): ${errorText}`);
    }

    const data: FalTtsResponse = await response.json();
    if (!data.audio?.url) {
      throw new Error('Fal returned no audio URL');
    }

    const audioResponse = await fetch(data.audio.url);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download Fal audio: ${audioResponse.status}`);
    }

    logger.info('Fal speech generated', { model: this.model, voiceId: params.voiceId, chars: params.text.length });
    const arrayBuffer = await audioResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  getVoiceId(speaker: string, podcastId?: string, metadata?: VoiceMatchMetadata): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!podcastId) {
      return isHostVoice ? FAL_VOICE_POOL[0].id : FAL_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(FAL_VOICE_POOL, podcastId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
