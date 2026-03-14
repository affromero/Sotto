/**
 * Declarative TTS provider registry — capabilities, auth config, and
 * validation functions for every supported BYOK provider.
 */
import { logger } from '../logger';

export type TtsProviderId = 'elevenlabs' | 'openai' | 'cartesia' | 'hume' | 'fal' | 'replicate' | 'minimax' | 'kittentts';

export interface TtsProviderAuthField {
  key: string;
  label: string;
  placeholder: string;
}

export interface TtsModelOption {
  id: string;
  displayName: string;
  tier: 'standard' | 'premium' | 'ultra';
}

export interface TtsProviderMeta {
  id: TtsProviderId;
  displayName: string;
  getApiKeyUrl: string;
  supportsSfx: boolean;
  supportsVoiceCloning: boolean;
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
  auth: {
    fields: TtsProviderAuthField[];
    validate: (credentials: Record<string, string>) => Promise<boolean>;
  };
}

const TTS_PROVIDERS: Record<TtsProviderId, TtsProviderMeta> = {
  elevenlabs: {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    getApiKeyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    supportsSfx: true,
    supportsVoiceCloning: true,
    supportsStreaming: true,
    maxSegmentChars: 5000,
    defaultModel: 'eleven_v3',
    models: [
      { id: 'eleven_v3', displayName: 'Eleven v3', tier: 'premium' },
      { id: 'eleven_flash_v2_5', displayName: 'Eleven Flash v2.5', tier: 'standard' },
      { id: 'eleven_turbo_v2', displayName: 'Eleven Turbo v2', tier: 'standard' },
      { id: 'eleven_multilingual_v2', displayName: 'Eleven Multilingual v2', tier: 'premium' },
    ],
    supportsAudioTags: true,
    docsUrl: 'https://elevenlabs.io/docs/speech-synthesis/audio-tags',
    qualityTier: 'premium',
    platformCostPerKChar: 0.17,
    modelsWithoutTextContext: ['eleven_v3'],
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
    supportsVoiceCloning: false,
    supportsStreaming: true,
    maxSegmentChars: 4096,
    defaultModel: 'tts-1-hd',
    models: [
      { id: 'tts-1-hd', displayName: 'TTS-1 HD', tier: 'premium' },
      { id: 'tts-1', displayName: 'TTS-1', tier: 'standard' },
      { id: 'gpt-4o-mini-tts', displayName: 'GPT-4o Mini TTS', tier: 'standard' },
    ],
    supportsAudioTags: false,
    docsUrl: null,
    qualityTier: 'standard',
    platformCostPerKChar: 0.015,
    modelsWithoutTextContext: [],
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
    supportsVoiceCloning: true,
    supportsStreaming: true,
    maxSegmentChars: 5000,
    defaultModel: 'sonic-3',
    models: [
      { id: 'sonic-3', displayName: 'Sonic 3', tier: 'premium' },
      { id: 'sonic-turbo', displayName: 'Sonic Turbo', tier: 'standard' },
      { id: 'sonic-2', displayName: 'Sonic 2 (Legacy)', tier: 'premium' },
    ],
    supportsAudioTags: true,
    docsUrl: 'https://docs.cartesia.ai/build-with-cartesia/text-to-speech/sonic-formatting',
    qualityTier: 'premium',
    platformCostPerKChar: 0.04,
    modelsWithoutTextContext: [],
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
    supportsVoiceCloning: true,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'octave-v1',
    models: [
      { id: 'octave-v1', displayName: 'Octave V1', tier: 'ultra' },
    ],
    supportsAudioTags: false,
    docsUrl: 'https://dev.hume.ai/docs/text-to-speech/text-to-speech-guide',
    qualityTier: 'ultra',
    platformCostPerKChar: 0.25,
    modelsWithoutTextContext: [],
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
    supportsVoiceCloning: true,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'qwen3-tts-1.7b',
    models: [
      { id: 'qwen3-tts-1.7b', displayName: 'Qwen3 TTS 1.7B', tier: 'premium' },
      { id: 'qwen3-tts-0.6b', displayName: 'Qwen3 TTS 0.6B', tier: 'standard' },
    ],
    supportsAudioTags: false,
    docsUrl: null,
    qualityTier: 'premium',
    platformCostPerKChar: 0,
    modelsWithoutTextContext: [],
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
    supportsVoiceCloning: false,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'speech-02-hd',
    models: [
      { id: 'speech-02-hd', displayName: 'Speech-02 HD', tier: 'premium' },
      { id: 'speech-02-turbo', displayName: 'Speech-02 Turbo', tier: 'standard' },
    ],
    supportsAudioTags: false,
    docsUrl: null,
    qualityTier: 'premium',
    platformCostPerKChar: 0.10,
    modelsWithoutTextContext: [],
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

  replicate: {
    id: 'replicate',
    displayName: 'Replicate',
    getApiKeyUrl: 'https://replicate.com/account/api-tokens',
    supportsSfx: false,
    supportsVoiceCloning: false,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'inworld-tts-1.5-max',
    models: [
      { id: 'inworld-tts-1.5-max', displayName: 'Inworld TTS 1.5 Max', tier: 'premium' },
      { id: 'inworld-tts-1.5-mini', displayName: 'Inworld TTS 1.5 Mini', tier: 'standard' },
      { id: 'qwen3-tts', displayName: 'Qwen3 TTS', tier: 'standard' },
    ],
    supportsAudioTags: true,
    docsUrl: null,
    qualityTier: 'premium',
    platformCostPerKChar: 0.01,
    modelsWithoutTextContext: [],
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

  kittentts: {
    id: 'kittentts',
    displayName: 'KittenTTS (Platform)',
    getApiKeyUrl: '',
    supportsSfx: false,
    supportsVoiceCloning: false,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'kitten-tts-mini-0.8',
    models: [
      { id: 'kitten-tts-mini-0.8', displayName: 'KittenTTS Mini 0.8', tier: 'standard' },
    ],
    supportsAudioTags: false,
    docsUrl: null,
    qualityTier: 'standard',
    platformCostPerKChar: 0,
    modelsWithoutTextContext: [],
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

export interface TtsProviderClientMeta {
  id: Exclude<TtsProviderId, 'kittentts'>;
  displayName: string;
  getApiKeyUrl: string;
  qualityTier: 'standard' | 'premium' | 'ultra';
  supportsSfx: boolean;
  supportsVoiceCloning: boolean;
  supportsStreaming: boolean;
  models: TtsModelOption[];
  authFields: TtsProviderAuthField[];
  recommended: boolean;
}

/**
 * Returns serializable provider metadata for client components.
 * Strips `validate()`, filters out `kittentts` (platform-only, not user-facing).
 * Called server-side only — client components receive this as props.
 */
export function getAllTtsProviderClientMeta(): TtsProviderClientMeta[] {
  return Object.values(TTS_PROVIDERS)
    .filter((p): p is TtsProviderMeta & { id: Exclude<TtsProviderId, 'kittentts'> } => p.id !== 'kittentts')
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      getApiKeyUrl: p.getApiKeyUrl,
      qualityTier: p.qualityTier,
      supportsSfx: p.supportsSfx,
      supportsVoiceCloning: p.supportsVoiceCloning,
      supportsStreaming: p.supportsStreaming,
      models: p.models,
      authFields: p.auth.fields,
      recommended: p.id === 'elevenlabs',
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
