import { providerCredentialForm } from '@/lib/providers/shared/credential-fields';
/**
 * Declarative TTS provider registry: capabilities, auth config, language
 * support and credential fields for every supported BYOK provider.
 */
import {
  CARTESIA_USAGE_ALLOWANCE,
  type ProviderUsageAllowance,
  type ProviderUsageAllowancePreset,
} from '../provider-usage/allowances';
import { TTS_LANGUAGE_SUPPORT_SETS } from '../speech-language-support';

export type TtsProviderId =
  | 'elevenlabs'
  | 'openai'
  | 'cartesia'
  | 'hume'
  | 'fal'
  | 'replicate'
  | 'minimax'
  | 'mistral'
  | 'kokoro'
  | 'deepgram'
  | 'rime'
  | 'playht'
  | 'local';

export interface TtsProviderAuthField {
  key: string;
  label: string;
  placeholder: string;
  type?: 'password' | 'text' | 'number';
  optional?: boolean;
}

export type TtsProviderUsageAllowancePreset = ProviderUsageAllowancePreset;
export type TtsProviderUsageAllowance = ProviderUsageAllowance;

export interface TtsModelOption {
  id: string;
  displayName: string;
  tier: 'standard' | 'premium' | 'ultra';
  /** ISO 639-1 codes this model can produce speech for. */
  supportedLanguages: ReadonlySet<string>;
}

export interface TtsProviderMeta {
  id: TtsProviderId;
  displayName: string;
  getApiKeyUrl: string;
  supportsSfx: boolean;
  supportsStreaming: boolean;
  maxSegmentChars: number;
  defaultModel: string;
  models: TtsModelOption[];
  supportsAudioTags: boolean;
  /** URL to provider's text formatting docs (null = plain text, strip all tags). */
  docsUrl: string | null;
  qualityTier: 'standard' | 'premium' | 'ultra';
  platformCostPerKChar: number;
  /** Models that do NOT support `previous_text`/`next_text` context params. */
  modelsWithoutTextContext: string[];
  /** How the provider handles language: auto-detects, accepts optional hint, or recommends explicit param. */
  languageDetection: 'auto' | 'optional_hint' | 'recommended';
  /** API parameter name for language hint (null = provider auto-detects, no param accepted). */
  languageParam: string | null;
  /** true = any voice works for any supported language (most providers). false = voice–language affinity matters (e.g. Fal/Qwen3). */
  voicesAreCrossLingual: boolean;
  usageAllowance?: TtsProviderUsageAllowance;
  auth: {
    fields: TtsProviderAuthField[];
  };
}

// ---------------------------------------------------------------------------
// Language support sets — shared across providers/models to avoid duplication.
// Each set contains ISO 639-1 codes. LANG_ALL matches SOTTO_LANGUAGE_CODES
// exported from tts-language-support.ts.
// ---------------------------------------------------------------------------

const {
  all: LANG_ALL,
  en: LANG_EN,
  elevenLabsMultilingualV2: LANG_EL_MLV2,
  elevenLabsFlash: LANG_EL_FLASH,
  cartesiaSonic3: LANG_CARTESIA_3,
  cartesiaTurbo: LANG_CARTESIA_TURBO,
  humeV2: LANG_HUME_V2,
  humeV1: LANG_HUME_V1,
  qwen3: LANG_QWEN3,
  mistral: LANG_MISTRAL,
  inworld: LANG_INWORLD,
  kokoro: LANG_KOKORO,
  deepgramAura: LANG_DEEPGRAM_AURA,
  rimeArcana: LANG_RIME,
  playhtPlay3Mini: LANG_PLAYHT,
} = TTS_LANGUAGE_SUPPORT_SETS;

const TTS_PROVIDERS: Record<TtsProviderId, TtsProviderMeta> = {
  elevenlabs: {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    getApiKeyUrl: providerCredentialForm('elevenlabs', 'speech').getApiKeyUrl,
    supportsSfx: true,
    supportsStreaming: true,
    maxSegmentChars: 5000,
    defaultModel: 'eleven_v3',
    models: [
      { id: 'eleven_v3', displayName: 'Eleven v3', tier: 'premium', supportedLanguages: LANG_ALL },
      {
        id: 'eleven_flash_v2_5',
        displayName: 'Eleven Flash v2.5',
        tier: 'standard',
        supportedLanguages: LANG_EL_FLASH,
      },
      {
        id: 'eleven_turbo_v2',
        displayName: 'Eleven Turbo v2',
        tier: 'standard',
        supportedLanguages: LANG_EN,
      },
      {
        id: 'eleven_multilingual_v2',
        displayName: 'Eleven Multilingual v2',
        tier: 'premium',
        supportedLanguages: LANG_EL_MLV2,
      },
    ],
    supportsAudioTags: true,
    docsUrl: 'https://elevenlabs.io/docs/speech-synthesis/audio-tags',
    qualityTier: 'premium',
    platformCostPerKChar: 0.17,
    modelsWithoutTextContext: ['eleven_v3'],
    languageDetection: 'optional_hint',
    languageParam: 'language_code',
    voicesAreCrossLingual: true,
    auth: {
      fields: providerCredentialForm('elevenlabs', 'speech').fields,
    },
  },

  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    getApiKeyUrl: providerCredentialForm('openai', 'speech').getApiKeyUrl,
    supportsSfx: false,
    supportsStreaming: true,
    maxSegmentChars: 4096,
    defaultModel: 'tts-1-hd',
    models: [
      { id: 'tts-1-hd', displayName: 'TTS-1 HD', tier: 'premium', supportedLanguages: LANG_ALL },
      { id: 'tts-1', displayName: 'TTS-1', tier: 'standard', supportedLanguages: LANG_ALL },
      {
        id: 'gpt-4o-mini-tts',
        displayName: 'GPT-4o Mini TTS',
        tier: 'standard',
        supportedLanguages: LANG_ALL,
      },
    ],
    supportsAudioTags: false,
    docsUrl: null,
    qualityTier: 'standard',
    platformCostPerKChar: 0.015,
    modelsWithoutTextContext: [],
    languageDetection: 'auto',
    languageParam: null,
    voicesAreCrossLingual: true,
    auth: {
      fields: providerCredentialForm('openai', 'speech').fields,
    },
  },

  cartesia: {
    id: 'cartesia',
    displayName: 'Cartesia',
    getApiKeyUrl: providerCredentialForm('cartesia', 'speech').getApiKeyUrl,
    supportsSfx: false,
    supportsStreaming: true,
    maxSegmentChars: 5000,
    defaultModel: 'sonic-3.5',
    models: [
      { id: 'sonic-3.5', displayName: 'Sonic 3.5', tier: 'premium', supportedLanguages: LANG_ALL },
      {
        id: 'sonic-3',
        displayName: 'Sonic 3',
        tier: 'premium',
        supportedLanguages: LANG_CARTESIA_3,
      },
      {
        id: 'sonic-turbo',
        displayName: 'Sonic Turbo',
        tier: 'standard',
        supportedLanguages: LANG_CARTESIA_TURBO,
      },
      {
        id: 'sonic-2',
        displayName: 'Sonic 2 (Legacy)',
        tier: 'premium',
        supportedLanguages: LANG_CARTESIA_TURBO,
      },
    ],
    supportsAudioTags: true,
    docsUrl: 'https://docs.cartesia.ai/build-with-cartesia/text-to-speech/sonic-formatting',
    qualityTier: 'premium',
    platformCostPerKChar: 0.04,
    modelsWithoutTextContext: [],
    languageDetection: 'optional_hint',
    languageParam: 'language',
    voicesAreCrossLingual: true,
    usageAllowance: CARTESIA_USAGE_ALLOWANCE,
    auth: {
      fields: providerCredentialForm('cartesia', 'speech').fields,
    },
  },

  hume: {
    id: 'hume',
    displayName: 'Hume AI',
    getApiKeyUrl: providerCredentialForm('hume', 'speech').getApiKeyUrl,
    supportsSfx: false,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'octave-v2',
    models: [
      {
        id: 'octave-v2',
        displayName: 'Octave V2',
        tier: 'ultra',
        supportedLanguages: LANG_HUME_V2,
      },
      {
        id: 'octave-v1',
        displayName: 'Octave V1',
        tier: 'ultra',
        supportedLanguages: LANG_HUME_V1,
      },
    ],
    supportsAudioTags: false,
    docsUrl: 'https://dev.hume.ai/docs/text-to-speech/text-to-speech-guide',
    qualityTier: 'ultra',
    platformCostPerKChar: 0.125,
    modelsWithoutTextContext: [],
    languageDetection: 'auto',
    languageParam: null,
    voicesAreCrossLingual: true,
    auth: {
      fields: providerCredentialForm('hume', 'speech').fields,
    },
  },

  fal: {
    id: 'fal',
    displayName: 'Fal',
    getApiKeyUrl: providerCredentialForm('fal', 'speech').getApiKeyUrl,
    supportsSfx: false,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'qwen3-tts-1.7b',
    models: [
      {
        id: 'qwen3-tts-1.7b',
        displayName: 'Qwen3 TTS 1.7B',
        tier: 'premium',
        supportedLanguages: LANG_QWEN3,
      },
      {
        id: 'qwen3-tts-0.6b',
        displayName: 'Qwen3 TTS 0.6B',
        tier: 'standard',
        supportedLanguages: LANG_QWEN3,
      },
    ],
    supportsAudioTags: false,
    docsUrl: null,
    qualityTier: 'premium',
    platformCostPerKChar: 0,
    modelsWithoutTextContext: [],
    languageDetection: 'recommended',
    languageParam: 'language',
    voicesAreCrossLingual: false,
    auth: {
      fields: providerCredentialForm('fal', 'speech').fields,
    },
  },

  minimax: {
    id: 'minimax',
    displayName: 'MiniMax',
    getApiKeyUrl: providerCredentialForm('minimax', 'speech').getApiKeyUrl,
    supportsSfx: false,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'speech-02-hd',
    models: [
      {
        id: 'speech-02-hd',
        displayName: 'Speech-02 HD',
        tier: 'premium',
        supportedLanguages: LANG_ALL,
      },
      {
        id: 'speech-02-turbo',
        displayName: 'Speech-02 Turbo',
        tier: 'standard',
        supportedLanguages: LANG_ALL,
      },
    ],
    supportsAudioTags: false,
    docsUrl: null,
    qualityTier: 'premium',
    platformCostPerKChar: 0.1,
    modelsWithoutTextContext: [],
    languageDetection: 'auto',
    languageParam: null,
    voicesAreCrossLingual: true,
    auth: {
      fields: providerCredentialForm('minimax', 'speech').fields,
    },
  },

  mistral: {
    id: 'mistral',
    displayName: 'Mistral (Voxtral)',
    getApiKeyUrl: providerCredentialForm('mistral', 'speech').getApiKeyUrl,
    supportsSfx: false,
    supportsStreaming: true,
    maxSegmentChars: 4096,
    defaultModel: 'voxtral-mini-tts-2603',
    models: [
      {
        id: 'voxtral-mini-tts-2603',
        displayName: 'Voxtral Mini TTS',
        tier: 'premium',
        supportedLanguages: LANG_MISTRAL,
      },
    ],
    supportsAudioTags: false,
    docsUrl: null,
    qualityTier: 'premium',
    platformCostPerKChar: 0.016,
    modelsWithoutTextContext: [],
    languageDetection: 'auto',
    languageParam: null,
    voicesAreCrossLingual: true,
    auth: {
      fields: providerCredentialForm('mistral', 'speech').fields,
    },
  },

  replicate: {
    id: 'replicate',
    displayName: 'Replicate',
    getApiKeyUrl: providerCredentialForm('replicate', 'speech').getApiKeyUrl,
    supportsSfx: false,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'inworld-tts-1.5-max',
    models: [
      {
        id: 'inworld-tts-1.5-max',
        displayName: 'Inworld TTS 1.5 Max',
        tier: 'premium',
        supportedLanguages: LANG_INWORLD,
      },
      {
        id: 'inworld-tts-1.5-mini',
        displayName: 'Inworld TTS 1.5 Mini',
        tier: 'standard',
        supportedLanguages: LANG_INWORLD,
      },
      {
        id: 'qwen3-tts',
        displayName: 'Qwen3 TTS',
        tier: 'standard',
        supportedLanguages: LANG_QWEN3,
      },
    ],
    supportsAudioTags: true,
    docsUrl: null,
    qualityTier: 'premium',
    platformCostPerKChar: 0.01,
    modelsWithoutTextContext: [],
    languageDetection: 'auto',
    languageParam: null,
    voicesAreCrossLingual: true,
    auth: {
      fields: providerCredentialForm('replicate', 'speech').fields,
    },
  },

  // Keyless local provider for the Kokoro FastAPI sidecar. The saved selection
  // and base URL are explicit. It carries no auth fields.
  kokoro: {
    id: 'kokoro',
    displayName: 'Kokoro (Local)',
    getApiKeyUrl: providerCredentialForm('kokoro', 'speech').getApiKeyUrl,
    supportsSfx: false,
    supportsStreaming: false,
    maxSegmentChars: 4096,
    defaultModel: 'kokoro',
    models: [
      {
        id: 'kokoro',
        displayName: 'Kokoro 82M',
        tier: 'standard',
        supportedLanguages: LANG_KOKORO,
      },
    ],
    supportsAudioTags: false,
    docsUrl: null,
    qualityTier: 'standard',
    platformCostPerKChar: 0,
    modelsWithoutTextContext: ['kokoro'],
    languageDetection: 'optional_hint',
    languageParam: 'language',
    voicesAreCrossLingual: true,
    auth: {
      fields: providerCredentialForm('kokoro', 'speech').fields,
    },
  },

  // Deepgram Aura-2 — real-time voice-agent TTS. The voice id IS the model
  // (aura-2-{name}-{lang}); language is encoded in the voice suffix.
  deepgram: {
    id: 'deepgram',
    displayName: 'Deepgram Aura',
    getApiKeyUrl: providerCredentialForm('deepgram', 'speech').getApiKeyUrl,
    supportsSfx: false,
    supportsStreaming: true,
    maxSegmentChars: 2000,
    defaultModel: 'aura-2',
    models: [
      {
        id: 'aura-2',
        displayName: 'Aura 2',
        tier: 'premium',
        supportedLanguages: LANG_DEEPGRAM_AURA,
      },
    ],
    supportsAudioTags: false,
    docsUrl: null,
    qualityTier: 'premium',
    platformCostPerKChar: 0.03,
    modelsWithoutTextContext: ['aura-2'],
    languageDetection: 'optional_hint',
    languageParam: null,
    voicesAreCrossLingual: false,
    auth: {
      fields: providerCredentialForm('deepgram', 'speech').fields,
    },
  },

  // Rime — Arcana flagship voices. `speaker` + `modelId`; mp3 via Accept header.
  rime: {
    id: 'rime',
    displayName: 'Rime',
    getApiKeyUrl: providerCredentialForm('rime', 'speech').getApiKeyUrl,
    supportsSfx: false,
    supportsStreaming: true,
    maxSegmentChars: 3000,
    defaultModel: 'arcana',
    models: [
      { id: 'arcana', displayName: 'Arcana', tier: 'premium', supportedLanguages: LANG_RIME },
      {
        id: 'mistv2',
        displayName: 'Mist v2',
        tier: 'standard',
        supportedLanguages: new Set(['en', 'es', 'fr', 'de']),
      },
    ],
    supportsAudioTags: false,
    docsUrl: null,
    qualityTier: 'premium',
    platformCostPerKChar: 0.02,
    modelsWithoutTextContext: ['arcana', 'mistv2'],
    languageDetection: 'optional_hint',
    languageParam: 'lang',
    voicesAreCrossLingual: true,
    auth: {
      fields: providerCredentialForm('rime', 'speech').fields,
    },
  },

  // PlayHT — Play3.0-mini multilingual. Dual-credential auth; S3 URI voices.
  playht: {
    id: 'playht',
    displayName: 'PlayHT',
    getApiKeyUrl: providerCredentialForm('playht', 'speech').getApiKeyUrl,
    supportsSfx: false,
    supportsStreaming: true,
    maxSegmentChars: 20000,
    defaultModel: 'Play3.0-mini',
    models: [
      {
        id: 'Play3.0-mini',
        displayName: 'Play 3.0 Mini',
        tier: 'premium',
        supportedLanguages: LANG_PLAYHT,
      },
      {
        id: 'PlayDialog',
        displayName: 'PlayDialog',
        tier: 'ultra',
        supportedLanguages: LANG_PLAYHT,
      },
    ],
    supportsAudioTags: false,
    docsUrl: null,
    qualityTier: 'premium',
    platformCostPerKChar: 0.03,
    modelsWithoutTextContext: ['Play3.0-mini', 'PlayDialog'],
    languageDetection: 'recommended',
    languageParam: 'language',
    voicesAreCrossLingual: true,
    auth: {
      fields: providerCredentialForm('playht', 'speech').fields,
    },
  },

  // Generic local sidecar provider. This is the flexible no-code extension
  // point for self-hosters who want to run any local TTS model. It uses the same
  // small HTTP contract as services/local-tts, selected explicitly with
  // Shared configuration selects local TTS and its endpoint. Voice IDs come from shared settings or the
  // sidecar's /voices endpoint; the sidecar may ignore unsupported optional
  // fields such as model and language.
  local: {
    id: 'local',
    displayName: 'Local TTS sidecar',
    getApiKeyUrl: providerCredentialForm('local', 'speech').getApiKeyUrl,
    supportsSfx: false,
    supportsStreaming: false,
    maxSegmentChars: 4096,
    defaultModel: 'local',
    models: [
      {
        id: 'local',
        displayName: 'Local TTS model',
        tier: 'standard',
        supportedLanguages: LANG_ALL,
      },
    ],
    supportsAudioTags: false,
    docsUrl: null,
    qualityTier: 'standard',
    platformCostPerKChar: 0,
    modelsWithoutTextContext: ['local'],
    languageDetection: 'optional_hint',
    languageParam: 'language',
    voicesAreCrossLingual: true,
    auth: {
      fields: providerCredentialForm('local', 'speech').fields,
    },
  },
};

export function getProviderMeta(id: TtsProviderId): TtsProviderMeta {
  if (!isValidProviderId(id)) throw new Error(`Unknown TTS provider: ${id}`);
  const meta = TTS_PROVIDERS[id];
  if (!meta) throw new Error(`Unknown TTS provider: ${id}`);
  return meta;
}

export function getAllProviderMeta(): TtsProviderMeta[] {
  return Object.values(TTS_PROVIDERS);
}

export function getProviderIds(): TtsProviderId[] {
  return Object.keys(TTS_PROVIDERS) as TtsProviderId[];
}

export function isValidProviderId(id: string): id is TtsProviderId {
  return Object.hasOwn(TTS_PROVIDERS, id);
}

// ---------------------------------------------------------------------------
// Client-safe DTO — serializable subset of TtsProviderMeta
// ---------------------------------------------------------------------------

/** Serializable model option for client components (Set → string[]). */
export interface TtsModelClientOption {
  id: string;
  displayName: string;
  tier: 'standard' | 'premium' | 'ultra';
  supportedLanguages: string[];
}

export interface TtsProviderClientMeta {
  id: TtsProviderId;
  displayName: string;
  getApiKeyUrl: string;
  qualityTier: 'standard' | 'premium' | 'ultra';
  supportsSfx: boolean;
  supportsStreaming: boolean;
  models: TtsModelClientOption[];
  authFields: TtsProviderAuthField[];
  usageAllowance?: TtsProviderUsageAllowance;
  recommended: boolean;
  languageDetection: 'auto' | 'optional_hint' | 'recommended';
  voicesAreCrossLingual: boolean;
}

/**
 * Returns serializable provider metadata for client components.
 * Called server-side only — client components receive this as props.
 */
export function getAllTtsProviderClientMeta(): TtsProviderClientMeta[] {
  return (
    Object.values(TTS_PROVIDERS)
      // Keyless, server-configured local backends have no API-key fields and are
      // never surfaced in BYOK client metadata, mirroring how the AI registry
      // excludes the keyless `local` and `claude-code` providers.
      .filter((p) => p.id !== 'kokoro' && p.id !== 'local')
      .map((p) => ({
        id: p.id,
        displayName: p.displayName,
        getApiKeyUrl: p.getApiKeyUrl,
        qualityTier: p.qualityTier,
        supportsSfx: p.supportsSfx,
        supportsStreaming: p.supportsStreaming,
        models: p.models.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          tier: m.tier,
          supportedLanguages: [...m.supportedLanguages],
        })),
        authFields: p.auth.fields,
        usageAllowance: p.usageAllowance,
        recommended: p.id === 'elevenlabs',
        languageDetection: p.languageDetection,
        voicesAreCrossLingual: p.voicesAreCrossLingual,
      }))
  );
}

/**
 * Quality tier ordering for auto-selection (higher = better).
 */
const QUALITY_ORDER: Record<string, number> = {
  standard: 0,
  premium: 1,
  ultra: 2,
};

export function compareQuality(a: TtsProviderMeta, b: TtsProviderMeta): number {
  return (QUALITY_ORDER[b.qualityTier] ?? 0) - (QUALITY_ORDER[a.qualityTier] ?? 0);
}
