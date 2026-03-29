/**
 * Declarative avatar provider registry — capabilities, model catalog, and costs.
 * Follows the same pattern as video-registry.ts.
 *
 * Model IDs and display names come from pricetoken.ai — prices are fetched
 * dynamically at runtime via avatar-cost-estimator.ts.
 */

export type AvatarProviderId = 'heygen' | 'fal' | 'runway' | 'replicate';

export interface AvatarModelOption {
  id: string;
  displayName: string;
  tier: 'standard' | 'premium' | 'translation';
  /** True for lip-sync models that require a user-uploaded portrait image. */
  requiresImage?: boolean;
}

export interface AvatarProviderMeta {
  id: AvatarProviderId;
  displayName: string;
  getApiKeyUrl: string;
  defaultModel: string;
  models: AvatarModelOption[];
  /** Env var name for the platform API key. */
  platformKeyEnv: string;
  disabled?: boolean;
  disabledReason?: string;
  auth: {
    validate: (credentials: Record<string, string>) => Promise<boolean>;
  };
}

const AVATAR_PROVIDERS: Record<AvatarProviderId, AvatarProviderMeta> = {
  heygen: {
    id: 'heygen',
    displayName: 'HeyGen',
    getApiKeyUrl: 'https://app.heygen.com/settings?nav=API',
    defaultModel: 'heygen-avatar-standard',
    models: [
      // Standard tier
      { id: 'heygen-avatar-standard', displayName: 'Standard Avatar', tier: 'standard' },
      { id: 'heygen-photo-avatar-iii', displayName: 'Photo Avatar III', tier: 'standard' },
      { id: 'heygen-public-avatar-iii', displayName: 'Public Avatar III', tier: 'standard' },
      { id: 'heygen-digital-twin-iii', displayName: 'Digital Twin III', tier: 'standard' },
      // Premium tier
      { id: 'heygen-avatar-iv', displayName: 'Interactive Avatar IV', tier: 'premium' },
      { id: 'heygen-digital-twin-iv', displayName: 'Digital Twin IV', tier: 'premium' },
      { id: 'heygen-photo-avatar-iv', displayName: 'Photo Avatar IV', tier: 'premium' },
      { id: 'heygen-public-avatar-iv', displayName: 'Public Avatar IV', tier: 'premium' },
      // Translation tier
      { id: 'heygen-translation-proofread', displayName: 'Video Translation — Proofread', tier: 'translation' },
      { id: 'heygen-translation-speed', displayName: 'Video Translation — Speed Mode', tier: 'translation' },
      { id: 'heygen-translation-precision', displayName: 'Video Translation — Precision Mode', tier: 'translation' },
      { id: 'heygen-video-translation', displayName: 'Video Translation', tier: 'translation' },
    ],
    platformKeyEnv: 'HEYGEN_API_KEY',
    auth: {
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.heygen.com/v2/avatars', {
            headers: { 'x-api-key': creds.apiKey },
          });
          return res.ok;
        } catch {
          return false;
        }
      },
    },
  },

  runway: {
    id: 'runway',
    displayName: 'Runway',
    getApiKeyUrl: 'https://dev.runwayml.com',
    defaultModel: 'runway-characters',
    models: [
      { id: 'runway-characters', displayName: 'Runway Characters (GWM-1 Avatars)', tier: 'premium' },
    ],
    platformKeyEnv: 'RUNWAY_API_KEY',
    disabled: true,
    disabledReason: 'Conversational AI only — audio-driven lip sync not available via API',
    auth: {
      validate: async (creds) => {
        try {
          const res = await fetch('https://api.dev.runwayml.com/v1/avatars?limit=1', {
            headers: {
              Authorization: `Bearer ${creds.apiKey}`,
              'X-Runway-Version': '2024-11-06',
            },
          });
          return res.ok;
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
    defaultModel: 'fal-veed-fabric-1.0',
    models: [
      { id: 'fal-heygen-avatar4-i2v', displayName: 'HeyGen Avatar4 (Image-to-Video)', tier: 'premium' },
      { id: 'fal-heygen-avatar4-twin', displayName: 'HeyGen Avatar4 (Digital Twin)', tier: 'premium' },
      { id: 'fal-veed-fabric-1.0', displayName: 'VEED Fabric 1.0 (Lip Sync)', tier: 'standard', requiresImage: true },
      { id: 'fal-kling-avatar-v2-pro', displayName: 'Kling Avatar v2 Pro (Lip Sync)', tier: 'premium', requiresImage: true },
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
  replicate: {
    id: 'replicate',
    displayName: 'Replicate',
    getApiKeyUrl: 'https://replicate.com/account/api-tokens',
    defaultModel: 'replicate-sadtalker',
    models: [
      { id: 'replicate-sadtalker', displayName: 'SadTalker (Talking Face)', tier: 'standard', requiresImage: true },
      { id: 'replicate-veed-fabric-480p', displayName: 'VEED Fabric 1.0 480p', tier: 'standard', requiresImage: true },
      { id: 'replicate-veed-fabric-720p', displayName: 'VEED Fabric 1.0 720p', tier: 'premium', requiresImage: true },
      { id: 'replicate-dreamactor-m2', displayName: 'DreamActor M2.0', tier: 'premium', requiresImage: true },
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

export function getAvatarProviderMeta(id: AvatarProviderId): AvatarProviderMeta {
  const meta = AVATAR_PROVIDERS[id];
  if (!meta) throw new Error(`Unknown avatar provider: ${id}`);
  return meta;
}

export function getAllAvatarProviderMeta(): AvatarProviderMeta[] {
  return Object.values(AVATAR_PROVIDERS);
}

export function getAvatarProviderIds(): AvatarProviderId[] {
  return Object.keys(AVATAR_PROVIDERS) as AvatarProviderId[];
}

export function isValidAvatarProviderId(id: string): id is AvatarProviderId {
  return id in AVATAR_PROVIDERS;
}

export function getAvatarModelProvider(modelId: string): AvatarProviderId | null {
  for (const provider of Object.values(AVATAR_PROVIDERS)) {
    if (provider.models.some((m) => m.id === modelId)) return provider.id;
  }
  return null;
}

/** Set of all known avatar model IDs across all providers. */
export function getAllAvatarModelIds(): Set<string> {
  const ids = new Set<string>();
  for (const provider of Object.values(AVATAR_PROVIDERS)) {
    for (const model of provider.models) {
      ids.add(model.id);
    }
  }
  return ids;
}
