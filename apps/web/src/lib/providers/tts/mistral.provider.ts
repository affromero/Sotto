/**
 * Mistral AI TTS provider — Voxtral text-to-speech via the Mistral API.
 *
 * Supports preset voices (voice_id) and zero-shot voice cloning (ref_audio).
 * Response is base64-encoded audio in the requested format.
 *
 * API: POST https://api.mistral.ai/v1/audio/speech
 * Docs: https://docs.mistral.ai/capabilities/audio/text_to_speech/speech
 */
import { logger } from '../../logger';
import type { TtsProvider, SpeechParams } from '../tts';
import { getProviderMeta, type TtsProviderId } from '../tts-registry';
import { convertInlineAudioTags } from '../../tts-expression-mapper';
import { MISTRAL_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';

// HOST/GUEST → host voice slot; EXPERT/SKEPTIC → expert slot.
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);
import type { VoiceMatchMetadata } from '../../voice-pool';

interface MistralTtsResponse {
  audio_data: string; // base64-encoded audio
}

export class MistralProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'mistral';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? getProviderMeta('mistral').defaultModel;
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const isClonedVoice = params.voiceId.startsWith('data:') || params.voiceId.startsWith('http');

    const cleanedText = convertInlineAudioTags(params.text, 'mistral');

    const body: Record<string, unknown> = {
      model: this.model,
      input: cleanedText,
      response_format: 'mp3',
    };

    if (isClonedVoice && params.voiceId.startsWith('http')) {
      // Fetch remote audio and convert to base64 for ref_audio
      const audioRes = await fetch(params.voiceId);
      if (!audioRes.ok) {
        throw new Error(`Failed to fetch reference audio: ${audioRes.status}`);
      }
      const audioBuffer = await audioRes.arrayBuffer();
      body.ref_audio = Buffer.from(audioBuffer).toString('base64');
    } else if (isClonedVoice) {
      // Already base64 data URI — strip prefix
      body.ref_audio = params.voiceId.replace(/^data:[^;]+;base64,/, '');
    } else {
      body.voice_id = params.voiceId;
    }

    const response = await fetch('https://api.mistral.ai/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mistral TTS API error (${response.status}): ${errorText}`);
    }

    const data: MistralTtsResponse = await response.json();
    if (!data.audio_data) {
      throw new Error('Mistral returned no audio_data');
    }

    logger.info('Mistral speech generated', { voiceId: params.voiceId, chars: cleanedText.length });
    return Buffer.from(data.audio_data, 'base64');
  }

  getVoiceId(speaker: string, podcastId?: string, metadata?: VoiceMatchMetadata, _language?: string): string {
    const pair = selectVoicePairFromPool(MISTRAL_VOICE_POOL, podcastId ?? 'default', metadata);
    const isHost = SPEAKER_VOICE_HOST_SET.has(speaker);
    return isHost ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
