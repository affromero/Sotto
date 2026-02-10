import { logger } from '../logger';
import {
  VOICE_POOL,
  selectVoicePair,
  resolveVoiceId,
  findByVoiceId,
  type VoicePoolEntry,
} from '../voice-pool';

export interface SpeechParams {
  text: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  apiKeyOverride?: string;
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

// ---------------------------------------------------------------------------
// ElevenLabs provider — premium voice generation
// ---------------------------------------------------------------------------

class ElevenLabsProvider implements TtsProvider {
  private clientPromise: Promise<typeof import('../elevenlabs')> | null = null;
  private byokApiKey: string | undefined;

  constructor(byokApiKey?: string) {
    this.byokApiKey = byokApiKey;
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = import('../elevenlabs');
    }
    return this.clientPromise;
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const el = await this.getClient();
    const apiKeyOverride = params.apiKeyOverride || this.byokApiKey;
    return el.generateSpeech({ ...params, apiKeyOverride });
  }

  async generateSoundEffect(params: SfxParams): Promise<Buffer> {
    const el = await this.getClient();
    return el.generateSoundEffect(params);
  }

  getVoiceId(speaker: 'HOST' | 'EXPERT', podcastId?: string): string {
    if (!podcastId) {
      return speaker === 'HOST' ? VOICE_POOL[0].ids.elevenlabs : VOICE_POOL[8].ids.elevenlabs;
    }
    const pair = selectVoicePair(podcastId);
    const entry = speaker === 'HOST' ? pair.host : pair.expert;
    return resolveVoiceId(entry, 'elevenlabs');
  }
}

// ---------------------------------------------------------------------------
// OpenAI TTS provider — standard voice generation (90 % cheaper)
// ---------------------------------------------------------------------------

const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
type OpenAIVoice = (typeof OPENAI_VOICES)[number];

class OpenAITtsProvider implements TtsProvider {
  private async getClient() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    const { default: OpenAI } = await import('openai');
    return new OpenAI({ apiKey });
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    const client = await this.getClient();

    // Resolve the ElevenLabs voice ID to its OpenAI counterpart via the pool
    let openaiVoice: string = params.voiceId;
    const entry = findByVoiceId(params.voiceId);
    if (entry?.ids.openai) {
      openaiVoice = entry.ids.openai;
    }

    const voice: OpenAIVoice = OPENAI_VOICES.includes(openaiVoice as OpenAIVoice)
      ? (openaiVoice as OpenAIVoice)
      : 'alloy';

    const response = await client.audio.speech.create({
      model: 'tts-1-hd',
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
}

// ---------------------------------------------------------------------------
// Fallback TTS provider — tries primary, then falls back on failure
// ---------------------------------------------------------------------------

class FallbackTtsProvider implements TtsProvider {
  constructor(
    private primary: TtsProvider,
    private fallback: TtsProvider,
    private primaryName: string,
    private fallbackName: string
  ) {}

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    try {
      return await this.primary.generateSpeech(params);
    } catch (err) {
      logger.warn(`${this.primaryName} TTS failed, falling back to ${this.fallbackName}`, {
        error: err instanceof Error ? err.message : String(err),
        voiceId: params.voiceId,
      });

      // Map voice ID to fallback provider's equivalent
      const entry = findByVoiceId(params.voiceId);
      const fallbackVoiceId = entry
        ? resolveVoiceId(entry, this.fallbackName as 'elevenlabs' | 'openai')
        : params.voiceId;

      return this.fallback.generateSpeech({ ...params, voiceId: fallbackVoiceId });
    }
  }

  async generateSoundEffect(params: SfxParams): Promise<Buffer> {
    if (this.primary.generateSoundEffect) {
      try {
        return await this.primary.generateSoundEffect(params);
      } catch (err) {
        logger.warn(`${this.primaryName} SFX failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (this.fallback.generateSoundEffect) {
      return this.fallback.generateSoundEffect(params);
    }
    throw new Error('No SFX provider available');
  }

  getVoiceId(speaker: 'HOST' | 'EXPERT', podcastId?: string): string {
    return this.primary.getVoiceId(speaker, podcastId);
  }
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a TTS provider instance.
 * Default is 'openai' (standard voices). Use 'elevenlabs' for premium.
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
 * Pass a BYOK API key to use the user's own ElevenLabs account.
 */
export function createPremiumTtsProvider(byokApiKey?: string): TtsProvider {
  return new ElevenLabsProvider(byokApiKey);
}

/**
 * Create a TTS provider with automatic fallback.
 *
 * Primary: ElevenLabs (or user's BYOK key)
 * Fallback: OpenAI TTS
 *
 * If the primary provider fails on any call, the fallback provider is used
 * with an automatically-mapped voice ID from the voice pool.
 */
export function createTtsProviderWithFallback(byokApiKey?: string): TtsProvider {
  const primary = new ElevenLabsProvider(byokApiKey);
  const fallback = new OpenAITtsProvider();
  return new FallbackTtsProvider(primary, fallback, 'elevenlabs', 'openai');
}

// Re-export voice pool utilities for convenience
export { VOICE_POOL, selectVoicePair, resolveVoiceId, findByVoiceId };
export type { VoicePoolEntry };
