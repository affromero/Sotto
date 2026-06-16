import {
  VOICE_POOL,
  selectVoicePair,
  resolveVoiceId,
  findByVoiceId,
  type VoicePoolEntry,
  type VoiceMatchMetadata,
} from '../voice-pool';
import type { TtsProviderId } from './tts-registry';
import { isValidProviderId } from './tts-registry';
import type { WordTiming } from '@sotto/shared';
import { getSharedByokKey, getByokExtraData, hasSharedByokKey } from '../byok';
import { getAutoModelConfig } from '../auto-model-config';
import { supportsLanguage, getDefaultModelForLanguage } from '../tts-language-support';
import { logger } from '../logger';
import { infra } from '../server-config';
import { normalizeSottoLanguageCode } from '../speech-language-support';

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
  /** ISO 639-1 language code for the episode (used as hint by providers that accept it). */
  language?: string;
}

export interface SfxParams {
  prompt: string;
  durationSeconds?: number;
}

export interface TtsProvider {
  generateSpeech(params: SpeechParams): Promise<Buffer>;
  generateSpeechWithTimestamps?(params: SpeechParams): Promise<{ audio: Buffer; wordTimings: WordTiming[] }>;
  generateSoundEffect?(params: SfxParams): Promise<Buffer>;
  getVoiceId(speaker: string, episodeId?: string, metadata?: VoiceMatchMetadata, language?: string): string;
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

async function importKokoro() {
  const { KokoroProvider } = await import('./tts/kokoro.provider');
  return KokoroProvider;
}

async function importLocalTts() {
  const { LocalTtsProvider } = await import('./tts/local.provider');
  return LocalTtsProvider;
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a TTS provider instance by ID, optionally with a BYOK API key.
 */
export function createTtsProvider(type: string, byokApiKey?: string, model?: string): TtsProvider {
  if (!type) {
    throw new Error('TTS provider type is required. Pass an explicit provider from the TTS registry.');
  }

  // Use lazy-loaded classes synchronously via pre-instantiated inline classes.
  switch (type) {
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
      throw new Error(`Unknown TTS provider "${type}"`);
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
    case 'kokoro': {
      // Keyless — the Kokoro sidecar needs no API key. It validates TTS_BASE_URL
      // and reachability internally and throws a clear error if unset.
      const Cls = await importKokoro();
      return new Cls(apiKey, model);
    }
    case 'local': {
      // Keyless generic sidecar — implement the Sotto local TTS HTTP contract
      // and configure TTS_BASE_URL/TTS_VOICES. No app code is needed for a new
      // local model behind this contract.
      const Cls = await importLocalTts();
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
 * Resolve a specific TTS provider for a given generation context.
 *
 * Resolution order:
 * 1. If `requestedProvider` is specific + user has BYOK key → BYOK
 * 2. If `requestedProvider` is specific + no BYOK + platform has key → platform
 *
 * Missing or `auto` providers are rejected so generation cannot silently switch providers.
 */
export async function resolveTtsProvider(context: {
  userId: string;
  episodeId: string;
  requestedProvider?: TtsProviderId | 'auto' | null;
  requestedModel?: string | null;
  /** Skip BYOK key lookup and go straight to platform keys. Used for fallback retries. */
  skipByok?: boolean;
  /** ISO 639-1 language code — when set, validates provider/model compatibility. */
  language?: string | null;
}): Promise<ResolvedProvider> {
  const { userId, requestedProvider, requestedModel } = context;
  const language = normalizeSottoLanguageCode(context.language);

  if (!requestedProvider || requestedProvider === 'auto') {
    throw new Error('TTS provider is required. Choose a provider before generating audio.');
  }

  if (!language) {
    logger.debug('No language provided, skipping language-aware provider selection', { episodeId: context.episodeId });
  }

  // Helper: resolve a language-compatible model for a specific provider.
  // If the requested model doesn't support the language, try to find one that does.
  const resolveModelForLanguage = (
    providerId: TtsProviderId,
    model?: string | null
  ): string | undefined => {
    if (!language) return model ?? undefined;
    if (model && supportsLanguage(providerId, model, language)) return model;
    const fallback = getDefaultModelForLanguage(providerId, language, model);
    if (fallback) {
      logger.info('Language-aware model swap', { providerId, from: model, to: fallback, language });
      return fallback;
    }
    throw new Error(
      `TTS provider "${providerId}" does not support language "${language}" with any configured model.`
    );
  };

  const resolvedModel = resolveModelForLanguage(requestedProvider, requestedModel);

  const byokKey = context.skipByok ? null : await getSharedByokKey(userId, requestedProvider);
  if (byokKey) {
    const extraData = await getByokExtraData(byokKey.ownerUserId, requestedProvider);
    const provider = await createTtsProviderAsync(
      requestedProvider,
      byokKey.apiKey,
      extraData ?? undefined,
      resolvedModel
    );
    return { provider, source: 'byok', providerId: requestedProvider };
  }

  // Platform key for the explicitly requested provider.
  // Prefer the requested model, then the admin-configured model for the same provider.
  if (requestedProvider === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) {
    const config = await getAutoModelConfig();
    const configModel = requestedModel ?? (config.model.ttsProvider === 'elevenlabs' ? config.model.ttsModel : undefined);
    const model = resolveModelForLanguage('elevenlabs', configModel);
    return {
      provider: createPremiumTtsProvider(undefined, model),
      source: 'platform',
      providerId: 'elevenlabs',
    };
  }
  if (requestedProvider === 'openai' && process.env.OPENAI_API_KEY) {
    const config = await getAutoModelConfig();
    const configModel = requestedModel ?? (config.model.ttsProvider === 'openai' ? config.model.ttsModel : undefined);
    const model = resolveModelForLanguage('openai', configModel);
    return {
      provider: createTtsProvider('openai', undefined, model),
      source: 'platform',
      providerId: 'openai',
    };
  }
  if (requestedProvider === 'cartesia' && process.env.CARTESIA_API_KEY) {
    const config = await getAutoModelConfig();
    const configModel = requestedModel ?? (config.model.ttsProvider === 'cartesia' ? config.model.ttsModel : undefined);
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
  // Kokoro is keyless and local — it is gated by TTS_BASE_URL, not an API key.
  // It is only ever resolved when explicitly requested (TTS_PROVIDER=kokoro);
  // it never auto-selects by availability. The provider constructor throws a
  // clear error if TTS_BASE_URL is unset, so we surface that path here rather
  // than the generic "missing key" message below.
  if (requestedProvider === 'kokoro') {
    const provider = await createTtsProviderAsync('kokoro', undefined, undefined, resolvedModel);
    return { provider, source: 'platform', providerId: 'kokoro' };
  }
  // Generic local TTS sidecar. Like kokoro, this is gated by TTS_BASE_URL and
  // only resolved when explicitly requested with TTS_PROVIDER=local.
  if (requestedProvider === 'local') {
    const provider = await createTtsProviderAsync('local', undefined, undefined, resolvedModel);
    return { provider, source: 'platform', providerId: 'local' };
  }

  throw new Error(
    `No API key available for ${requestedProvider}. Please add a BYOK key in Settings.`
  );
}

/**
 * The server-configured TTS provider from TTS_PROVIDER (validated), or null when
 * unset/invalid. Lets a self-hoster pin a keyless local provider (kokoro) as the
 * explicit choice for learning audio, mirroring getConfiguredSttProviderId().
 */
export function getConfiguredTtsProviderId(): TtsProviderId | null {
  const raw = (infra('ttsProvider', 'TTS_PROVIDER') ?? '').trim();
  return isValidProviderId(raw) ? raw : null;
}

/**
 * Check if TTS can be resolved for a user without throwing.
 */
export async function canResolveTts(userId: string): Promise<boolean> {
  if (await hasSharedByokKey(userId)) return true;
  // Keyless local TTS sidecars count only when explicitly configured AND given a
  // reachable endpoint — never auto-selected by mere availability.
  const configuredTtsProvider = getConfiguredTtsProviderId();
  if (
    (configuredTtsProvider === 'kokoro' || configuredTtsProvider === 'local') &&
    infra('ttsBaseUrl', 'TTS_BASE_URL')
  ) return true;
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
