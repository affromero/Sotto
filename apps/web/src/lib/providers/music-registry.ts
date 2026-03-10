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
}

const MUSIC_PROVIDERS: Record<MusicProviderId, MusicProviderMeta> = {
  suno: {
    id: 'suno',
    displayName: 'Suno',
    getApiKeyUrl: 'https://kie.ai/dashboard',
    defaultModel: 'suno-v5',
    models: [
      { id: 'suno-v4.5', displayName: 'Suno V4.5', costPerTrack: 0.05 },
      { id: 'suno-v5', displayName: 'Suno V5', costPerTrack: 0.10 },
    ],
    platformKeyEnv: 'SUNO_API_KEY',
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
