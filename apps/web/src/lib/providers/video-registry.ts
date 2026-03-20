/**
 * Declarative video provider registry — capabilities, model catalog, and costs.
 * Follows the same pattern as image-registry.ts.
 */

export type VideoProviderId = 'fal' | 'minimax' | 'hera' | 'replicate';

export interface VideoModelOption {
  id: string;
  displayName: string;
  tier: 'standard' | 'high' | 'best';
  /** Cost per minute of generated video (USD). */
  costPerMinute: number;
  /** If true, the model requires a first-frame image (image-to-video only). */
  requiresFirstFrame?: boolean;
  /** If true, the model accepts (but may not require) a first-frame image. */
  supportsFirstFrame?: boolean;
  /** If true, the model accepts a last-frame image (e.g. FLF2V, Kling tail_image_url). */
  supportsLastFrame?: boolean;
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
      { id: 'fal-wan2.5-480p', displayName: 'Wan 2.5 (480p)', tier: 'standard', costPerMinute: 3, supportsFirstFrame: true },
      { id: 'fal-kling3-1080p', displayName: 'Kling 3 (1080p)', tier: 'high', costPerMinute: 6, supportsFirstFrame: true },
      { id: 'fal-veo3-fast-1080p', displayName: 'Veo 3 Fast (1080p)', tier: 'high', costPerMinute: 6, supportsFirstFrame: true },
      { id: 'fal-veo3-1080p', displayName: 'Veo 3 (1080p)', tier: 'best', costPerMinute: 24, supportsFirstFrame: true },
      { id: 'fal-veo3.1-flf2v-1080p', displayName: 'Veo 3.1 FLF2V (1080p)', tier: 'best', costPerMinute: 24, requiresFirstFrame: true, supportsFirstFrame: true, supportsLastFrame: true },
      { id: 'fal-veo3.1-fast-flf2v-1080p', displayName: 'Veo 3.1 Fast FLF2V (1080p)', tier: 'high', costPerMinute: 6, requiresFirstFrame: true, supportsFirstFrame: true, supportsLastFrame: true },
      { id: 'fal-kling2.5-pro-i2v-1080p', displayName: 'Kling 2.5 Pro I2V (1080p)', tier: 'high', costPerMinute: 6, requiresFirstFrame: true, supportsFirstFrame: true, supportsLastFrame: true },
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

  hera: {
    id: 'hera',
    displayName: 'Hera',
    getApiKeyUrl: 'https://hera.video',
    defaultModel: 'hera-motion-1080p',
    models: [
      { id: 'hera-motion-1080p', displayName: 'Hera Motion (1080p)', tier: 'standard', costPerMinute: 1.5, supportsFirstFrame: true },
    ],
    platformKeyEnv: 'HERA_API_KEY',
    auth: {
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.hera.video/v1/generations', {
            method: 'POST',
            headers: { 'x-api-key': creds.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'test', duration: 1 }),
          });
          // Any non-401/403 means the key is valid (the request itself may fail for other reasons)
          return res.status !== 401 && res.status !== 403;
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
    defaultModel: 'minimax-hailuo02-768p',
    models: [
      { id: 'minimax-hailuo02-512p', displayName: 'Hailuo 02 (512p)', tier: 'standard', costPerMinute: 0.8, requiresFirstFrame: true, supportsFirstFrame: true },
      { id: 'minimax-hailuo02-768p', displayName: 'Hailuo 02 (768p)', tier: 'standard', costPerMinute: 3.19, supportsFirstFrame: true },
      { id: 'minimax-hailuo02-pro-1080p', displayName: 'Hailuo 02 Pro (1080p)', tier: 'high', costPerMinute: 5.32, supportsFirstFrame: true },
      { id: 'minimax-hailuo23-fast-1080p', displayName: 'Hailuo 2.3 Fast (1080p)', tier: 'high', costPerMinute: 3.46, supportsFirstFrame: true },
      { id: 'minimax-hailuo23-fast-768p', displayName: 'Hailuo 2.3 Fast (768p)', tier: 'best', costPerMinute: 1.76, supportsFirstFrame: true },
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

  replicate: {
    id: 'replicate',
    displayName: 'Replicate',
    getApiKeyUrl: 'https://replicate.com/account/api-tokens',
    defaultModel: 'replicate-wan2.2-t2v-fast-480p',
    models: [
      { id: 'replicate-wan2.2-t2v-fast-480p', displayName: 'Wan 2.2 Fast T2V (480p)', tier: 'standard', costPerMinute: 0.18 },
      { id: 'replicate-ltx-video-768p', displayName: 'LTX-Video (768p)', tier: 'standard', costPerMinute: 0.26 },
      { id: 'replicate-seedance1-lite-480p', displayName: 'Seedance 1.0 Lite (480p)', tier: 'standard', costPerMinute: 1.08, supportsFirstFrame: true },
      { id: 'replicate-seedance1-pro-fast-720p', displayName: 'Seedance 1.0 Pro Fast (720p)', tier: 'standard', costPerMinute: 2.4, requiresFirstFrame: true, supportsFirstFrame: true },
      { id: 'replicate-haiper-v2-720p', displayName: 'Haiper Video 2 (720p)', tier: 'standard', costPerMinute: 3, supportsFirstFrame: true },
      { id: 'replicate-pixverse-v4-360p', displayName: 'PixVerse v4 (360p)', tier: 'high', costPerMinute: 3.6, supportsFirstFrame: true },
      { id: 'replicate-wan2.1-i2v-480p', displayName: 'Wan 2.1 I2V (480p)', tier: 'high', costPerMinute: 5.4, requiresFirstFrame: true, supportsFirstFrame: true },
      { id: 'replicate-wan2.1-i2v-720p', displayName: 'Wan 2.1 I2V (720p)', tier: 'best', costPerMinute: 15, requiresFirstFrame: true, supportsFirstFrame: true },
    ],
    platformKeyEnv: 'REPLICATE_API_TOKEN',
    auth: {
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.replicate.com/v1/models', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
          });
          return res.ok;
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

/** Check if a video model requires a first-frame image (image-to-video only). */
export function videoModelRequiresFirstFrame(modelId: string): boolean {
  for (const provider of Object.values(VIDEO_PROVIDERS)) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return model.requiresFirstFrame === true;
  }
  return false;
}

/** Check if a video model accepts a first-frame image (optional or required). */
export function videoModelSupportsFirstFrame(modelId: string): boolean {
  for (const provider of Object.values(VIDEO_PROVIDERS)) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return model.supportsFirstFrame === true || model.requiresFirstFrame === true;
  }
  return false;
}

/** Check if a video model accepts a last-frame image. */
export function videoModelSupportsLastFrame(modelId: string): boolean {
  for (const provider of Object.values(VIDEO_PROVIDERS)) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return model.supportsLastFrame === true;
  }
  return false;
}
