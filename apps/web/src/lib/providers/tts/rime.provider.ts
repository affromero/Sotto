/**
 * Rime TTS provider — Arcana flagship voices for natural conversation.
 *
 * JSON body with `speaker` + `modelId`; mp3 selected via the `Accept` header.
 * Arcana supports 10 languages (en/es/fr/de/hi/he/ja/pt/ar/ta) via the `lang`
 * field (ISO 639-1).
 *
 * API docs: https://docs.rime.ai/api-reference
 * @tts-research-date 2026-06-15 — POST /v1/rime-tts, `Authorization: Bearer`, arcana voices
 */
import { logger } from '../../logger';
import { settleSynchronousProviderResponse, type TtsProvider, type SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { RIME_VOICE_POOL, selectVoicePairFromPool } from '../tts-voices';
import { applyPronunciationAliases } from '../../pronunciation-dictionary';
import type { VoiceMatchMetadata } from '../../voice-pool';
import type { ProviderTransport } from 'thesidedoor-core/providers/transport';

const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);

export class RimeProvider implements TtsProvider {
  static readonly speechEndpoint = 'https://users.rime.ai/v1/rime-tts';
  readonly providerId: TtsProviderId = 'rime';
  private apiKey: string;
  private model: string;

  constructor(
    apiKey: string,
    private readonly transport: ProviderTransport,
    model?: string
  ) {
    if (!apiKey.trim()) throw new Error('Rime requires an API key');
    this.apiKey = apiKey;
    this.model = model ?? 'arcana';
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const response = await this.transport.authenticatedFetch(
      RimeProvider.speechEndpoint,
      {
        method: 'POST',
        signal: params.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: applyPronunciationAliases(params.text),
          speaker: params.voiceId,
          modelId: this.model,
          ...(params.language && { lang: params.language }),
        }),
      },
      {
        onDispatch: params.onDispatch ?? (() => {}),
        onConsumed: settleSynchronousProviderResponse(params.onSettled),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      params.signal?.throwIfAborted();
      throw new Error(`Rime TTS error (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    logger.info('Rime speech generated', {
      model: this.model,
      voiceId: params.voiceId,
      chars: params.text.length,
    });
    return Buffer.from(arrayBuffer);
  }

  getVoiceId(
    speaker: string,
    episodeId?: string,
    metadata?: VoiceMatchMetadata,
    _language?: string
  ): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!episodeId) {
      return isHostVoice ? RIME_VOICE_POOL[0].id : RIME_VOICE_POOL[1].id;
    }
    const pair = selectVoicePairFromPool(RIME_VOICE_POOL, episodeId, metadata);
    return isHostVoice ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
