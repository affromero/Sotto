import { PriceTokenClient, STATIC_AVATAR_PRICING } from 'pricetoken';
import type { AvatarModelPricing } from 'pricetoken';
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

function staticHeygenModels(): AvatarModelInfo[] {
  return STATIC_AVATAR_PRICING
    .filter((m) => m.provider === 'heygen')
    .map(mapAvatarModel);
}

export async function fetchAvatarModels(): Promise<AvatarModelInfo[]> {
  const now = Date.now();
  if (avatarCache && now < avatarCache.expiresAt) return avatarCache.data;

  try {
    const apiKey = process.env.PRICETOKEN_API_KEY;
    const client = new PriceTokenClient(apiKey ? { apiKey } : undefined);
    const all = await client.getAvatarPricing({ provider: 'heygen' });
    const models = all.map(mapAvatarModel);

    if (models.length > 0) {
      avatarCache = { data: models, expiresAt: now + CACHE_TTL_MS };
      return models;
    }
  } catch (err) {
    logger.warn('Failed to fetch HeyGen avatar pricing from pricetoken, using static fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const fallback = staticHeygenModels();
  avatarCache = { data: fallback, expiresAt: now + CACHE_TTL_MS };
  return fallback;
}

export function estimateAvatarCost(
  durationSeconds: number,
  speakerCount: number,
  costPerMinute?: number,
): number {
  const rate = costPerMinute ?? 0.10; // default HeyGen rate
  const perSpeakerCost = (durationSeconds / 60) * rate;
  return perSpeakerCost * speakerCount;
}

export { formatCost as formatAvatarCost } from '@/lib/video-cost-estimator';
