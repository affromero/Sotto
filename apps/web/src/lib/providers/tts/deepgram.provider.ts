/**
 * Deepgram Aura-2 TTS provider — low-latency voice-agent speech.
 *
 * The voice IS the model: the `model` query param takes an `aura-2-{name}-{lang}`
 * voice id. mp3 output at a fixed 22050 Hz. 7 languages (en/es/de/fr/nl/it/ja),
 * selected via the voice id suffix — no separate language param.
 *
 * API docs: https://developers.deepgram.com/docs/text-to-speech
 * @tts-research-date 2026-06-15 — POST /v1/speak, `Authorization: Token`, aura-2 voices
 */
import { logger } from '../../logger';
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { DEEPGRAM_AURA_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';
import { applyPronunciationAliases } from '../../pronunciation-dictionary';
import type { VoiceMatchMetadata } from '../../voice-pool';

const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);

export class DeepgramAuraProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'deepgram';
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || process.env.DEEPGRAM_API_KEY;
    if (!key) throw new Error('Deepgram requires an API key (BYOK or DEEPGRAM_API_KEY env var)');
    this.apiKey = key;
    this.model = model ?? 'aura-2';
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    // Deepgram conflates voice + model: the `model` query param is the voice id.
    const query = new URLSearchParams({
      model: params.voiceId,
      encoding: 'mp3',
      bit_rate: '48000',
    });

    const response = await fetch(`https://api.deepgram.com/v1/speak?${query.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: applyPronunciationAliases(params.text) }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Deepgram TTS error (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    logger.info('Deepgram Aura speech generated', {
      voiceId: params.voiceId,
      chars: params.text.length,
    });
    return Buffer.from(arrayBuffer);
  }

  getVoiceId(speaker: string, episodeId?: string, metadata?: VoiceMatchMetadata, _language?: string): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!episodeId) {
      return isHostVoice ? DEEPGRAM_AURA_VOICE_POOL[0].id : DEEPGRAM_AURA_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(DEEPGRAM_AURA_VOICE_POOL, episodeId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
