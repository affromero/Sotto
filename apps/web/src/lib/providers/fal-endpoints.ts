/**
 * Map pricetoken model IDs to Fal REST API endpoints.
 * This is endpoint routing only — model catalogs and pricing come from pricetoken.
 */

const IMAGE_ENDPOINTS: Record<string, string> = {
  // FLUX family
  'fal-flux-1-schnell': 'fal-ai/flux/schnell',
  'fal-flux-1-pro': 'fal-ai/flux-pro/v1.1',
  'fal-flux-1-kontext-pro': 'fal-ai/flux-pro/kontext',
  'fal-flux-2-pro': 'fal-ai/flux-2-pro',
  'fal-flux-2-flex': 'fal-ai/flux-2-flex',
  // Recraft
  'fal-recraft-v3': 'fal-ai/recraft-v3',
  'fal-recraft-v4-pro': 'fal-ai/recraft/v4/pro/text-to-image',
  // Ideogram
  'fal-ideogram-v2': 'fal-ai/ideogram/v2',
  'fal-ideogram-v3': 'fal-ai/ideogram/v3',
  // Google (Nano Banana = Gemini Image on Fal)
  'fal-nano-banana-2': 'fal-ai/nano-banana-2',
  'fal-nano-banana-pro': 'fal-ai/nano-banana-pro',
  // Qwen Image
  'fal-qwen-image-2-pro': 'fal-ai/qwen-image-2/pro/text-to-image',
};

const VIDEO_ENDPOINTS: Record<string, string> = {
  'fal-veo3-1080p': 'fal-ai/veo3',
  'fal-veo3-fast-1080p': 'fal-ai/veo3/fast',
  'fal-kling3-1080p': 'fal-ai/kling-video/v3/master/text-to-video',
  'fal-wan2.5-480p': 'fal-ai/wan/v2.5/text-to-video',
  'fal-veo3.1-flf2v-1080p': 'fal-ai/veo3.1/first-last-frame-to-video',
  'fal-veo3.1-fast-flf2v-1080p': 'fal-ai/veo3.1/fast/first-last-frame-to-video',
  'fal-kling2.5-pro-i2v-1080p': 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
};

/** Per-model frame parameter names for Fal video endpoints. */
interface FalFrameParamConfig {
  firstFrameParam: string;
  lastFrameParam?: string;
}

const FAL_FRAME_PARAMS: Record<string, FalFrameParamConfig> = {
  // FLF2V models — both frames required
  'fal-veo3.1-flf2v-1080p': { firstFrameParam: 'first_frame_url', lastFrameParam: 'last_frame_url' },
  'fal-veo3.1-fast-flf2v-1080p': { firstFrameParam: 'first_frame_url', lastFrameParam: 'last_frame_url' },
  // Kling I2V — first frame required, tail_image_url optional
  'fal-kling2.5-pro-i2v-1080p': { firstFrameParam: 'image_url', lastFrameParam: 'tail_image_url' },
  // Standard T2V models — image_url is optional first frame
  'fal-veo3-1080p': { firstFrameParam: 'image_url' },
  'fal-veo3-fast-1080p': { firstFrameParam: 'image_url' },
  'fal-kling3-1080p': { firstFrameParam: 'image_url' },
  'fal-wan2.5-480p': { firstFrameParam: 'image_url' },
};

/** Get frame parameter names for a Fal video model. */
export function getFalFrameParams(modelId: string): FalFrameParamConfig {
  const resolved = resolveModelId(modelId);
  return FAL_FRAME_PARAMS[resolved] ?? { firstFrameParam: 'image_url' };
}

/** Map common shorthand / legacy model IDs to their canonical pricetoken IDs. */
const MODEL_ALIASES: Record<string, string> = {
  'flux-schnell': 'fal-flux-1-schnell',
  'flux-1-schnell': 'fal-flux-1-schnell',
  'flux-pro': 'fal-flux-1-pro',
  'flux-1-pro': 'fal-flux-1-pro',
  'flux-kontext-pro': 'fal-flux-1-kontext-pro',
  'flux-1-kontext-pro': 'fal-flux-1-kontext-pro',
  'flux-2-pro': 'fal-flux-2-pro',
  'flux-2-flex': 'fal-flux-2-flex',
  'recraft-v3': 'fal-recraft-v3',
  'recraft-v4-pro': 'fal-recraft-v4-pro',
  'ideogram-v2': 'fal-ideogram-v2',
  'ideogram-v3': 'fal-ideogram-v3',
  'nano-banana-2': 'fal-nano-banana-2',
  'nano-banana-pro': 'fal-nano-banana-pro',
  'qwen-image-2-pro': 'fal-qwen-image-2-pro',
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

/** Check if a model is a WAN text-to-video model (uses num_frames instead of duration). */
export function isFalWanModel(modelId: string): boolean {
  const resolved = resolveModelId(modelId);
  return resolved.startsWith('fal-wan');
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
  'fal-veed-fabric-1.0': 'veed/fabric-1.0',
  'fal-kling-avatar-v2-pro': 'fal-ai/kling-video/ai-avatar/v2/pro',
};

export const LIP_SYNC_CONFIG: Record<string, { maxAudioSeconds: number; outputFormat: string; defaultPrompt?: string }> = {
  'fal-veed-fabric-1.0': { maxAudioSeconds: 300, outputFormat: 'mp4' },
  'fal-kling-avatar-v2-pro': { maxAudioSeconds: 60, outputFormat: 'mp4', defaultPrompt: 'A person speaking to camera' },
};

export function getFalAvatarEndpoint(modelId: string): string | null {
  return AVATAR_ENDPOINTS[modelId] ?? null;
}

export function isFalAvatarModel(modelId: string): boolean {
  return modelId in AVATAR_ENDPOINTS;
}

/** Set of pricetoken model IDs that have a known Fal avatar endpoint. */
export const FAL_AVATAR_MODEL_IDS = new Set(Object.keys(AVATAR_ENDPOINTS));
