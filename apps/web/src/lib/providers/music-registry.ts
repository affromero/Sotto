/**
 * Declarative music provider registry — capabilities, model catalog, and costs.
 * Follows the same pattern as video-registry.ts.
 */

export type MusicProviderId = 'suno' | 'elevenlabs';

export interface MusicModelOption {
  id: string;
  displayName: string;
  /** Cost per track (USD). */
  costPerTrack: number;
}

export interface MusicProviderMeta {
  id: MusicProviderId;
  displayName: string;
  getApiKeyUrl: string;
  defaultModel: string;
  models: MusicModelOption[];
  /** Env var name for the platform API key. */
  platformKeyEnv: string;
  auth: {
    validate: (credentials: Record<string, string>) => Promise<boolean>;
  };
}

const MUSIC_PROVIDERS: Record<MusicProviderId, MusicProviderMeta> = {
  suno: {
    id: 'suno',
    displayName: 'Suno',
    getApiKeyUrl: 'https://sunoapi.org/dashboard',
    defaultModel: 'suno-v5',
    models: [
      { id: 'suno-v4', displayName: 'Suno V4', costPerTrack: 0.05 },
      { id: 'suno-v4.5', displayName: 'Suno V4.5', costPerTrack: 0.05 },
      { id: 'suno-v4.5-plus', displayName: 'Suno V4.5 Plus', costPerTrack: 0.08 },
      { id: 'suno-v4.5-all', displayName: 'Suno V4.5 All', costPerTrack: 0.08 },
      { id: 'suno-v5', displayName: 'Suno V5', costPerTrack: 0.10 },
    ],
    platformKeyEnv: 'SUNO_API_KEY',
    auth: {
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.sunoapi.org/api/v1/generate/get-credits', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  elevenlabs: {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    getApiKeyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    defaultModel: 'eleven-music-v1',
    models: [
      { id: 'eleven-music-v1', displayName: 'ElevenLabs Music', costPerTrack: 0.10 },
    ],
    platformKeyEnv: 'ELEVENLABS_API_KEY',
    auth: {
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
};

export function getMusicProviderMeta(id: MusicProviderId): MusicProviderMeta {
  const meta = MUSIC_PROVIDERS[id];
  if (!meta) throw new Error(`Unknown music provider: ${id}`);
  return meta;
}

export function getAllMusicProviderMeta(): MusicProviderMeta[] {
  return Object.values(MUSIC_PROVIDERS);
}

export function getMusicProviderIds(): MusicProviderId[] {
  return Object.keys(MUSIC_PROVIDERS) as MusicProviderId[];
}

export function isValidMusicProviderId(id: string): id is MusicProviderId {
  return id in MUSIC_PROVIDERS;
}

/** Map a music model ID to its provider. */
export function getMusicModelProvider(modelId: string): MusicProviderId | null {
  for (const provider of Object.values(MUSIC_PROVIDERS)) {
    if (provider.models.some((m) => m.id === modelId)) return provider.id;
  }
  return null;
}

/** Client-safe metadata for settings UI. */
export interface MusicProviderClientMeta {
  id: MusicProviderId;
  displayName: string;
  getApiKeyUrl: string;
  /** Note shown below the provider name (e.g. "unofficial"). */
  note?: string;
  models: MusicModelOption[];
}

/** Only providers that support BYOK key entry (not ElevenLabs — already in TTS). */
const MUSIC_BYOK_CLIENT_META: MusicProviderClientMeta[] = [
  {
    id: 'suno',
    displayName: 'Suno',
    getApiKeyUrl: 'https://sunoapi.org/dashboard',
    note: 'Unofficial third-party API',
    models: MUSIC_PROVIDERS.suno.models,
  },
];

export function getMusicByokProviderMeta(): MusicProviderClientMeta[] {
  return MUSIC_BYOK_CLIENT_META;
}
