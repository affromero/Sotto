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

function staticAvatarModels(): AvatarModelInfo[] {
  const knownIds = getAllAvatarModelIds();
  return STATIC_AVATAR_PRICING
    .filter((m) => knownIds.has(m.modelId))
    .map(mapAvatarModel);
}

/** Fetch avatar models from all providers with live pricing from pricetoken. */
export async function fetchAvatarModels(): Promise<AvatarModelInfo[]> {
  const now = Date.now();
  if (avatarCache && now < avatarCache.expiresAt) return avatarCache.data;

  const knownIds = getAllAvatarModelIds();

  try {
    const apiKey = process.env.PRICETOKEN_API_KEY;
    const client = new PriceTokenClient(apiKey ? { apiKey } : undefined);
    const [heygenModels, falModels] = await Promise.all([
      client.getAvatarPricing({ provider: 'heygen' }).catch(() => [] as AvatarModelPricing[]),
      client.getAvatarPricing({ provider: 'fal' }).catch(() => [] as AvatarModelPricing[]),
    ]);
    const all = [...heygenModels, ...falModels];
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
  costPerMinute?: number,
): number {
  const rate = costPerMinute ?? 1.0;
  const perSpeakerCost = (durationSeconds / 60) * rate;
  return perSpeakerCost * speakerCount;
}

export { formatCost as formatAvatarCost } from '@/lib/video-cost-estimator';
