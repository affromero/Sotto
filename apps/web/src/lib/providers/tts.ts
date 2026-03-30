import {
  VOICE_POOL,
  selectVoicePair,
  resolveVoiceId,
  findByVoiceId,
  type VoicePoolEntry,
  type VoiceMatchMetadata,
} from '../voice-pool';
import type { TtsProviderId } from './tts-registry';
import { getProviderMeta, compareQuality } from './tts-registry';
import { getByokKey, getByokExtraData, listByokProviders, hasByokKey } from '../byok';
import { resolveAutoModel, getAutoModelConfig } from '../auto-model-config';
import { supportsLanguage, getDefaultModelForLanguage } from '../tts-language-support';
import { logger } from '../logger';

export interface SpeechParams {
  text: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  apiKeyOverride?: string;
  previousText?: string;
  nextText?: string;
  /** Cross-chunk continuity IDs from previous generateSpeech() calls (max 3). */
  continuityIds?: string[];
  /** Delivery direction from the script (e.g. "energetic", "thoughtful", "sarcastic") */
  direction?: string;
  /** Speaker role (e.g. "HOST", "EXPERT") — used by some providers for baseline expression */
  speaker?: string;
  /** Deterministic seed for reproducible output (ElevenLabs only, 0–4294967295) */
  seed?: number;
  /** ISO 639-1 language code for the podcast (used as hint by providers that accept it). */
  language?: string;
}

export interface SfxParams {
  prompt: string;
  durationSeconds?: number;
}

export interface TtsProvider {
  generateSpeech(params: SpeechParams): Promise<Buffer>;
  generateSoundEffect?(params: SfxParams): Promise<Buffer>;
  getVoiceId(speaker: string, podcastId?: string, metadata?: VoiceMatchMetadata, language?: string): string;
  getModelId(): string;
  /** Return the continuity ID from the last generateSpeech() call, if the provider supports it. */
  getLastContinuityId?(): string | null;
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

async function importCartesia() {
  const { CartesiaProvider } = await import('./tts/cartesia.provider');
  return CartesiaProvider;
}

async function importHume() {
  const { HumeProvider } = await import('./tts/hume.provider');
  return HumeProvider;
}

async function importFal() {
  const { FalProvider } = await import('./tts/fal.provider');
  return FalProvider;
}

async function importReplicate() {
  const { ReplicateProvider } = await import('./tts/replicate.provider');
  return ReplicateProvider;
}

async function importMinimax() {
  const { MinimaxProvider } = await import('./tts/minimax.provider');
  return MinimaxProvider;
}

async function importMistral() {
  const { MistralProvider } = await import('./tts/mistral.provider');
  return MistralProvider;
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
      const { ElevenLabsProvider } = require('./tts/elevenlabs.provider');
      return new ElevenLabsProvider(byokApiKey, model);
    }
    case 'openai': {
      const { OpenAITtsProvider } = require('./tts/openai.provider');
      return new OpenAITtsProvider(byokApiKey, model);
    }
    case 'cartesia': {
      const { CartesiaProvider } = require('./tts/cartesia.provider');
      return new CartesiaProvider(byokApiKey, model);
    }
    default:
      throw new Error(`Unknown TTS_PROVIDER "${providerType}"`);
  }
}

/**
 * Create a TTS provider instance asynchronously — supports all providers.
 */
export async function createTtsProviderAsync(
  providerId: TtsProviderId,
  apiKey?: string,
  _extraData?: Record<string, string>,
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
    case 'cartesia': {
      const Cls = await importCartesia();
      return new Cls(apiKey, model);
    }
    case 'hume': {
      if (!apiKey) throw new Error('Hume AI requires an API key');
      const Cls = await importHume();
      return new Cls(apiKey, model);
    }
    case 'fal': {
      if (!apiKey) throw new Error('Fal requires an API key');
      const Cls = await importFal();
      return new Cls(apiKey, model);
    }
    case 'replicate': {
      if (!apiKey) throw new Error('Replicate requires an API key');
      const Cls = await importReplicate();
      return new Cls(apiKey, model);
    }
    case 'minimax': {
      if (!apiKey) throw new Error('MiniMax requires an API key');
      const Cls = await importMinimax();
      return new Cls(apiKey, model);
    }
    case 'mistral': {
      if (!apiKey) throw new Error('Mistral requires an API key');
      const Cls = await importMistral();
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
  requestedModel?: string | null;
  plan?: 'FREE' | 'PRO';
  /** Skip BYOK key lookup and go straight to platform keys. Used for fallback retries. */
  skipByok?: boolean;
  /** ISO 639-1 language code — when set, validates provider/model compatibility. */
  language?: string | null;
}): Promise<ResolvedProvider> {
  const { userId, requestedProvider, requestedModel, language } = context;

  if (!language) {
    logger.debug('No language provided, skipping language-aware provider selection', { podcastId: context.podcastId });
  }

  // Helper: resolve a language-compatible model for a specific provider.
  // If the requested model doesn't support the language, try to find one that does.
  const resolveModelForLanguage = (providerId: TtsProviderId, model?: string | null): string | undefined => {
    if (!language) return model ?? undefined;
    if (model && supportsLanguage(providerId, model, language)) return model;
    const fallback = getDefaultModelForLanguage(providerId, language, model);
    if (fallback) {
      logger.info('Language-aware model swap', { providerId, from: model, to: fallback, language });
      return fallback;
    }
    // No compatible model on this provider — caller decides what to do
    return model ?? undefined;
  };

  // Case 1+2: Specific provider requested
  if (requestedProvider && requestedProvider !== 'auto') {
    const resolvedModel = resolveModelForLanguage(requestedProvider, requestedModel);

    const byokKey = context.skipByok ? null : await getByokKey(userId, requestedProvider);
    if (byokKey) {
      const extraData = await getByokExtraData(userId, requestedProvider);
      const provider = await createTtsProviderAsync(
        requestedProvider,
        byokKey,
        extraData ?? undefined,
        resolvedModel
      );
      return { provider, source: 'byok', providerId: requestedProvider };
    }

    // Platform fallback for elevenlabs/openai (we have platform keys)
    // Prefer user's requested model, fall back to admin-configured model
    if (requestedProvider === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) {
      const config = await getAutoModelConfig();
      const configModel = requestedModel ?? (config.free.ttsProvider === 'elevenlabs' ? config.free.ttsModel : undefined);
      const model = resolveModelForLanguage('elevenlabs', configModel);
      return {
        provider: createPremiumTtsProvider(undefined, model),
        source: 'platform',
        providerId: 'elevenlabs',
      };
    }
    if (requestedProvider === 'openai' && process.env.OPENAI_API_KEY) {
      const config = await getAutoModelConfig();
      const configModel = requestedModel ?? (config.free.ttsProvider === 'openai' ? config.free.ttsModel : undefined);
      const model = resolveModelForLanguage('openai', configModel);
      return {
        provider: createTtsProvider('openai', undefined, model),
        source: 'platform',
        providerId: 'openai',
      };
    }
    if (requestedProvider === 'cartesia' && process.env.CARTESIA_API_KEY) {
      const config = await getAutoModelConfig();
      const configModel = requestedModel ?? (config.free.ttsProvider === 'cartesia' ? config.free.ttsModel : undefined);
      const model = resolveModelForLanguage('cartesia', configModel);
      const provider = await createTtsProviderAsync('cartesia', undefined, undefined, model);
      return { provider, source: 'platform', providerId: 'cartesia' };
    }
    if (requestedProvider === 'hume' && process.env.HUME_API_KEY) {
      const provider = await createTtsProviderAsync('hume', process.env.HUME_API_KEY, undefined, resolvedModel);
      return { provider, source: 'platform', providerId: 'hume' };
    }
    if (requestedProvider === 'fal' && process.env.FAL_KEY) {
      const provider = await createTtsProviderAsync('fal', process.env.FAL_KEY, undefined, resolvedModel);
      return { provider, source: 'platform', providerId: 'fal' };
    }
    if (requestedProvider === 'replicate' && process.env.REPLICATE_API_TOKEN) {
      const provider = await createTtsProviderAsync('replicate', process.env.REPLICATE_API_TOKEN, undefined, resolvedModel);
      return { provider, source: 'platform', providerId: 'replicate' };
    }
    if (requestedProvider === 'minimax' && process.env.FAL_KEY) {
      const provider = await createTtsProviderAsync('minimax', process.env.FAL_KEY, undefined, resolvedModel);
      return { provider, source: 'platform', providerId: 'minimax' };
    }
    if (requestedProvider === 'mistral' && process.env.MISTRAL_API_KEY) {
      const provider = await createTtsProviderAsync('mistral', process.env.MISTRAL_API_KEY, undefined, resolvedModel);
      return { provider, source: 'platform', providerId: 'mistral' };
    }

    // No key available for requested provider
    throw new Error(
      `No API key available for ${requestedProvider}. Please add a BYOK key in Settings.`
    );
  }

  // Case 3: Auto-select based on BYOK keys
  const byokProviders = await listByokProviders(userId);
  if (byokProviders.length > 0) {
    // Sort by quality tier (highest first), filter by language support when set
    const sorted = byokProviders
      .filter((p) => p.isValid)
      .map((p) => ({ ...p, meta: getProviderMeta(p.provider) }))
      .filter((p) => {
        if (!language) return true;
        // At least one model on this provider must support the language
        return p.meta.models.some((m) => m.supportedLanguages.has(language));
      })
      .sort((a, b) => compareQuality(a.meta, b.meta));

    if (sorted.length > 0) {
      const best = sorted[0];
      const byokKey = await getByokKey(userId, best.provider);
      if (byokKey) {
        const extraData = await getByokExtraData(userId, best.provider);
        const model = resolveModelForLanguage(best.provider, undefined);
        const provider = await createTtsProviderAsync(
          best.provider,
          byokKey,
          extraData ?? undefined,
          model
        );
        return { provider, source: 'byok', providerId: best.provider };
      }
    }
  }

  // Platform path: auto model config for the user's plan tier, respecting language
  const autoConfig = await resolveAutoModel(context.plan ?? 'FREE');
  const autoModel = resolveModelForLanguage(autoConfig.ttsProvider as TtsProviderId, autoConfig.ttsModel);
  return {
    provider: createTtsProvider(autoConfig.ttsProvider as TtsProviderId, undefined, autoModel),
    source: 'platform',
    providerId: autoConfig.ttsProvider as TtsProviderId,
  };
}

/**
 * Check if TTS can be resolved for a user without throwing.
 */
export async function canResolveTts(userId: string): Promise<boolean> {
  if (await hasByokKey(userId)) return true;
  if (process.env.ELEVENLABS_API_KEY) return true;
  if (process.env.OPENAI_API_KEY) return true;
  if (process.env.CARTESIA_API_KEY) return true;
  if (process.env.HUME_API_KEY) return true;
  if (process.env.FAL_KEY) return true;
  if (process.env.REPLICATE_API_TOKEN) return true;
  if (process.env.MISTRAL_API_KEY) return true;
  return false;
}

// Re-export voice pool utilities for convenience
export { VOICE_POOL, selectVoicePair, resolveVoiceId, findByVoiceId };
export type { VoicePoolEntry, VoiceMatchMetadata };
