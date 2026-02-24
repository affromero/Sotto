import { createAIProvider, type AIProvider } from './ai';
import { createTtsProvider, type TtsProvider } from './tts';
import { createStorageProvider, type StorageProvider } from './storage';
import { createMLProvider, type MLProvider } from './ml';

export interface Providers {
  ai: AIProvider;
  tts: TtsProvider;
  storage: StorageProvider;
  ml: MLProvider;
}

let _providers: Providers | null = null;

/**
 * Get the singleton provider instances, selected by environment variables:
 * - TTS_PROVIDER: elevenlabs (default) | openai
 * - STORAGE_PROVIDER: r2 (default) | s3 | local
 */
export function getProviders(): Providers {
  if (!_providers) {
    _providers = {
      ai: createAIProvider(),
      tts: createTtsProvider(),
      storage: createStorageProvider(),
      ml: createMLProvider(),
    };
  }
  return _providers;
}

// Re-export types for convenience
export type { AIProvider, ChatMessage, AIOptions, AIResponse } from './ai';
export type { TtsProvider, SpeechParams, SfxParams } from './tts';
export type { StorageProvider } from './storage';
export type { MLProvider, RecommendationSignals, ScoredPodcast } from './ml';

// Re-export factory functions for direct use
export { createAIProvider } from './ai';
export {
  createTtsProvider,
  createPremiumTtsProvider,
  createTtsProviderWithFallback,
  createTtsProviderAsync,
  resolveTtsProvider,
} from './tts';
export type { ResolvedProvider } from './tts';
export { createSttProvider } from './stt';
export type { TranscriptionResult, SttProvider, SttProviderId } from './stt';
export { createStorageProvider } from './storage';
export { createMLProvider } from './ml';

// TTS registry
export type { TtsProviderId, TtsProviderMeta, TtsModelOption } from './tts-registry';
export {
  getProviderMeta,
  getAllProviderMeta,
  getProviderIds,
  isValidProviderId,
} from './tts-registry';

// STT registry
export type { SttProviderMeta, SttModelOption } from './stt-registry';
export {
  getAllSttProviderMeta,
  getSttProviderMeta,
  getSttProviderIds,
  isValidSttProviderId,
} from './stt-registry';
