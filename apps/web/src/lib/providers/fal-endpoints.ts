/**
 * Map pricetoken model IDs to Fal REST API endpoints.
 * This is endpoint routing only — model catalogs and pricing come from pricetoken.
 */

const IMAGE_ENDPOINTS: Record<string, string> = {
  'fal-flux-1-schnell': 'fal-ai/flux/schnell',
  'fal-flux-1-pro': 'fal-ai/flux-pro/v1.1',
  'fal-flux-2-pro': 'fal-ai/flux-pro/v2',
  'fal-recraft-v3': 'fal-ai/recraft-v3',
  'fal-ideogram-v2': 'fal-ai/ideogram/v2',
  'fal-sd3': 'fal-ai/stable-diffusion-v3-medium',
};

const VIDEO_ENDPOINTS: Record<string, string> = {
  'fal-veo3-1080p': 'fal-ai/veo3',
  'fal-veo3-fast-1080p': 'fal-ai/veo3/fast',
  'fal-kling3-1080p': 'fal-ai/kling-video/v3/master/text-to-video',
  'fal-wan2.5-480p': 'fal-ai/wan/v2.5/text-to-video',
};

/** Map common shorthand / legacy model IDs to their canonical pricetoken IDs. */
const MODEL_ALIASES: Record<string, string> = {
  'flux-schnell': 'fal-flux-1-schnell',
  'flux-1-schnell': 'fal-flux-1-schnell',
  'flux-pro': 'fal-flux-1-pro',
  'flux-1-pro': 'fal-flux-1-pro',
  'flux-2-pro': 'fal-flux-2-pro',
  'recraft-v3': 'fal-recraft-v3',
  'ideogram-v2': 'fal-ideogram-v2',
  'sd3': 'fal-sd3',
};

function resolveModelId(modelId: string): string {
  return MODEL_ALIASES[modelId] ?? modelId;
}

export function getFalImageEndpoint(modelId: string): string | null {
  return IMAGE_ENDPOINTS[resolveModelId(modelId)] ?? null;
}

export function getFalVideoEndpoint(modelId: string): string | null {
  return VIDEO_ENDPOINTS[resolveModelId(modelId)] ?? null;
}

export function isFalVideoModel(modelId: string): boolean {
  return resolveModelId(modelId) in VIDEO_ENDPOINTS;
}

export function isFalImageModel(modelId: string): boolean {
  return resolveModelId(modelId) in IMAGE_ENDPOINTS;
}

/** Set of pricetoken model IDs that have a known Fal image endpoint. */
export const FAL_IMAGE_MODEL_IDS = new Set(Object.keys(IMAGE_ENDPOINTS));

/** Set of pricetoken model IDs that have a known Fal video endpoint. */
export const FAL_VIDEO_MODEL_IDS = new Set(Object.keys(VIDEO_ENDPOINTS));

const AVATAR_ENDPOINTS: Record<string, string> = {
  'fal-heygen-avatar4-i2v': 'fal-ai/heygen/avatar4/image-to-video',
  'fal-heygen-avatar4-twin': 'fal-ai/heygen/avatar4/digital-twin',
};

export function getFalAvatarEndpoint(modelId: string): string | null {
  return AVATAR_ENDPOINTS[modelId] ?? null;
}

export function isFalAvatarModel(modelId: string): boolean {
  return modelId in AVATAR_ENDPOINTS;
}

/** Set of pricetoken model IDs that have a known Fal avatar endpoint. */
export const FAL_AVATAR_MODEL_IDS = new Set(Object.keys(AVATAR_ENDPOINTS));
