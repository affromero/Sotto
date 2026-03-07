/**
 * Declarative video provider registry — capabilities, model catalog, and costs.
 * Follows the same pattern as image-registry.ts.
 */

export type VideoProviderId = 'fal' | 'minimax';

export interface VideoModelOption {
  id: string;
  displayName: string;
  tier: 'standard' | 'high' | 'best';
}

export interface VideoProviderMeta {
  id: VideoProviderId;
  displayName: string;
  getApiKeyUrl: string;
  defaultModel: string;
  models: VideoModelOption[];
  /** Env var name for the platform API key. */
  platformKeyEnv: string;
  auth: {
    validate: (credentials: Record<string, string>) => Promise<boolean>;
  };
}

const VIDEO_PROVIDERS: Record<VideoProviderId, VideoProviderMeta> = {
  fal: {
    id: 'fal',
    displayName: 'Fal',
    getApiKeyUrl: 'https://fal.ai/dashboard/keys',
    defaultModel: 'fal-wan2.5-480p',
    models: [
      { id: 'fal-wan2.5-480p', displayName: 'Wan 2.5 (480p)', tier: 'standard' },
      { id: 'fal-kling3-1080p', displayName: 'Kling 3 (1080p)', tier: 'high' },
      { id: 'fal-veo3-fast-1080p', displayName: 'Veo 3 Fast (1080p)', tier: 'high' },
      { id: 'fal-veo3-1080p', displayName: 'Veo 3 (1080p)', tier: 'best' },
    ],
    platformKeyEnv: 'FAL_KEY',
    auth: {
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
    displayName: 'MiniMax (Hailuo)',
    getApiKeyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    defaultModel: 'minimax-hailuo-02',
    models: [
      { id: 'minimax-t2v-01', displayName: 'T2V-01 (720p)', tier: 'standard' },
      { id: 'minimax-hailuo-02', displayName: 'Hailuo 02 (1080p)', tier: 'high' },
      { id: 'minimax-hailuo-2.3', displayName: 'Hailuo 2.3 (1080p)', tier: 'best' },
    ],
    platformKeyEnv: 'MINIMAX_API_KEY',
    auth: {
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.minimax.io/v1/query/video_generation?task_id=test', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
          });
          // 1004 = auth failed, anything else means the key is valid
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { base_resp?: { status_code?: number } };
            return body.base_resp?.status_code !== 1004;
          }
          return true;
        } catch {
          return false;
        }
      },
    },
  },
};

export function getVideoProviderMeta(id: VideoProviderId): VideoProviderMeta {
  const meta = VIDEO_PROVIDERS[id];
  if (!meta) throw new Error(`Unknown video provider: ${id}`);
  return meta;
}

export function getAllVideoProviderMeta(): VideoProviderMeta[] {
  return Object.values(VIDEO_PROVIDERS);
}

export function getVideoProviderIds(): VideoProviderId[] {
  return Object.keys(VIDEO_PROVIDERS) as VideoProviderId[];
}

export function isValidVideoProviderId(id: string): id is VideoProviderId {
  return id in VIDEO_PROVIDERS;
}

/** Map a video model ID to its provider. */
export function getVideoModelProvider(modelId: string): VideoProviderId | null {
  for (const provider of Object.values(VIDEO_PROVIDERS)) {
    if (provider.models.some((m) => m.id === modelId)) return provider.id;
  }
  return null;
}
