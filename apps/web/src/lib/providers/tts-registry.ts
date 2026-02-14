/**
 * Declarative TTS provider registry — capabilities, auth config, and
 * validation functions for every supported BYOK provider.
 */
import { logger } from '../logger';

export type TtsProviderId = 'elevenlabs' | 'openai' | 'playht' | 'cartesia' | 'hume';

export interface TtsProviderAuthField {
  key: string;
  label: string;
  placeholder: string;
}

export interface TtsProviderMeta {
  id: TtsProviderId;
  displayName: string;
  supportsSfx: boolean;
  supportsVoiceCloning: boolean;
  supportsStreaming: boolean;
  maxSegmentChars: number;
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
    qualityTier: 'premium',
    platformCostPerKChar: 0.17,
    auth: {
      fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'xi-xxxxxxxxxxxxxxxxxxxx' }],
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.elevenlabs.io/v1/user', {
            method: 'HEAD',
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
