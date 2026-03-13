import { PriceTokenClient, STATIC_AVATAR_PRICING } from 'pricetoken';
import type { AvatarModelPricing } from 'pricetoken';
import { getAllAvatarModelIds } from '@/lib/providers/avatar-registry';
import { logger } from '@/lib/logger';

export interface AvatarModelInfo {
  modelId: string;
  displayName: string;
  costPerMinute: number;
  avatarType: string | null;
  maxDuration: number | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let avatarCache: { data: AvatarModelInfo[]; expiresAt: number } | null = null;

function mapAvatarModel(m: AvatarModelPricing): AvatarModelInfo {
  return {
    modelId: m.modelId,
    displayName: m.displayName,
    costPerMinute: m.costPerMinute,
    avatarType: m.avatarType ?? null,
    maxDuration: m.maxDuration ?? null,
  };
}

/** Maps registry model IDs to pricetoken model IDs where they differ. */
const PRICETOKEN_AVATAR_MAP: Record<string, string> = {
  'fal-veed-fabric-1.0': 'fal-veed-fabric-1-480p',
  'fal-kling-avatar-v2-pro': 'fal-kling-lipsync-t2v',
};

function mapPricetokenToRegistry(pricetokenId: string, knownIds: Set<string>): string | null {
  if (knownIds.has(pricetokenId)) return pricetokenId;
  for (const [registryId, ptId] of Object.entries(PRICETOKEN_AVATAR_MAP)) {
    if (ptId === pricetokenId && knownIds.has(registryId)) return registryId;
  }
  return null;
}

function staticAvatarModels(): AvatarModelInfo[] {
  const knownIds = getAllAvatarModelIds();
  return STATIC_AVATAR_PRICING
    .map((m) => {
      const registryId = mapPricetokenToRegistry(m.modelId, knownIds);
      if (!registryId) return null;
      return { ...mapAvatarModel(m), modelId: registryId };
    })
    .filter((m): m is AvatarModelInfo => m !== null);
}

/** Fetch avatar models from all providers with live pricing from pricetoken. */
export async function fetchAvatarModels(): Promise<AvatarModelInfo[]> {
  const now = Date.now();
  if (avatarCache && now < avatarCache.expiresAt) return avatarCache.data;

  const knownIds = getAllAvatarModelIds();

  try {
    const apiKey = process.env.PRICETOKEN_API_KEY;
    const client = new PriceTokenClient(apiKey ? { apiKey } : undefined);
    const [heygenModels, falModels, runwayModels] = await Promise.all([
      client.getAvatarPricing({ provider: 'heygen' }).catch(() => [] as AvatarModelPricing[]),
      client.getAvatarPricing({ provider: 'fal' }).catch(() => [] as AvatarModelPricing[]),
      client.getAvatarPricing({ provider: 'runway' }).catch(() => [] as AvatarModelPricing[]),
    ]);
    const all = [...heygenModels, ...falModels, ...runwayModels];
    const models = all
      .map((m) => {
        const registryId = mapPricetokenToRegistry(m.modelId, knownIds);
        if (!registryId) return null;
        return { ...mapAvatarModel(m), modelId: registryId };
      })
      .filter((m): m is AvatarModelInfo => m !== null);

    if (models.length > 0) {
      avatarCache = { data: models, expiresAt: now + CACHE_TTL_MS };
      return models;
    }
  } catch (err) {
    logger.warn('Failed to fetch avatar pricing from pricetoken, using static fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const fallback = staticAvatarModels();
  avatarCache = { data: fallback, expiresAt: now + CACHE_TTL_MS };
  return fallback;
}

export function estimateAvatarCost(
  durationSeconds: number,
  speakerCount: number,
  costPerMinute: number,
): number {
  const perSpeakerCost = (durationSeconds / 60) * costPerMinute;
  return perSpeakerCost * speakerCount;
}

export { formatCost as formatAvatarCost } from '@/lib/video-cost-estimator';
