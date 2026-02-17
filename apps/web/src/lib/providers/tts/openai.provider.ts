/**
 * OpenAI TTS provider — standard voice generation (90% cheaper).
 * Extracted from ../tts.ts for the multi-provider architecture.
 */
import type { TtsProvider, SpeechParams } from '../tts';
import type { TtsProviderId } from '../tts-registry';
import { selectVoicePair, resolveVoiceId, findByVoiceId } from '../../voice-pool';

const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
type OpenAIVoice = (typeof OPENAI_VOICES)[number];

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

    const response = await client.audio.speech.create({
      model: this.model,
      voice,
      input: params.text,
      response_format: 'mp3',
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  getVoiceId(speaker: 'HOST' | 'EXPERT', podcastId?: string): string {
    if (!podcastId) {
      return speaker === 'HOST' ? 'nova' : 'onyx';
    }
    const pair = selectVoicePair(podcastId);
    const entry = speaker === 'HOST' ? pair.host : pair.expert;
    return resolveVoiceId(entry, 'openai');
  }

  getModelId(): string {
    return this.model;
  }
}
