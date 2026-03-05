/**
 * Declarative image provider registry — capabilities, model catalog, and costs.
 * Follows the same pattern as tts-registry.ts.
 */

export type ImageProviderId = 'fal';

export interface ImageModelOption {
  id: string;
  displayName: string;
  costPerMegapixel: number;
  tier: 'standard' | 'high' | 'best';
}

export interface ImageProviderMeta {
  id: ImageProviderId;
  displayName: string;
  getApiKeyUrl: string;
  defaultModel: string;
  models: ImageModelOption[];
  auth: {
    validate: (credentials: Record<string, string>) => Promise<boolean>;
  };
}

const IMAGE_PROVIDERS: Record<ImageProviderId, ImageProviderMeta> = {
  fal: {
    id: 'fal',
    displayName: 'Fal (FLUX)',
    getApiKeyUrl: 'https://fal.ai/dashboard/keys',
    defaultModel: 'flux-schnell',
    models: [
      { id: 'flux-schnell', displayName: 'FLUX Schnell', costPerMegapixel: 0.003, tier: 'standard' },
      { id: 'flux-1.1-pro', displayName: 'FLUX 1.1 Pro', costPerMegapixel: 0.04, tier: 'high' },
      { id: 'flux-2-pro', displayName: 'FLUX 2 Pro', costPerMegapixel: 0.03, tier: 'best' },
    ],
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
};

export function getImageProviderMeta(id: ImageProviderId): ImageProviderMeta {
  const meta = IMAGE_PROVIDERS[id];
  if (!meta) throw new Error(`Unknown image provider: ${id}`);
  return meta;
}

export function getAllImageProviderMeta(): ImageProviderMeta[] {
  return Object.values(IMAGE_PROVIDERS);
}

export function getImageProviderIds(): ImageProviderId[] {
  return Object.keys(IMAGE_PROVIDERS) as ImageProviderId[];
}

export function isValidImageProviderId(id: string): id is ImageProviderId {
  return id in IMAGE_PROVIDERS;
}

export function getImageModelCost(modelId: string): number {
  for (const provider of Object.values(IMAGE_PROVIDERS)) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return model.costPerMegapixel;
  }
  return 0;
}
