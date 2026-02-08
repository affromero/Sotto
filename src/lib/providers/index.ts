import { createAIProvider, type AIProvider } from './ai';
import { createTtsProvider, type TtsProvider } from './tts';
import { createStorageProvider, type StorageProvider } from './storage';
import { createPaymentProvider, type PaymentProvider } from './payment';

export interface Providers {
  ai: AIProvider;
  tts: TtsProvider;
  storage: StorageProvider;
  payment: PaymentProvider;
}

let _providers: Providers | null = null;

/**
 * Get the singleton provider instances, selected by environment variables:
 * - AI_PROVIDER: anthropic (default) | openai
 * - TTS_PROVIDER: elevenlabs (default) | openai
 * - STORAGE_PROVIDER: r2 (default) | s3 | local
 * - PAYMENT_PROVIDER: stripe (default) | none
 */
export function getProviders(): Providers {
  if (!_providers) {
    _providers = {
      ai: createAIProvider(),
      tts: createTtsProvider(),
      storage: createStorageProvider(),
      payment: createPaymentProvider(),
    };
  }
  return _providers;
}

// Re-export types for convenience
export type { AIProvider, ChatMessage, AIOptions, AIResponse } from './ai';
export type { TtsProvider, SpeechParams, SfxParams } from './tts';
export type { StorageProvider } from './storage';
export type { PaymentProvider, TierLimits, CheckoutParams } from './payment';

// Re-export factory functions for direct use
export { createAIProvider } from './ai';
export { createTtsProvider } from './tts';
export { createStorageProvider } from './storage';
export { createPaymentProvider } from './payment';
