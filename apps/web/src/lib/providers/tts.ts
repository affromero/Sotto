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
import { getByokKey, getByokExtraData, listByokProviders } from '../byok';

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
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a TTS provider instance by ID, optionally with a BYOK API key.
 */
export function createTtsProvider(type?: string, byokApiKey?: string): TtsProvider {
  const providerType = type || process.env.TTS_PROVIDER || 'openai';
  // Use lazy-loaded classes synchronously via pre-instantiated inline classes
  // that delegate to the async providers. For backward compat, we keep
  // ElevenLabs and OpenAI as synchronous constructors.
  switch (providerType) {
    case 'elevenlabs': {
      // Inline sync version using the same lazy-loading pattern
      const { ElevenLabsProvider } = require('./tts/elevenlabs.provider');
      return new ElevenLabsProvider(byokApiKey);
    }
    case 'openai': {
      const { OpenAITtsProvider } = require('./tts/openai.provider');
      return new OpenAITtsProvider(byokApiKey);
    }
    default:
      logger.warn(`Unknown TTS_PROVIDER "${providerType}", falling back to openai`);
      const { OpenAITtsProvider: Fallback } = require('./tts/openai.provider');
      return new Fallback(byokApiKey);
  }
}

/**
 * Create a TTS provider instance asynchronously — supports all providers.
 */
export async function createTtsProviderAsync(
  providerId: TtsProviderId,
  apiKey?: string,
  extraData?: Record<string, string>
): Promise<TtsProvider> {
  switch (providerId) {
    case 'elevenlabs': {
      const Cls = await importElevenLabs();
      return new Cls(apiKey);
    }
    case 'openai': {
      const Cls = await importOpenAI();
      return new Cls(apiKey);
    }
    case 'playht': {
      if (!apiKey) throw new Error('PlayHT requires an API key');
      if (!extraData?.userId) throw new Error('PlayHT requires a userId in extraData');
      const Cls = await importPlayHT();
      return new Cls(apiKey, extraData.userId);
    }
    case 'cartesia': {
      if (!apiKey) throw new Error('Cartesia requires an API key');
      const Cls = await importCartesia();
      return new Cls(apiKey);
    }
    case 'hume': {
      if (!apiKey) throw new Error('Hume AI requires an API key');
      const Cls = await importHume();
      return new Cls(apiKey);
    }
    default:
      throw new Error(`Unknown TTS provider: ${providerId}`);
  }
}

/**
 * Get the premium (ElevenLabs) TTS provider.
 * Always returns ElevenLabs regardless of TTS_PROVIDER env var.
 */
export function createPremiumTtsProvider(byokApiKey?: string): TtsProvider {
  const { ElevenLabsProvider } = require('./tts/elevenlabs.provider');
  return new ElevenLabsProvider(byokApiKey);
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
 * 4. Legacy: `usePremiumVoice=true` + no `requestedProvider` → ElevenLabs
 */
export async function resolveTtsProvider(context: {
  userId: string;
  podcastId: string;
  requestedProvider?: TtsProviderId | 'auto' | null;
  usePremiumVoice?: boolean;
}): Promise<ResolvedProvider> {
  const { userId, requestedProvider, usePremiumVoice } = context;

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
    if (requestedProvider === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) {
      return {
        provider: createPremiumTtsProvider(),
        source: 'platform',
        providerId: 'elevenlabs',
      };
    }
    if (requestedProvider === 'openai' && process.env.OPENAI_API_KEY) {
      return {
        provider: createTtsProvider('openai'),
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

  // Case 4: Legacy usePremiumVoice flag
  if (usePremiumVoice) {
    // Check for BYOK ElevenLabs key first
    const byokKey = await getByokKey(userId, 'elevenlabs');
    if (byokKey) {
      return {
        provider: createPremiumTtsProvider(byokKey),
        source: 'byok',
        providerId: 'elevenlabs',
      };
    }
    // Platform ElevenLabs
    return {
      provider: createPremiumTtsProvider(),
      source: 'platform',
      providerId: 'elevenlabs',
    };
  }

  // Default: platform OpenAI
  return {
    provider: createTtsProvider('openai'),
    source: 'platform',
    providerId: 'openai',
  };
}

// Re-export voice pool utilities for convenience
export { VOICE_POOL, selectVoicePair, resolveVoiceId, findByVoiceId };
export type { VoicePoolEntry };
