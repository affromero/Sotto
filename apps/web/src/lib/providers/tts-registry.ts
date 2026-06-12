/**
 * Declarative TTS provider registry — capabilities, auth config, language
 * support, and validation functions for every supported BYOK provider.
 */
import { logger } from '../logger';

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
  | 'local';

export interface TtsProviderAuthField {
  key: string;
  label: string;
  placeholder: string;
}

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
  auth: {
    fields: TtsProviderAuthField[];
    validate: (credentials: Record<string, string>) => Promise<boolean>;
  };
}

// ---------------------------------------------------------------------------
// Language support sets — shared across providers/models to avoid duplication.
// Each set contains ISO 639-1 codes. LANG_ALL matches SOTTO_LANGUAGE_CODES
// exported from tts-language-support.ts.
// ---------------------------------------------------------------------------

/** All 30 Sotto-supported languages */
const LANG_ALL: ReadonlySet<string> = new Set(['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','nl','sv','pl','tr','da','fi','no','cs','ro','hu','el','he','th','vi','id','ms','uk','ca']);
const LANG_EN: ReadonlySet<string> = new Set(['en']);
/** ElevenLabs Multilingual v2 — 24 languages */
const LANG_EL_MLV2: ReadonlySet<string> = new Set(['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','nl','sv','pl','tr','da','fi','cs','ro','hu','el','id','ms']);
/** ElevenLabs Flash v2.5 — 27 languages */
const LANG_EL_FLASH: ReadonlySet<string> = new Set(['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','nl','sv','pl','tr','da','fi','no','cs','ro','hu','el','he','vi','id','ms']);
/** Cartesia Sonic 3 — 28 languages */
const LANG_CARTESIA_3: ReadonlySet<string> = new Set(['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','nl','sv','pl','tr','da','fi','no','cs','ro','hu','el','he','th','vi','id','ms']);
/** Cartesia Sonic Turbo / Sonic 2 — 15 languages */
const LANG_CARTESIA_TURBO: ReadonlySet<string> = new Set(['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','nl','sv','pl']);
/** Hume Octave v2 — 11 languages */
const LANG_HUME_V2: ReadonlySet<string> = new Set(['en','es','fr','de','pt','it','ja','ko','zh','hi','ru']);
/** Hume Octave v1 — 2 languages */
const LANG_HUME_V1: ReadonlySet<string> = new Set(['en','es']);
/** Qwen3-TTS (Fal + Replicate) — 10 languages */
const LANG_QWEN3: ReadonlySet<string> = new Set(['en','es','fr','de','ja','ko','zh','it','pt','ru']);
/** Mistral Voxtral — 9 languages */
const LANG_MISTRAL: ReadonlySet<string> = new Set(['en','es','fr','de','pt','it','ja','ko','zh']);
/** Replicate Inworld TTS — 15 languages */
const LANG_INWORLD: ReadonlySet<string> = new Set(['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','nl','sv','pl']);
/** Kokoro-82M (local sidecar) — 8 languages */
const LANG_KOKORO: ReadonlySet<string> = new Set(['en','es','fr','hi','it','pt','ja','zh']);

const TTS_PROVIDERS: Record<TtsProviderId, TtsProviderMeta> = {
  elevenlabs: {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    getApiKeyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    supportsSfx: true,
    supportsStreaming: true,
    maxSegmentChars: 5000,
    defaultModel: 'eleven_v3',
    models: [
      { id: 'eleven_v3', displayName: 'Eleven v3', tier: 'premium', supportedLanguages: LANG_ALL },
      { id: 'eleven_flash_v2_5', displayName: 'Eleven Flash v2.5', tier: 'standard', supportedLanguages: LANG_EL_FLASH },
      { id: 'eleven_turbo_v2', displayName: 'Eleven Turbo v2', tier: 'standard', supportedLanguages: LANG_EN },
      { id: 'eleven_multilingual_v2', displayName: 'Eleven Multilingual v2', tier: 'premium', supportedLanguages: LANG_EL_MLV2 },
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
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'xi-xxxxxxxxxxxxxxxxxxxx' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.elevenlabs.io/v1/user', {
            headers: { 'xi-api-key': creds.apiKey },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    getApiKeyUrl: 'https://platform.openai.com/api-keys',
    supportsSfx: false,
    supportsStreaming: true,
    maxSegmentChars: 4096,
    defaultModel: 'tts-1-hd',
    models: [
      { id: 'tts-1-hd', displayName: 'TTS-1 HD', tier: 'premium', supportedLanguages: LANG_ALL },
      { id: 'tts-1', displayName: 'TTS-1', tier: 'standard', supportedLanguages: LANG_ALL },
      { id: 'gpt-4o-mini-tts', displayName: 'GPT-4o Mini TTS', tier: 'standard', supportedLanguages: LANG_ALL },
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
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'sk-...' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  cartesia: {
    id: 'cartesia',
    displayName: 'Cartesia',
    getApiKeyUrl: 'https://play.cartesia.ai/keys',
    supportsSfx: false,
    supportsStreaming: true,
    maxSegmentChars: 5000,
    defaultModel: 'sonic-3',
    models: [
      { id: 'sonic-3', displayName: 'Sonic 3', tier: 'premium', supportedLanguages: LANG_CARTESIA_3 },
      { id: 'sonic-turbo', displayName: 'Sonic Turbo', tier: 'standard', supportedLanguages: LANG_CARTESIA_TURBO },
      { id: 'sonic-2', displayName: 'Sonic 2 (Legacy)', tier: 'premium', supportedLanguages: LANG_CARTESIA_TURBO },
    ],
    supportsAudioTags: true,
    docsUrl: 'https://docs.cartesia.ai/build-with-cartesia/text-to-speech/sonic-formatting',
    qualityTier: 'premium',
    platformCostPerKChar: 0.04,
    modelsWithoutTextContext: [],
    languageDetection: 'optional_hint',
    languageParam: 'language',
    voicesAreCrossLingual: true,
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'sk_car_...' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.cartesia.ai/voices?limit=1', {
            headers: {
              'X-API-Key': creds.apiKey,
              'Cartesia-Version': '2025-04-16',
            },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  hume: {
    id: 'hume',
    displayName: 'Hume AI',
    getApiKeyUrl: 'https://platform.hume.ai/settings/keys',
    supportsSfx: false,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'octave-v2',
    models: [
      { id: 'octave-v2', displayName: 'Octave V2', tier: 'ultra', supportedLanguages: LANG_HUME_V2 },
      { id: 'octave-v1', displayName: 'Octave V1', tier: 'ultra', supportedLanguages: LANG_HUME_V1 },
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
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Hume AI API key' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.hume.ai/v0/tts', {
            method: 'POST',
            headers: {
              'X-Hume-Api-Key': creds.apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              utterances: [{ text: 'test', description: 'A neutral voice' }],
              format: { type: 'mp3' },
            }),
          });
          // Hume returns 200 on success or 400 for bad params but not 401/403
          return res.status !== 401 && res.status !== 403;
        } catch {
          return false;
        }
      },
    },
  },

  fal: {
    id: 'fal',
    displayName: 'Fal',
    getApiKeyUrl: 'https://fal.ai/dashboard/keys',
    supportsSfx: false,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'qwen3-tts-1.7b',
    models: [
      { id: 'qwen3-tts-1.7b', displayName: 'Qwen3 TTS 1.7B', tier: 'premium', supportedLanguages: LANG_QWEN3 },
      { id: 'qwen3-tts-0.6b', displayName: 'Qwen3 TTS 0.6B', tier: 'standard', supportedLanguages: LANG_QWEN3 },
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
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'fal_sk_...' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://rest.fal.ai/keys/', {
            headers: { Authorization: `Key ${creds.apiKey}` },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  minimax: {
    id: 'minimax',
    displayName: 'MiniMax',
    getApiKeyUrl: 'https://fal.ai/dashboard/keys',
    supportsSfx: false,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'speech-02-hd',
    models: [
      { id: 'speech-02-hd', displayName: 'Speech-02 HD', tier: 'premium', supportedLanguages: LANG_ALL },
      { id: 'speech-02-turbo', displayName: 'Speech-02 Turbo', tier: 'standard', supportedLanguages: LANG_ALL },
    ],
    supportsAudioTags: false,
    docsUrl: null,
    qualityTier: 'premium',
    platformCostPerKChar: 0.10,
    modelsWithoutTextContext: [],
    languageDetection: 'auto',
    languageParam: null,
    voicesAreCrossLingual: true,
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your FAL API key' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://rest.fal.ai/keys/', {
            headers: { Authorization: `Key ${creds.apiKey}` },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  mistral: {
    id: 'mistral',
    displayName: 'Mistral (Voxtral)',
    getApiKeyUrl: 'https://console.mistral.ai/api-keys',
    supportsSfx: false,
    supportsStreaming: true,
    maxSegmentChars: 4096,
    defaultModel: 'voxtral-mini-tts-2603',
    models: [
      { id: 'voxtral-mini-tts-2603', displayName: 'Voxtral Mini TTS', tier: 'premium', supportedLanguages: LANG_MISTRAL },
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
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Mistral API key' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.mistral.ai/v1/models', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  replicate: {
    id: 'replicate',
    displayName: 'Replicate',
    getApiKeyUrl: 'https://replicate.com/account/api-tokens',
    supportsSfx: false,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'inworld-tts-1.5-max',
    models: [
      { id: 'inworld-tts-1.5-max', displayName: 'Inworld TTS 1.5 Max', tier: 'premium', supportedLanguages: LANG_INWORLD },
      { id: 'inworld-tts-1.5-mini', displayName: 'Inworld TTS 1.5 Mini', tier: 'standard', supportedLanguages: LANG_INWORLD },
      { id: 'qwen3-tts', displayName: 'Qwen3 TTS', tier: 'standard', supportedLanguages: LANG_QWEN3 },
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
      fields: [{ key: 'apiKey', label: 'API Token', placeholder: 'r8_xxxxxxxxxxxx' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.replicate.com/v1/account', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  // Keyless, server-configured local provider — talks to the Kokoro FastAPI
  // sidecar at TTS_BASE_URL (no cloud key). Selected explicitly via
  // TTS_PROVIDER=kokoro; never auto-selected by key availability. Like the
  // keyless local AI/STT backends, it carries no auth fields and is filtered out
  // of the BYOK client DTO (see getAllTtsProviderClientMeta).
  kokoro: {
    id: 'kokoro',
    displayName: 'Kokoro (Local)',
    getApiKeyUrl: '',
    supportsSfx: false,
    supportsStreaming: false,
    maxSegmentChars: 4096,
    defaultModel: 'kokoro',
    models: [
      { id: 'kokoro', displayName: 'Kokoro 82M', tier: 'standard', supportedLanguages: LANG_KOKORO },
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
      fields: [],
      // Keyless — no credentials to validate. Reachability is checked at
      // generation time by the provider (clear error if TTS_BASE_URL is unset
      // or the sidecar is unreachable).
      validate: async () => true,
    },
  },

  // Generic local sidecar provider. This is the flexible no-code extension
  // point for self-hosters who want to run any local TTS model. It uses the same
  // small HTTP contract as services/local-tts, selected explicitly with
  // TTS_PROVIDER=local and TTS_BASE_URL. Voice IDs come from TTS_VOICES or the
  // sidecar's /voices endpoint; the sidecar may ignore unsupported optional
  // fields such as model and language.
  local: {
    id: 'local',
    displayName: 'Local TTS sidecar',
    getApiKeyUrl: '',
    supportsSfx: false,
    supportsStreaming: false,
    maxSegmentChars: 4096,
    defaultModel: 'local',
    models: [
      { id: 'local', displayName: 'Local TTS model', tier: 'standard', supportedLanguages: LANG_ALL },
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
      fields: [],
      validate: async () => true,
    },
  },

};

export function getProviderMeta(id: TtsProviderId): TtsProviderMeta {
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
  return id in TTS_PROVIDERS;
}

/**
 * Validate credentials for a specific provider.
 * Delegates to the provider's registered validation function.
 */
export async function validateProviderCredentials(
  providerId: TtsProviderId,
  credentials: Record<string, string>
): Promise<boolean> {
  const meta = getProviderMeta(providerId);
  try {
    return await meta.auth.validate(credentials);
  } catch (error) {
    logger.warn('Provider credential validation failed', {
      provider: providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Client-safe DTO — serializable subset of TtsProviderMeta (no validate())
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
  recommended: boolean;
  languageDetection: 'auto' | 'optional_hint' | 'recommended';
  voicesAreCrossLingual: boolean;
}

/**
 * Returns serializable provider metadata for client components.
 * Strips `validate()`. Called server-side only — client components receive this as props.
 */
export function getAllTtsProviderClientMeta(): TtsProviderClientMeta[] {
  return Object.values(TTS_PROVIDERS)
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
      recommended: p.id === 'elevenlabs',
      languageDetection: p.languageDetection,
      voicesAreCrossLingual: p.voicesAreCrossLingual,
    }));
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
