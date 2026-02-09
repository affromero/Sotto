import { logger } from '../logger';

export interface SpeechParams {
  text: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
}

export interface SfxParams {
  prompt: string;
  durationSeconds?: number;
}

export interface TtsProvider {
  generateSpeech(params: SpeechParams): Promise<Buffer>;
  generateSoundEffect?(params: SfxParams): Promise<Buffer>;
  getVoiceId(speaker: 'HOST' | 'EXPERT', podcastId?: string): string;
}

/**
 * ElevenLabs provider — premium voice generation.
 * Used when podcast.usePremiumVoice is true.
 */
class ElevenLabsProvider implements TtsProvider {
  private clientPromise: Promise<typeof import('../elevenlabs')> | null = null;

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = import('../elevenlabs');
    }
    return this.clientPromise;
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const el = await this.getClient();
    return el.generateSpeech(params);
  }

  async generateSoundEffect(params: SfxParams): Promise<Buffer> {
    const el = await this.getClient();
    return el.generateSoundEffect(params);
  }

  getVoiceId(speaker: 'HOST' | 'EXPERT', _podcastId?: string): string {
    return speaker === 'HOST'
      ? (process.env.ELEVENLABS_VOICE_HOST || 'pNInz6obpgDQGcFmaJgB')
      : (process.env.ELEVENLABS_VOICE_EXPERT || 'ErXwobaYiN019PkySvjV');
  }
}

/**
 * OpenAI TTS provider — standard voice generation (default).
 * 90% cheaper than ElevenLabs. Good quality for most use cases.
 */
class OpenAITtsProvider implements TtsProvider {
  private async getClient() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    const { default: OpenAI } = await import('openai');
    return new OpenAI({ apiKey });
  }

  private readonly voices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const client = await this.getClient();
    const voice = (this.voices.includes(params.voiceId as (typeof this.voices)[number])
      ? params.voiceId
      : 'alloy') as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

    const response = await client.audio.speech.create({
      model: 'tts-1-hd',
      voice,
      input: params.text,
      response_format: 'mp3',
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  getVoiceId(speaker: 'HOST' | 'EXPERT'): string {
    return speaker === 'HOST' ? 'nova' : 'onyx';
  }
}

/**
 * Create a TTS provider instance.
 * Default is now 'openai' (standard voices). Use 'elevenlabs' for premium.
 */
export function createTtsProvider(type?: string): TtsProvider {
  const providerType = type || process.env.TTS_PROVIDER || 'openai';
  switch (providerType) {
    case 'elevenlabs':
      return new ElevenLabsProvider();
    case 'openai':
      return new OpenAITtsProvider();
    default:
      logger.warn(`Unknown TTS_PROVIDER "${providerType}", falling back to openai`);
      return new OpenAITtsProvider();
  }
}

/**
 * Get the premium (ElevenLabs) TTS provider.
 * Always returns ElevenLabs regardless of TTS_PROVIDER env var.
 */
export function createPremiumTtsProvider(): TtsProvider {
  return new ElevenLabsProvider();
}
