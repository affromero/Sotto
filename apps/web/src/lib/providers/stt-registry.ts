/**
 * Declarative STT provider registry — models and metadata for every
 * supported speech-to-text provider.
 */
import { normalizeSottoLanguageCode, STT_LANGUAGE_SUPPORT_SETS } from '../speech-language-support';

export type SttProviderId =
  | 'openai'
  | 'elevenlabs'
  | 'together'
  | 'deepgram'
  | 'assemblyai'
  | 'cartesia'
  | 'groq'
  | 'gladia'
  | 'speechmatics'
  | 'local';

export interface SttModelOption {
  id: string;
  displayName: string;
  tier: 'fast' | 'balanced' | 'best' | 'max';
  /** ISO 639-1 codes this model can transcribe. */
  supportedLanguages: ReadonlySet<string>;
}

export interface SttProviderMeta {
  id: SttProviderId;
  displayName: string;
  defaultModel: string;
  models: SttModelOption[];
  platformCostPerMinute: number;
}

const {
  all: LANG_ALL,
  assemblyUniversal3Pro: LANG_ASSEMBLY_UNIVERSAL_3_PRO,
  deepgramNova2: LANG_DEEPGRAM_NOVA_2,
  gladiaSolaria3: LANG_GLADIA_SOLARIA_3,
} = STT_LANGUAGE_SUPPORT_SETS;

const STT_PROVIDERS: Record<SttProviderId, SttProviderMeta> = {
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    defaultModel: 'whisper-1',
    models: [
      { id: 'whisper-1', displayName: 'Whisper-1', tier: 'balanced', supportedLanguages: LANG_ALL },
      {
        id: 'gpt-4o-transcribe',
        displayName: 'GPT-4o Transcribe',
        tier: 'best',
        supportedLanguages: LANG_ALL,
      },
      {
        id: 'gpt-4o-mini-transcribe',
        displayName: 'GPT-4o Mini Transcribe',
        tier: 'fast',
        supportedLanguages: LANG_ALL,
      },
    ],
    platformCostPerMinute: 0.006,
  },

  elevenlabs: {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    defaultModel: 'scribe_v1',
    models: [
      { id: 'scribe_v1', displayName: 'Scribe v1', tier: 'best', supportedLanguages: LANG_ALL },
    ],
    platformCostPerMinute: 0,
  },

  together: {
    id: 'together',
    displayName: 'Together AI',
    defaultModel: 'openai/whisper-large-v3',
    models: [
      {
        id: 'openai/whisper-large-v3',
        displayName: 'Whisper Large v3',
        tier: 'balanced',
        supportedLanguages: LANG_ALL,
      },
    ],
    platformCostPerMinute: 0.0015,
  },

  deepgram: {
    id: 'deepgram',
    displayName: 'Deepgram',
    defaultModel: 'nova-3',
    models: [
      { id: 'nova-3', displayName: 'Nova-3', tier: 'best', supportedLanguages: LANG_ALL },
      {
        id: 'nova-2',
        displayName: 'Nova-2',
        tier: 'balanced',
        supportedLanguages: LANG_DEEPGRAM_NOVA_2,
      },
    ],
    platformCostPerMinute: 0.0077,
  },

  assemblyai: {
    id: 'assemblyai',
    displayName: 'AssemblyAI',
    defaultModel: 'best',
    models: [
      { id: 'best', displayName: 'Universal-2', tier: 'best', supportedLanguages: LANG_ALL },
      { id: 'nano', displayName: 'Nano', tier: 'fast', supportedLanguages: LANG_ALL },
      {
        id: 'universal-3-pro',
        displayName: 'Universal-3 Pro',
        tier: 'max',
        supportedLanguages: LANG_ASSEMBLY_UNIVERSAL_3_PRO,
      },
    ],
    platformCostPerMinute: 0.0025,
  },

  // Cartesia Ink — batch /stt with the ink-whisper family (word timestamps, 99+
  // languages). The Cartesia API key lives in the TTS/BYOK store (UserTtsKey).
  cartesia: {
    id: 'cartesia',
    displayName: 'Cartesia (Ink)',
    defaultModel: 'ink-whisper',
    models: [
      { id: 'ink-whisper', displayName: 'Ink Whisper', tier: 'best', supportedLanguages: LANG_ALL },
    ],
    platformCostPerMinute: 0.0,
  },

  // Groq — OpenAI-compatible Whisper at very low cost / high speed.
  groq: {
    id: 'groq',
    displayName: 'Groq (Whisper)',
    defaultModel: 'whisper-large-v3-turbo',
    models: [
      {
        id: 'whisper-large-v3-turbo',
        displayName: 'Whisper Large v3 Turbo',
        tier: 'fast',
        supportedLanguages: LANG_ALL,
      },
      {
        id: 'whisper-large-v3',
        displayName: 'Whisper Large v3',
        tier: 'balanced',
        supportedLanguages: LANG_ALL,
      },
    ],
    platformCostPerMinute: 0.0007,
  },

  // Gladia — async (upload → submit → poll). Solaria models, 140 languages.
  gladia: {
    id: 'gladia',
    displayName: 'Gladia',
    defaultModel: 'solaria-1',
    models: [
      { id: 'solaria-1', displayName: 'Solaria 1', tier: 'balanced', supportedLanguages: LANG_ALL },
      {
        id: 'solaria-3',
        displayName: 'Solaria 3',
        tier: 'best',
        supportedLanguages: LANG_GLADIA_SOLARIA_3,
      },
    ],
    platformCostPerMinute: 0.0,
  },

  // Speechmatics — async (submit → poll → fetch). Enhanced/standard, 80+ languages.
  speechmatics: {
    id: 'speechmatics',
    displayName: 'Speechmatics',
    defaultModel: 'enhanced',
    models: [
      { id: 'enhanced', displayName: 'Enhanced', tier: 'best', supportedLanguages: LANG_ALL },
      { id: 'standard', displayName: 'Standard', tier: 'balanced', supportedLanguages: LANG_ALL },
    ],
    platformCostPerMinute: 0.0,
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
      {
        id: 'whisper-1',
        displayName: 'Local Whisper (OpenAI-compatible)',
        tier: 'balanced',
        supportedLanguages: LANG_ALL,
      },
    ],
    platformCostPerMinute: 0,
  },
};

export function getAllSttProviderMeta(): SttProviderMeta[] {
  return Object.values(STT_PROVIDERS);
}

export function supportsSttLanguage(
  providerId: SttProviderId,
  modelId: string,
  lang: string | null | undefined
): boolean {
  const normalized = normalizeSottoLanguageCode(lang);
  if (!normalized) return true;
  try {
    const model = getSttProviderMeta(providerId).models.find((m) => m.id === modelId);
    return !!model?.supportedLanguages.has(normalized);
  } catch {
    return false;
  }
}

export function getDefaultSttModelForLanguage(
  providerId: SttProviderId,
  lang: string,
  preferred?: string | null
): string | null {
  const normalized = normalizeSottoLanguageCode(lang);
  if (!normalized) return null;
  try {
    const meta = getSttProviderMeta(providerId);
    if (preferred && supportsSttLanguage(providerId, preferred, normalized)) return preferred;

    const tierOrder: Record<SttModelOption['tier'], number> = {
      max: 4,
      best: 3,
      balanced: 2,
      fast: 1,
    };
    const compatible = meta.models
      .filter((model) => model.supportedLanguages.has(normalized))
      .sort((a, b) => tierOrder[b.tier] - tierOrder[a.tier]);

    return compatible[0]?.id ?? null;
  } catch {
    return null;
  }
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
