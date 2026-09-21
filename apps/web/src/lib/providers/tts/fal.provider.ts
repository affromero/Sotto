/**
 * Fal.ai TTS provider — Qwen3-TTS open-source voice generation.
 * No expression/emotion controls — relies on text content for prosody.
 *
 * Models:
 *   - qwen3-tts-1.7b / qwen3-tts-0.6b: Named preset voices
 */
import { logger } from '../../logger';
import { settleSynchronousProviderResponse, type TtsProvider, type SpeechParams } from '../tts';
import { getProviderMeta, type TtsProviderId } from '../tts-registry';
import { FAL_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';
import { VOICE_LANGUAGE_AFFINITIES } from '../../tts-language-support';

// HOST/GUEST → host voice slot; EXPERT/SKEPTIC → expert slot.
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);
import type { VoiceMatchMetadata } from '../../voice-pool';
import type { MediaTransport, ProviderTransport } from 'thesidedoor-core/providers/transport';

interface FalTtsResponse {
  audio: { url: string; duration: number; sample_rate: number };
}

/** Full endpoint URLs per model. */
const MODEL_ENDPOINTS: Record<string, string> = {
  'qwen3-tts-1.7b': 'https://fal.run/fal-ai/qwen-3-tts/text-to-speech/1.7b',
  'qwen3-tts-0.6b': 'https://fal.run/fal-ai/qwen-3-tts/text-to-speech/0.6b',
};

/** ISO 639-1 → Qwen3 language name mapping (Qwen3 expects full language names). */
const QWEN3_LANGUAGE_MAP: Record<string, string> = {
  zh: 'Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
};

export class FalProvider implements TtsProvider {
  static readonly speechEndpoints = Object.freeze(Object.values(MODEL_ENDPOINTS));
  readonly providerId: TtsProviderId = 'fal';
  private apiKey: string;
  private model: string;

  constructor(
    apiKey: string,
    private readonly transport: ProviderTransport,
    private readonly media: MediaTransport,
    model?: string
  ) {
    this.apiKey = apiKey;
    this.model = model ?? getProviderMeta('fal').defaultModel;
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const url = MODEL_ENDPOINTS[this.model] ?? MODEL_ENDPOINTS['qwen3-tts-1.7b'];

    const body: Record<string, unknown> = { text: params.text, voice: params.voiceId };

    // Pass language hint when available (Qwen3 expects full language names)
    if (params.language) {
      const langName = QWEN3_LANGUAGE_MAP[params.language];
      if (langName) body.language = langName;
    }

    const response = await this.transport.authenticatedFetch(
      url,
      {
        method: 'POST',
        signal: params.signal,
        headers: {
          Authorization: `Key ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      {
        onDispatch: params.onDispatch ?? (() => {}),
        onConsumed: settleSynchronousProviderResponse(params.onSettled),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fal API error (${response.status}): ${errorText}`);
    }

    const data: FalTtsResponse = await response.json();
    if (!data.audio?.url) {
      throw new Error('Fal returned no audio URL');
    }

    const audio = await this.media.downloadMedia(data.audio.url, { signal: params.signal });

    logger.info('Fal speech generated', {
      model: this.model,
      voiceId: params.voiceId,
      chars: params.text.length,
    });
    return Buffer.from(audio);
  }

  getVoiceId(
    speaker: string,
    episodeId?: string,
    metadata?: VoiceMatchMetadata,
    language?: string
  ): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());

    // When language is set, prefer voices native to that language
    if (language && episodeId) {
      const nativeVoices = FAL_VOICE_POOL.filter((v) => {
        const affinity = VOICE_LANGUAGE_AFFINITIES[v.id];
        return affinity?.nativeLanguages.includes(language);
      });
      if (nativeVoices.length >= 2) {
        const pair = selectVoicePairFromPool(nativeVoices, episodeId, metadata);
        return isHostVoice ? pair.host.id : pair.expert.id;
      }
      // Single native voice (ja → Ono_Anna, ko → Sohee) — use it for both slots
      if (nativeVoices.length === 1) {
        return nativeVoices[0].id;
      }
    }

    if (!episodeId) {
      return isHostVoice ? FAL_VOICE_POOL[0].id : FAL_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(FAL_VOICE_POOL, episodeId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
