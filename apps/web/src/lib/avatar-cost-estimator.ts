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

const LOCAL_AVATAR_PRICING: AvatarModelInfo[] = [
  { modelId: 'fal-veed-fabric-1.0', displayName: 'VEED Fabric 1.0', costPerMinute: 4.80, avatarType: 'lip-sync', maxDuration: 300 },
  { modelId: 'fal-kling-avatar-v2-pro', displayName: 'Kling Avatar v2 Pro', costPerMinute: 0.168, avatarType: 'lip-sync', maxDuration: 60 },
];

function staticAvatarModels(): AvatarModelInfo[] {
  const knownIds = getAllAvatarModelIds();
  const fromPricetoken = STATIC_AVATAR_PRICING
    .filter((m) => knownIds.has(m.modelId))
    .map(mapAvatarModel);
  const localFiltered = LOCAL_AVATAR_PRICING.filter((m) => knownIds.has(m.modelId));
  return [...fromPricetoken, ...localFiltered];
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
      .filter((m) => knownIds.has(m.modelId))
      .map(mapAvatarModel);

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
