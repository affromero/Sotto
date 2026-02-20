/**
 * Declarative TTS provider registry — capabilities, auth config, and
 * validation functions for every supported BYOK provider.
 */
import { logger } from '../logger';

export type TtsProviderId = 'elevenlabs' | 'openai' | 'playht' | 'cartesia' | 'hume' | 'fal' | 'replicate' | 'kittentts';

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
  supportsSfx: boolean;
  supportsVoiceCloning: boolean;
  supportsStreaming: boolean;
  maxSegmentChars: number;
  defaultModel: string;
  models: TtsModelOption[];
  supportsAudioTags: boolean;
  qualityTier: 'standard' | 'premium' | 'ultra';
  platformCostPerKChar: number;
  auth: {
    fields: TtsProviderAuthField[];
    validate: (credentials: Record<string, string>) => Promise<boolean>;
  };
}

const TTS_PROVIDERS: Record<TtsProviderId, TtsProviderMeta> = {
  elevenlabs: {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    supportsSfx: true,
    supportsVoiceCloning: true,
    supportsStreaming: true,
    maxSegmentChars: 5000,
    defaultModel: 'eleven_v3',
    models: [
      { id: 'eleven_v3', displayName: 'Eleven v3', tier: 'premium' },
      { id: 'eleven_turbo_v2', displayName: 'Eleven Turbo v2', tier: 'standard' },
      { id: 'eleven_multilingual_v2', displayName: 'Eleven Multilingual v2', tier: 'premium' },
    ],
    supportsAudioTags: true,
    qualityTier: 'premium',
    platformCostPerKChar: 0.17,
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
    qualityTier: 'standard',
    platformCostPerKChar: 0.015,
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

  playht: {
    id: 'playht',
    displayName: 'PlayHT',
    supportsSfx: false,
    supportsVoiceCloning: true,
    supportsStreaming: true,
    maxSegmentChars: 5000,
    defaultModel: 'premium',
    models: [
      { id: 'premium', displayName: 'Premium', tier: 'premium' },
    ],
    supportsAudioTags: false,
    qualityTier: 'premium',
    platformCostPerKChar: 0.2,
    auth: {
      fields: [
        { key: 'apiKey', label: 'API Key', placeholder: 'Your PlayHT API key' },
        { key: 'userId', label: 'User ID', placeholder: 'Your PlayHT User ID' },
      ],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.play.ht/api/v2/voices', {
            headers: {
              Authorization: `Bearer ${creds.apiKey}`,
              'X-USER-ID': creds.userId || '',
            },
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
    supportsSfx: false,
    supportsVoiceCloning: true,
    supportsStreaming: true,
    maxSegmentChars: 5000,
    defaultModel: 'sonic-2',
    models: [
      { id: 'sonic-2', displayName: 'Sonic 2', tier: 'premium' },
    ],
    supportsAudioTags: false,
    qualityTier: 'premium',
    platformCostPerKChar: 0.15,
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Cartesia API key' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.cartesia.ai/voices', {
            headers: {
              'X-API-Key': creds.apiKey,
              'Cartesia-Version': '2024-06-10',
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
    supportsSfx: false,
    supportsVoiceCloning: true,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'octave',
    models: [
      { id: 'octave', displayName: 'Octave', tier: 'ultra' },
    ],
    supportsAudioTags: false,
    qualityTier: 'ultra',
    platformCostPerKChar: 0.25,
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
    displayName: 'Fal (Qwen3-TTS)',
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
    qualityTier: 'premium',
    platformCostPerKChar: 0,
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

  replicate: {
    id: 'replicate',
    displayName: 'Replicate (Qwen3-TTS)',
    supportsSfx: false,
    supportsVoiceCloning: false,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'qwen3-tts',
    models: [{ id: 'qwen3-tts', displayName: 'Qwen3 TTS', tier: 'premium' }],
    supportsAudioTags: false,
    qualityTier: 'premium',
    platformCostPerKChar: 0,
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
    supportsSfx: false,
    supportsVoiceCloning: false,
    supportsStreaming: false,
    maxSegmentChars: 5000,
    defaultModel: 'kitten-tts-mini-0.8',
    models: [
      { id: 'kitten-tts-mini-0.8', displayName: 'KittenTTS Mini 0.8', tier: 'standard' },
    ],
    supportsAudioTags: false,
    qualityTier: 'standard',
    platformCostPerKChar: 0,
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
