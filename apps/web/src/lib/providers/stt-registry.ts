/**
 * Declarative STT provider registry — models and metadata for every
 * supported speech-to-text provider.
 */
export type SttProviderId =
  | 'openai'
  | 'elevenlabs'
  | 'together'
  | 'deepgram'
  | 'assemblyai'
  | 'local';

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

  elevenlabs: {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    defaultModel: 'scribe_v1',
    models: [
      { id: 'scribe_v1', displayName: 'Scribe v1', tier: 'best' },
    ],
    platformCostPerMinute: 0,
  },

  together: {
    id: 'together',
    displayName: 'Together AI',
    defaultModel: 'openai/whisper-large-v3',
    models: [
      { id: 'openai/whisper-large-v3', displayName: 'Whisper Large v3', tier: 'balanced' },
    ],
    platformCostPerMinute: 0.0015,
  },

  deepgram: {
    id: 'deepgram',
    displayName: 'Deepgram',
    defaultModel: 'nova-3',
    models: [
      { id: 'nova-3', displayName: 'Nova-3', tier: 'best' },
      { id: 'nova-2', displayName: 'Nova-2', tier: 'balanced' },
    ],
    platformCostPerMinute: 0.0077,
  },

  assemblyai: {
    id: 'assemblyai',
    displayName: 'AssemblyAI',
    defaultModel: 'best',
    models: [
      { id: 'best', displayName: 'Universal-2', tier: 'best' },
      { id: 'nano', displayName: 'Nano', tier: 'fast' },
      { id: 'universal-3-pro', displayName: 'Universal-3 Pro', tier: 'max' },
    ],
    platformCostPerMinute: 0.0025,
  },

  // Local OpenAI-compatible Whisper server (faster-whisper-server / Speaches /
  // whisper.cpp server). Keyless and free; the served model is host-defined via
  // STT_MODEL (default whisper-1; recommend Whisper large-v3-turbo for broad
  // multilingual coverage). Endpoint via STT_BASE_URL.
  local: {
    id: 'local',
    displayName: 'Local Whisper',
    defaultModel: 'whisper-1',
    models: [
      { id: 'whisper-1', displayName: 'Local Whisper (OpenAI-compatible)', tier: 'balanced' },
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
