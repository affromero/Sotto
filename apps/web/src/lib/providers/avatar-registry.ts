/**
 * Declarative avatar provider registry — capabilities, model catalog, and costs.
 * Follows the same pattern as image-registry.ts.
 */

export type AvatarProviderId = 'heygen';

export interface AvatarModelOption {
  id: string;
  displayName: string;
  tier: 'standard' | 'premium';
  costPerMinute: number;
}

export interface AvatarProviderMeta {
  id: AvatarProviderId;
  displayName: string;
  getApiKeyUrl: string;
  defaultModel: string;
  models: AvatarModelOption[];
  /** Env var name for the platform API key. */
  platformKeyEnv: string;
  auth: {
    validate: (credentials: Record<string, string>) => Promise<boolean>;
  };
}

const AVATAR_PROVIDERS: Record<AvatarProviderId, AvatarProviderMeta> = {
  heygen: {
    id: 'heygen',
    displayName: 'HeyGen',
    getApiKeyUrl: 'https://app.heygen.com/settings?nav=API',
    defaultModel: 'avatar-iii',
    models: [
      { id: 'avatar-iii', displayName: 'Avatar III', tier: 'standard', costPerMinute: 1.0 },
      { id: 'avatar-iv', displayName: 'Avatar IV', tier: 'premium', costPerMinute: 6.0 },
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
