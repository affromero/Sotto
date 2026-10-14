import type { ProviderTransport } from 'thesidedoor-core/providers/transport';
import { settleSynchronousProviderResponse, type SpeechParams, type TtsProvider } from '../../tts';
import { assertTtsModelAvailable, getProviderMeta, type TtsProviderId } from '../../tts-registry';
import { FISH_VOICE_POOL, selectVoicePairFromPool } from '../../tts-voices';
import type { VoiceMatchMetadata } from '../../../voice-pool';
import { applyPronunciationAliases } from '../../../pronunciation-dictionary';
import { convertInlineAudioTags, mapDirectionToExpression } from '../../../tts-expression-mapper';
import { assertProviderActivated } from '../../shared/runtime-activation';

/** Fish's JSON TTS contract, verified October 14, 2026. Unknown headers select paid S2.1. */
export class FishProvider implements TtsProvider {
  static readonly speechEndpoint = 'https://api.fish.audio/v1/tts';
  readonly providerId: TtsProviderId = 'fish';
  private readonly model: string;

  constructor(
    private readonly apiKey: string,
    private readonly transport: ProviderTransport,
    model?: string
  ) {
    if (!apiKey.trim()) throw new Error('Fish Audio requires an API key');
    const meta = getProviderMeta('fish');
    this.model = model ?? meta.defaultModel;
    assertTtsModelAvailable('fish', this.model);
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    params.signal?.throwIfAborted();
    assertProviderActivated(this.providerId);
    assertTtsModelAvailable('fish', this.model);
    const expression = mapDirectionToExpression(params.direction, params.speaker, 'fish');
    const text =
      (expression.fish?.audioTagPrefix ?? '') +
      convertInlineAudioTags(applyPronunciationAliases(params.text), 'fish');
    const response = await this.transport.authenticatedFetch(
      FishProvider.speechEndpoint,
      {
        method: 'POST',
        signal: params.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          model: this.model,
        },
        body: JSON.stringify({
          text,
          reference_id: params.voiceId,
          format: 'mp3',
          sample_rate: 44100,
          mp3_bitrate: 192,
          latency: 'normal',
        }),
      },
      {
        onDispatch: () => {
          assertProviderActivated(this.providerId);
          assertTtsModelAvailable('fish', this.model);
          params.onDispatch?.();
        },
        onConsumed: settleSynchronousProviderResponse(params.onSettled),
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      params.signal?.throwIfAborted();
      throw new Error(`Fish Audio TTS error (${response.status}): ${errorText}`);
    }
    const audio = Buffer.from(await response.arrayBuffer());
    params.signal?.throwIfAborted();
    if (!audio.length) throw new Error('Fish Audio returned empty audio');
    return audio;
  }

  getVoiceId(speaker: string, episodeId?: string, metadata?: VoiceMatchMetadata): string {
    const host = ['HOST', 'GUEST'].includes(speaker.toUpperCase());
    if (!episodeId) return FISH_VOICE_POOL[host ? 0 : 1].id;
    const pair = selectVoicePairFromPool(FISH_VOICE_POOL, episodeId, metadata);
    return host ? pair.host.id : pair.expert.id;
  }

  getModelId(): string {
    return this.model;
  }
}
