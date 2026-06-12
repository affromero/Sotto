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
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { selectVoicePair, resolveVoiceId, findByVoiceId, type VoiceMatchMetadata } from '../../voice-pool';
import { mapDirectionToExpression, convertInlineAudioTags } from '../../tts-expression-mapper';

/** All voices available across OpenAI TTS models */
const OPENAI_VOICES = [
  // Available on all models
  'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer',
  // Additional voices on gpt-4o-mini-tts
  'ash', 'ballad', 'coral', 'sage', 'verse',
  // Highest-quality recommended voices (gpt-4o-mini-tts)
  'marin', 'cedar',
] as const;

// Speakers at even indices (HOST, GUEST) → host voice slot; odd (EXPERT, SKEPTIC) → expert slot.
const SPEAKER_VOICE_HOST_SET = new Set(['HOST', 'GUEST']);
type OpenAIVoice = (typeof OPENAI_VOICES)[number];

/** Models that support the `instructions` parameter */
const INSTRUCTION_MODELS = new Set(['gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-03-20', 'gpt-4o-mini-tts-2025-12-15']);

export class OpenAITtsProvider implements TtsProvider {
  readonly providerId: TtsProviderId = 'openai';
  private apiKeyOverride: string | undefined;
  private model: string;

  constructor(byokApiKey?: string, model?: string) {
    this.apiKeyOverride = byokApiKey;
    this.model = model ?? 'tts-1-hd';
  }

  private async getClient() {
    const apiKey = this.apiKeyOverride || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    const { default: OpenAI } = await import('openai');
    return new OpenAI({ apiKey });
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const client = await this.getClient();

    let openaiVoice: string = params.voiceId;
    const entry = findByVoiceId(params.voiceId);
    if (entry?.ids.openai) {
      openaiVoice = entry.ids.openai;
    }

    const voice: OpenAIVoice = OPENAI_VOICES.includes(openaiVoice as OpenAIVoice)
      ? (openaiVoice as OpenAIVoice)
      : 'alloy';

    // Build request — add instructions for gpt-4o-mini-tts models
    const supportsInstructions = INSTRUCTION_MODELS.has(this.model);
    const createParams: Record<string, unknown> = {
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

    const response = await client.audio.speech.create(
      createParams as Parameters<typeof client.audio.speech.create>[0]
    );

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  getVoiceId(speaker: string, episodeId?: string, metadata?: VoiceMatchMetadata, _language?: string): string {
    const isHostVoice = SPEAKER_VOICE_HOST_SET.has(speaker.toUpperCase());
    if (!episodeId) {
      return isHostVoice ? 'nova' : 'onyx';
    }
    const pair = selectVoicePair(episodeId, metadata);
    const entry = isHostVoice ? pair.host : pair.expert;
    return resolveVoiceId(entry, 'openai');
  }

  getModelId(): string {
    return this.model;
  }
}
