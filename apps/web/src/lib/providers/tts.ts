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
import { getSharedByokKey, hasSharedByokKey } from '../byok';
import { supportsLanguage, getDefaultModelForLanguage } from '../tts-language-support';
import { logger } from '../logger';
import { infra } from '../server-config';
import { normalizeSottoLanguageCode } from '../speech-language-support';
import {
  createSottoMediaTransport,
  createSottoProviderTransport,
  type SottoProviderExecution,
} from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  captureSottoExecutionCredential,
  sottoExecutionCredentialFields,
} from '@/lib/sidedoor/credentials/runtime/credential-execution';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { prismaUnfiltered } from '../prisma';
import { captureApiEndpoint } from '@/lib/providers/shared/api-selection';
import { captureLocalTtsConnection } from '@/lib/providers/shared/local-tts-connection';

export interface SpeechParams {
  signal?: AbortSignal;
  text: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
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
  /** Exact transport invocation started after authority admission. */
  onDispatch?: () => void;
  /** The complete synchronous provider response was consumed. */
  onSettled?: () => void;
}

export interface SfxParams {
  prompt: string;
  durationSeconds?: number;
  signal?: AbortSignal;
  /** Internal execution observation after authority admission, before invoking the transport. */
  onDispatch?: () => void;
  /** Internal observation of a complete synchronous response or documented request rejection. */
  onSettled?: () => void;
}

export interface TtsProvider {
  getConcurrencyLimit?(signal?: AbortSignal): Promise<number>;
  observeConcurrencyError?(message: string, signal?: AbortSignal): Promise<void>;
  generateSpeech(params: SpeechParams): Promise<Buffer>;
  generateSpeechWithTimestamps?(
    params: SpeechParams
  ): Promise<{ audio: Buffer; wordTimings: WordTiming[] }>;
  generateSoundEffect?(params: SfxParams): Promise<Buffer>;
  getVoiceId(
    speaker: string,
    episodeId?: string,
    metadata?: VoiceMatchMetadata,
    language?: string
  ): string;
  getModelId(): string;
  /** Return the continuity ID from the last generateSpeech() call, if the provider supports it. */
  getLastContinuityId?(): string | null;
  readonly providerId: TtsProviderId;
}

export function settleSynchronousProviderResponse(onSettled?: () => void) {
  return ({ status }: { status: number }) => {
    if (status < 500) onSettled?.();
  };
}

// ---------------------------------------------------------------------------
// Lazy provider imports (keeps module loading fast)
// ---------------------------------------------------------------------------

async function importElevenLabs() {
  const { ElevenLabsProvider } = await import('@/lib/providers/tts/elevenlabs.provider');
  return ElevenLabsProvider;
}

async function importOpenAI() {
  const { OpenAITtsProvider } = await import('@/lib/providers/tts/openai.provider');
  return OpenAITtsProvider;
}

async function importCartesia() {
  const { CartesiaProvider } = await import('@/lib/providers/tts/cartesia.provider');
  return CartesiaProvider;
}

async function importHume() {
  const { HumeProvider } = await import('@/lib/providers/tts/hume.provider');
  return HumeProvider;
}

async function importFal() {
  const { FalProvider } = await import('@/lib/providers/tts/fal.provider');
  return FalProvider;
}

async function importReplicate() {
  const { ReplicateProvider } = await import('@/lib/providers/tts/replicate.provider');
  return ReplicateProvider;
}

async function importMinimax() {
  const { MinimaxProvider } = await import('@/lib/providers/tts/minimax.provider');
  return MinimaxProvider;
}

async function importMistral() {
  const { MistralProvider } = await import('@/lib/providers/tts/mistral.provider');
  return MistralProvider;
}

async function importKokoro() {
  const { KokoroProvider } = await import('@/lib/providers/tts/kokoro.provider');
  return KokoroProvider;
}

async function importLocalTts() {
  const { LocalTtsProvider } = await import('@/lib/providers/tts/local.provider');
  return LocalTtsProvider;
}

async function importDeepgramTts() {
  const { DeepgramAuraProvider } = await import('@/lib/providers/tts/deepgram.provider');
  return DeepgramAuraProvider;
}

async function importRime() {
  const { RimeProvider } = await import('@/lib/providers/tts/rime.provider');
  return RimeProvider;
}

async function importPlayHt() {
  const { PlayHtProvider } = await import('@/lib/providers/tts/playht.provider');
  return PlayHtProvider;
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

function requireProviderMediaDestination(value: string, domains?: readonly string[]): void {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('Invalid provider media destination');
  if (
    domains?.length &&
    !domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  )
    throw new Error('Provider media destination is outside its allowed domains');
}

function createTtsMediaTransport(execution: SottoProviderExecution, domains?: readonly string[]) {
  return createSottoMediaTransport(execution, {
    maxBytes: 25 * 1024 * 1024,
    timeoutMs: 120_000,
    admitDestination: async (url) => requireProviderMediaDestination(url, domains),
  });
}

/**
 * Create a TTS provider instance asynchronously — supports all providers.
 */
export async function createTtsProviderAsync(
  providerId: TtsProviderId,
  execution: SottoProviderExecution,
  apiKey?: string,
  extraData?: Record<string, string>,
  model?: string
): Promise<TtsProvider> {
  if (execution.credential && execution.credential.provider !== providerId)
    throw new Error('The selected credential belongs to another provider');
  if (execution.credential) {
    const captured = sottoExecutionCredentialFields(execution.credential);
    apiKey = captured.apiKey;
    extraData = captured.extraData;
  }
  switch (providerId) {
    case 'elevenlabs': {
      const selectedKey = apiKey;
      if (!selectedKey?.trim()) throw new Error('ElevenLabs API key is not set');
      const Cls = await importElevenLabs();
      const transport = await createSottoProviderTransport(execution, [
        { method: 'POST', url: Cls.speechEndpoint, descendants: true, allowQuery: true },
        { method: 'GET', url: Cls.subscriptionEndpoint },
        { method: 'POST', url: Cls.soundEffectEndpoint },
      ]);
      return new Cls(selectedKey, transport, model);
    }
    case 'openai': {
      const selectedKey = apiKey;
      if (!selectedKey?.trim()) throw new Error('No OpenAI credential is saved');
      const endpoint = execution.credential?.binding.endpoint ?? captureApiEndpoint('openai');
      const Cls = await importOpenAI();
      const transport = await createSottoProviderTransport(execution, [
        { method: 'POST', url: await Cls.speechEndpoint(selectedKey, endpoint) },
      ]);
      return new Cls(selectedKey, endpoint, transport, model);
    }
    case 'cartesia': {
      const selectedKey = apiKey;
      if (!selectedKey?.trim()) throw new Error('Cartesia requires an API key');
      const Cls = await importCartesia();
      const transport = await createSottoProviderTransport(execution, [
        { method: 'POST', url: Cls.speechEndpoint },
      ]);
      return new Cls(selectedKey, transport, model);
    }
    case 'hume': {
      if (!apiKey) throw new Error('Hume AI requires an API key');
      const Cls = await importHume();
      const transport = await createSottoProviderTransport(execution, [
        { method: 'POST', url: Cls.speechEndpoint },
      ]);
      return new Cls(apiKey, transport, model);
    }
    case 'fal': {
      if (!apiKey) throw new Error('Fal requires an API key');
      const Cls = await importFal();
      const transport = await createSottoProviderTransport(
        execution,
        Cls.speechEndpoints.map((url) => ({ method: 'POST', url }))
      );
      const media = await createTtsMediaTransport(execution, ['fal.run', 'fal.media']);
      return new Cls(apiKey, transport, media, model);
    }
    case 'replicate': {
      if (!apiKey) throw new Error('Replicate requires an API key');
      const Cls = await importReplicate();
      const transport = await createSottoProviderTransport(execution, [
        ...Cls.speechEndpoints.map((url) => ({ method: 'POST', url })),
        { method: 'GET', url: Cls.predictionRoot, descendants: true },
      ]);
      const media = await createTtsMediaTransport(execution, ['replicate.delivery']);
      return new Cls(apiKey, transport, media, model);
    }
    case 'minimax': {
      if (!apiKey) throw new Error('MiniMax requires an API key');
      const Cls = await importMinimax();
      const transport = await createSottoProviderTransport(
        execution,
        Cls.speechEndpoints.map((url) => ({ method: 'POST', url }))
      );
      const media = await createTtsMediaTransport(execution, ['fal.run', 'fal.media']);
      return new Cls(apiKey, transport, media, model);
    }
    case 'mistral': {
      if (!apiKey) throw new Error('Mistral requires an API key');
      const Cls = await importMistral();
      const transport = await createSottoProviderTransport(execution, [
        { method: 'POST', url: Cls.speechEndpoint },
      ]);
      const media = await createTtsMediaTransport(execution);
      return new Cls(apiKey, transport, media, model);
    }
    case 'deepgram': {
      const selectedKey = apiKey;
      if (!selectedKey?.trim()) throw new Error('Deepgram requires an API key');
      const Cls = await importDeepgramTts();
      const transport = await createSottoProviderTransport(execution, [
        { method: 'POST', url: Cls.speechEndpoint, allowQuery: true },
      ]);
      return new Cls(selectedKey, transport, model);
    }
    case 'rime': {
      if (!apiKey) throw new Error('Rime requires an API key');
      const Cls = await importRime();
      const transport = await createSottoProviderTransport(execution, [
        { method: 'POST', url: Cls.speechEndpoint },
      ]);
      return new Cls(apiKey, transport, model);
    }
    case 'playht': {
      const credentials = {
        apiKey,
        userId: extraData?.userId,
      };
      if (!credentials.apiKey?.trim() || !credentials.userId?.trim())
        throw new Error('PlayHT requires an API key and user ID from the same account');
      const Cls = await importPlayHt();
      const transport = await createSottoProviderTransport(execution, [
        { method: 'POST', url: Cls.speechEndpoint },
      ]);
      return new Cls({ apiKey: credentials.apiKey, userId: credentials.userId }, transport, model);
    }
    case 'kokoro': {
      const connection = await captureLocalTtsConnection('kokoro', model, apiKey, execution.signal);
      const Cls = await importKokoro();
      const transport = await createSottoProviderTransport(execution, [
        { method: 'POST', url: connection.endpoint },
      ]);
      return new Cls(connection, transport);
    }
    case 'local': {
      const connection = await captureLocalTtsConnection('local', model, apiKey, execution.signal);
      const Cls = await importLocalTts();
      const transport = await createSottoProviderTransport(execution, [
        { method: 'POST', url: connection.endpoint },
      ]);
      return new Cls(connection, transport);
    }
    default:
      throw new Error(`Unknown TTS provider: ${providerId}`);
  }
}

// ---------------------------------------------------------------------------
// Smart provider resolution
// ---------------------------------------------------------------------------

export interface ResolvedProvider {
  provider: TtsProvider;
  source: 'credential' | 'local';
  providerId: TtsProviderId;
  provenance?: NonNullable<Awaited<ReturnType<typeof getSharedByokKey>>>['provenance'];
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
  execution: Omit<SottoProviderExecution, 'userId' | 'credential'>;
  episodeId: string;
  requestedProvider?: TtsProviderId | 'auto' | null;
  requestedModel?: string | null;
  /** ISO 639-1 language code — when set, validates provider/model compatibility. */
  language?: string | null;
}): Promise<ResolvedProvider> {
  const { userId, requestedProvider, requestedModel } = context;
  const language = normalizeSottoLanguageCode(context.language);

  if (!requestedProvider || requestedProvider === 'auto') {
    throw new Error('TTS provider is required. Choose a provider before generating audio.');
  }

  if (!language) {
    logger.debug('No language provided, skipping language-aware provider selection', {
      episodeId: context.episodeId,
    });
  }

  // Helper: resolve a language-compatible model for a specific provider.
  // If the requested model doesn't support the language, try to find one that does.
  const resolveModelForLanguage = (
    providerId: TtsProviderId,
    model?: string | null
  ): string | undefined => {
    // Custom sidecars validate their own model names and language capabilities.
    if (providerId === 'local' && model?.trim()) return model.trim();
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

  const saved = await sottoTransaction(prismaUnfiltered, (database) =>
    captureSottoExecutionCredential(
      database,
      context.execution.authorize,
      'tts',
      requestedProvider,
      true,
      context.execution.signal
    )
  );
  if (saved && saved.recipient.userId !== userId)
    throw new Error('The selected credential recipient changed');
  const execution: SottoProviderExecution = { ...context.execution, userId, credential: saved };
  const byokKey = saved
    ? {
        ...sottoExecutionCredentialFields(saved),
        provenance: {
          instanceId: saved.selected.instanceId,
          owner: saved.selected.credential.owner,
          modality: saved.selected.credential.modality,
          provider: saved.selected.credential.provider,
          revision: saved.selected.credential.credentialRevision,
          binding: saved.selected.credential.binding,
          sharingRevision: saved.selected.sharingRevision,
        },
      }
    : null;
  if (byokKey) {
    const provider = await createTtsProviderAsync(
      requestedProvider,
      execution,
      byokKey.apiKey,
      byokKey.extraData,
      resolvedModel
    );
    return {
      provider,
      source: 'credential',
      providerId: requestedProvider,
      provenance: byokKey.provenance,
    };
  }

  // Kokoro is keyless and local. It requires a saved base URL and is resolved
  // only when explicitly selected. The provider constructor throws a clear
  // error if the base URL is missing, so we surface that path here rather
  // than the generic "missing key" message below.
  if (requestedProvider === 'kokoro') {
    const provider = await createTtsProviderAsync(
      'kokoro',
      execution,
      undefined,
      undefined,
      resolvedModel
    );
    return { provider, source: 'local', providerId: 'kokoro' };
  }
  // Generic local TTS sidecars also require an explicit saved selection and URL.
  if (requestedProvider === 'local') {
    const provider = await createTtsProviderAsync(
      'local',
      execution,
      undefined,
      undefined,
      resolvedModel
    );
    return { provider, source: 'local', providerId: 'local' };
  }

  throw new Error(
    `No API key available for ${requestedProvider}. Please add a BYOK key in Settings.`
  );
}

/**
 * The saved TTS provider, or null when the selection is absent or invalid.
 */
export function getConfiguredTtsProviderId(): TtsProviderId | null {
  const raw = (infra('ttsProvider') ?? '').trim();
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
    infra('ttsBaseUrl')
  )
    return true;
  return false;
}

// Re-export voice pool utilities for convenience
export { VOICE_POOL, selectVoicePair, resolveVoiceId, findByVoiceId };
export type { VoicePoolEntry, VoiceMatchMetadata };
