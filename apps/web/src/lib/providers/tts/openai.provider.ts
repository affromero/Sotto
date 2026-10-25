/**
 * OpenAI TTS provider — standard voice generation.
 * Extracted from ../tts.ts for the multi-provider architecture.
 *
 * Expression support:
 *   - gpt-4o-mini-tts: `instructions` field for natural-language delivery control
 *     (accent, emotion, pacing, tone, whispering, character impressions)
 *   - tts-1 / tts-1-hd: no expression controls beyond voice selection
 *   - gpt-4o-mini-tts does NOT support `speed` param — use instructions for pacing
 *   - No SSML or audio tag support on any model
 *   - Pin to gpt-4o-mini-tts-2025-03-20 for reliable instruction following
 *     (the 2025-12-15 snapshot has degraded instruction adherence)
 *
 * @tts-research-date 2026-02-27 — gpt-4o-mini-tts instructions, model snapshots, voices
 */
import { settleSynchronousProviderResponse, type TtsProvider, type SpeechParams } from '../tts';
import type { ProviderTransport } from 'thesidedoor-core/providers/transport';
import type { TtsProviderId } from '../tts-registry';
import { selectVoicePair, resolveVoiceId, type VoiceMatchMetadata } from '../../voice-pool';
import { mapDirectionToExpression, convertInlineAudioTags } from '../../tts-expression-mapper';
import { getOpenAIVoicePool, resolveOpenAIVoice } from './openai/voices';

// Speakers at even indices (HOST, GUEST) → host voice slot; odd (EXPERT, SKEPTIC) → expert slot.
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);

/** Models that support the `instructions` parameter */
const INSTRUCTION_MODELS = new Set([
  'gpt-4o-mini-tts',
  'gpt-4o-mini-tts-2025-03-20',
  'gpt-4o-mini-tts-2025-12-15',
]);

export class OpenAITtsProvider implements TtsProvider {
  static async speechEndpoint(apiKey: string, baseURL: string) {
    const { default: OpenAI } = await import('openai');
    return new OpenAI({ apiKey, baseURL }).buildURL('/audio/speech', undefined);
  }
  readonly providerId: TtsProviderId = 'openai';
  private model: string;

  constructor(
    private readonly apiKey: string,
    private readonly baseURL: string,
    private readonly transport: ProviderTransport,
    model?: string
  ) {
    if (!apiKey.trim()) throw new Error('No OpenAI credential is saved');
    this.model = model ?? 'tts-1-hd';
  }

  private async getClient(observation: Pick<SpeechParams, 'onDispatch' | 'onSettled'>) {
    const { default: OpenAI } = await import('openai');
    return new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      fetch: (input, init) =>
        this.transport.authenticatedFetch(input, init, {
          onDispatch: observation.onDispatch ?? (() => {}),
          onConsumed: settleSynchronousProviderResponse(observation.onSettled),
        }),
    });
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const voice = resolveOpenAIVoice(params.voiceId, this.model);
    const client = await this.getClient(params);

    // Build request — add instructions for gpt-4o-mini-tts models
    const supportsInstructions = INSTRUCTION_MODELS.has(this.model);
    const createParams: Parameters<typeof client.audio.speech.create>[0] = {
      model: this.model,
      voice,
      input: convertInlineAudioTags(params.text, 'openai'),
      response_format: 'mp3',
    };

    if (supportsInstructions) {
      const expression = mapDirectionToExpression(params.direction, params.speaker, 'openai');
      if (expression.openai?.instructions) {
        createParams.instructions = expression.openai.instructions;
      }
    }

    const response = await client.audio.speech.create(createParams, { signal: params.signal });

    const arrayBuffer = await response.arrayBuffer();
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
      return isHostVoice ? 'nova' : 'onyx';
    }
    const pair = selectVoicePair(episodeId, metadata, getOpenAIVoicePool(this.model));
    const entry = isHostVoice ? pair.host : pair.expert;
    return resolveVoiceId(entry, 'openai');
  }

  getModelId(): string {
    return this.model;
  }
}
