/**
 * Declarative STT provider registry — models and metadata for every
 * supported speech-to-text provider.
 */
import type { SttProviderId } from '@sotto/shared';

export type { SttProviderId };

export interface SttModelOption {
  id: string;
  displayName: string;
  tier: 'fast' | 'balanced' | 'best' | 'max';
}

export interface SttProviderMeta {
  id: SttProviderId;
  displayName: string;
  defaultModel: string;
  models: SttModelOption[];
  platformCostPerMinute: number;
}

const STT_PROVIDERS: Record<SttProviderId, SttProviderMeta> = {
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    defaultModel: 'whisper-1',
    models: [
      { id: 'whisper-1', displayName: 'Whisper-1', tier: 'balanced' },
      { id: 'gpt-4o-transcribe', displayName: 'GPT-4o Transcribe', tier: 'best' },
      { id: 'gpt-4o-mini-transcribe', displayName: 'GPT-4o Mini Transcribe', tier: 'fast' },
    ],
    platformCostPerMinute: 0.006,
  },

  groq: {
    id: 'groq',
    displayName: 'Groq',
    defaultModel: 'whisper-large-v3-turbo',
    models: [
      { id: 'whisper-large-v3-turbo', displayName: 'Whisper Large v3 Turbo', tier: 'fast' },
      { id: 'whisper-large-v3', displayName: 'Whisper Large v3', tier: 'best' },
      { id: 'distil-whisper-large-v3-en', displayName: 'Distil Whisper Large v3 (EN)', tier: 'fast' },
    ],
    platformCostPerMinute: 0,
  },

  elevenlabs: {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    defaultModel: 'scribe_v1',
    models: [
      { id: 'scribe_v1', displayName: 'Scribe v1', tier: 'best' },
    ],
    platformCostPerMinute: 0,
  },
};

export function getAllSttProviderMeta(): SttProviderMeta[] {
  return Object.values(STT_PROVIDERS);
}

export function getSttProviderMeta(id: SttProviderId): SttProviderMeta {
  const meta = STT_PROVIDERS[id];
  if (!meta) throw new Error(`Unknown STT provider: ${id}`);
  return meta;
}

export function getSttProviderIds(): SttProviderId[] {
  return Object.keys(STT_PROVIDERS) as SttProviderId[];
}

export function isValidSttProviderId(id: string): id is SttProviderId {
  return id in STT_PROVIDERS;
}
