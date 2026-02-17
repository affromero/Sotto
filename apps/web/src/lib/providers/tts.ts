import { logger } from '../logger';
import {
  VOICE_POOL,
  selectVoicePair,
  resolveVoiceId,
  findByVoiceId,
  type VoicePoolEntry,
} from '../voice-pool';
import type { TtsProviderId } from './tts-registry';
import { getProviderMeta, compareQuality } from './tts-registry';
import { getByokKey, getByokExtraData, listByokProviders, hasByokKey } from '../byok';
import { getFreeTierConfig } from '../free-tier-config';

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
  getModelId(): string;
  readonly providerId: TtsProviderId;
}

// ---------------------------------------------------------------------------
// Lazy provider imports (keeps module loading fast)
// ---------------------------------------------------------------------------

async function importElevenLabs() {
  const { ElevenLabsProvider } = await import('./tts/elevenlabs.provider');
  return ElevenLabsProvider;
}

async function importOpenAI() {
  const { OpenAITtsProvider } = await import('./tts/openai.provider');
  return OpenAITtsProvider;
}

async function importPlayHT() {
  const { PlayHTProvider } = await import('./tts/playht.provider');
  return PlayHTProvider;
}

async function importCartesia() {
  const { CartesiaProvider } = await import('./tts/cartesia.provider');
  return CartesiaProvider;
}

async function importHume() {
  const { HumeProvider } = await import('./tts/hume.provider');
  return HumeProvider;
}

// ---------------------------------------------------------------------------
// Fallback TTS provider — tries primary, then falls back on failure
// ---------------------------------------------------------------------------

class FallbackTtsProvider implements TtsProvider {
  readonly providerId: TtsProviderId;

  constructor(
    private primary: TtsProvider,
    private fallback: TtsProvider,
    private primaryName: string,
    private fallbackName: string
  ) {
    this.providerId = primary.providerId;
  }

  async generateSpeech(params: SpeechParams): Promise<Buffer> {
    try {
      return await this.primary.generateSpeech(params);
    } catch (err) {
      logger.warn(`${this.primaryName} TTS failed, falling back to ${this.fallbackName}`, {
        error: err instanceof Error ? err.message : String(err),
        voiceId: params.voiceId,
      });

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

  getModelId(): string {
    return this.primary.getModelId();
  }
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a TTS provider instance by ID, optionally with a BYOK API key.
 */
export function createTtsProvider(type?: string, byokApiKey?: string, model?: string): TtsProvider {
  const providerType = type || process.env.TTS_PROVIDER || 'openai';
  // Use lazy-loaded classes synchronously via pre-instantiated inline classes
  // that delegate to the async providers. For backward compat, we keep
  // ElevenLabs and OpenAI as synchronous constructors.
  switch (providerType) {
    case 'elevenlabs': {
      // Inline sync version using the same lazy-loading pattern
      const { ElevenLabsProvider } = require('./tts/elevenlabs.provider');
      return new ElevenLabsProvider(byokApiKey, model);
    }
    case 'openai': {
      const { OpenAITtsProvider } = require('./tts/openai.provider');
      return new OpenAITtsProvider(byokApiKey, model);
    }
    default:
      logger.warn(`Unknown TTS_PROVIDER "${providerType}", falling back to openai`);
      const { OpenAITtsProvider: Fallback } = require('./tts/openai.provider');
      return new Fallback(byokApiKey, model);
  }
}

/**
 * Create a TTS provider instance asynchronously — supports all providers.
 */
export async function createTtsProviderAsync(
  providerId: TtsProviderId,
  apiKey?: string,
  extraData?: Record<string, string>,
  model?: string
): Promise<TtsProvider> {
  switch (providerId) {
    case 'elevenlabs': {
      const Cls = await importElevenLabs();
      return new Cls(apiKey, model);
    }
    case 'openai': {
      const Cls = await importOpenAI();
      return new Cls(apiKey, model);
    }
    case 'playht': {
      if (!apiKey) throw new Error('PlayHT requires an API key');
      if (!extraData?.userId) throw new Error('PlayHT requires a userId in extraData');
      const Cls = await importPlayHT();
      return new Cls(apiKey, extraData.userId, model);
    }
    case 'cartesia': {
      if (!apiKey) throw new Error('Cartesia requires an API key');
      const Cls = await importCartesia();
      return new Cls(apiKey, model);
    }
    case 'hume': {
      if (!apiKey) throw new Error('Hume AI requires an API key');
      const Cls = await importHume();
      return new Cls(apiKey, model);
    }
    default:
      throw new Error(`Unknown TTS provider: ${providerId}`);
  }
}

/**
 * Get the premium (ElevenLabs) TTS provider.
 * Always returns ElevenLabs regardless of TTS_PROVIDER env var.
 */
export function createPremiumTtsProvider(byokApiKey?: string, model?: string): TtsProvider {
  const { ElevenLabsProvider } = require('./tts/elevenlabs.provider');
  return new ElevenLabsProvider(byokApiKey, model);
}

/**
 * Create a TTS provider with automatic fallback.
 * Primary: ElevenLabs (or user's BYOK key), Fallback: OpenAI TTS.
 */
export function createTtsProviderWithFallback(byokApiKey?: string): TtsProvider {
  const { ElevenLabsProvider } = require('./tts/elevenlabs.provider');
  const { OpenAITtsProvider } = require('./tts/openai.provider');
  const primary = new ElevenLabsProvider(byokApiKey);
  const fallback = new OpenAITtsProvider();
  return new FallbackTtsProvider(primary, fallback, 'elevenlabs', 'openai');
}

// ---------------------------------------------------------------------------
// Smart provider resolution
// ---------------------------------------------------------------------------

export interface ResolvedProvider {
  provider: TtsProvider;
  source: 'byok' | 'platform';
  providerId: TtsProviderId;
}

/**
 * Resolve the best TTS provider for a given generation context.
 *
 * Resolution order:
 * 1. If `requestedProvider` is specific + user has BYOK key → BYOK
 * 2. If `requestedProvider` is specific + no BYOK + platform has key → platform
 * 3. If 'auto' or null: check user BYOK keys → pick highest quality tier. Fallback to platform default.
 */
export async function resolveTtsProvider(context: {
  userId: string;
  podcastId: string;
  requestedProvider?: TtsProviderId | 'auto' | null;
}): Promise<ResolvedProvider> {
  const { userId, requestedProvider } = context;

  // Case 1+2: Specific provider requested
  if (requestedProvider && requestedProvider !== 'auto') {
    const byokKey = await getByokKey(userId, requestedProvider);
    if (byokKey) {
      const extraData = await getByokExtraData(userId, requestedProvider);
      const provider = await createTtsProviderAsync(
        requestedProvider,
        byokKey,
        extraData ?? undefined
      );
      return { provider, source: 'byok', providerId: requestedProvider };
    }

    // Platform fallback for elevenlabs/openai (we have platform keys)
    // Use admin-configured model when falling back to platform keys
    if (requestedProvider === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) {
      const config = await getFreeTierConfig();
      const model = config.ttsProvider === 'elevenlabs' ? config.ttsModel : undefined;
      return {
        provider: createPremiumTtsProvider(undefined, model),
        source: 'platform',
        providerId: 'elevenlabs',
      };
    }
    if (requestedProvider === 'openai' && process.env.OPENAI_API_KEY) {
      const config = await getFreeTierConfig();
      const model = config.ttsProvider === 'openai' ? config.ttsModel : undefined;
      return {
        provider: createTtsProvider('openai', undefined, model),
        source: 'platform',
        providerId: 'openai',
      };
    }

    // No key available for requested provider
    throw new Error(
      `No API key available for ${requestedProvider}. Please add a BYOK key in Settings.`
    );
  }

  // Case 3: Auto-select based on BYOK keys
  const byokProviders = await listByokProviders(userId);
  if (byokProviders.length > 0) {
    // Sort by quality tier (highest first)
    const sorted = byokProviders
      .filter((p) => p.isValid)
      .map((p) => ({ ...p, meta: getProviderMeta(p.provider) }))
      .sort((a, b) => compareQuality(a.meta, b.meta));

    if (sorted.length > 0) {
      const best = sorted[0];
      const byokKey = await getByokKey(userId, best.provider);
      if (byokKey) {
        const extraData = await getByokExtraData(userId, best.provider);
        const provider = await createTtsProviderAsync(
          best.provider,
          byokKey,
          extraData ?? undefined
        );
        return { provider, source: 'byok', providerId: best.provider };
      }
    }
  }

  // Default: use admin-configured free tier TTS provider + model
  const config = await getFreeTierConfig();
  return {
    provider: createTtsProvider(config.ttsProvider, undefined, config.ttsModel),
    source: 'platform',
    providerId: config.ttsProvider,
  };
}

/**
 * Check if TTS can be resolved for a user without throwing.
 * Returns true if user has BYOK TTS key or platform has a TTS key.
 */
export async function canResolveTts(userId: string): Promise<boolean> {
  if (await hasByokKey(userId)) return true;
  if (process.env.ELEVENLABS_API_KEY) return true;
  if (process.env.OPENAI_API_KEY) return true;
  return false;
}

// Re-export voice pool utilities for convenience
export { VOICE_POOL, selectVoicePair, resolveVoiceId, findByVoiceId };
export type { VoicePoolEntry };
