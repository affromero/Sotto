// Re-export types for convenience
export type { AIProvider, ChatMessage, AIOptions, AIResponse } from './ai';
export type { TtsProvider, SpeechParams, SfxParams } from './tts';

// Re-export factory functions for direct use
export { createAIProvider } from './ai';
export { createTtsProviderAsync, resolveTtsProvider } from './tts';
export type { ResolvedProvider } from './tts';
export { createSttProvider } from './stt';
export type { TranscriptionResult, SttProvider, SttProviderId } from './stt';

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
