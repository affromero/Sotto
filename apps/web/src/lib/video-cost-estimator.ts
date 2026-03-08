import { PriceTokenClient, STATIC_IMAGE_PRICING, STATIC_VIDEO_PRICING } from 'pricetoken';
import type { ImageModelPricing, VideoModelPricing } from 'pricetoken';
import type { PipelineSegmentNode, FalImageModelInfo, FalVideoModelInfo } from '@/types/pipeline';
import { FAL_IMAGE_MODEL_IDS, FAL_VIDEO_MODEL_IDS } from '@/lib/providers/fal-endpoints';
import { getAllVideoProviderMeta } from '@/lib/providers/video-registry';
import { logger } from '@/lib/logger';

/** Minimal image model shape needed for cost estimation. */
export type ImageModelCostInfo = { modelId: string; pricePerImage: number };
/** Minimal video model shape needed for cost estimation. */
export type VideoModelCostInfo = { modelId: string; costPerMinute: number; maxDuration?: number | null };

/** Set of all known video model IDs across all providers. */
function getAllVideoModelIds(): Set<string> {
  const ids = new Set(FAL_VIDEO_MODEL_IDS);
  for (const provider of getAllVideoProviderMeta()) {
    for (const model of provider.models) {
      ids.add(model.id);
    }
  }
  return ids;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let imageCache: { data: FalImageModelInfo[]; expiresAt: number } | null = null;
let videoCache: { data: FalVideoModelInfo[]; expiresAt: number } | null = null;

function mapImageModel(m: ImageModelPricing): FalImageModelInfo {
  return {
    modelId: m.modelId,
    displayName: m.displayName,
    pricePerImage: m.pricePerImage,
    defaultResolution: m.defaultResolution ?? '1280x720',
    qualityTier: m.qualityTier ?? 'standard',
  };
}

function mapVideoModel(m: VideoModelPricing): FalVideoModelInfo {
  return {
    modelId: m.modelId,
    displayName: m.displayName,
    costPerMinute: m.costPerMinute,
    resolution: m.resolution ?? null,
    maxDuration: m.maxDuration ?? null,
    qualityMode: m.qualityMode ?? null,
  };
}

/** Fallback: derive FAL image models from pricetoken static data. */
function staticFalImageModels(): FalImageModelInfo[] {
  return STATIC_IMAGE_PRICING
    .filter((m) => FAL_IMAGE_MODEL_IDS.has(m.modelId))
    .map(mapImageModel);
}

/** Fallback: derive FAL video models from pricetoken static data. */
function staticFalVideoModels(): FalVideoModelInfo[] {
  return STATIC_VIDEO_PRICING
    .filter((m) => FAL_VIDEO_MODEL_IDS.has(m.modelId))
    .map(mapVideoModel);
}

/** Return available Fal image models with live pricing from pricetoken. */
export async function fetchFalImageModels(): Promise<FalImageModelInfo[]> {
  const now = Date.now();
  if (imageCache && now < imageCache.expiresAt) return imageCache.data;

  try {
    const apiKey = process.env.PRICETOKEN_API_KEY;
    const client = new PriceTokenClient(apiKey ? { apiKey } : undefined);
    const all = await client.getImagePricing({ provider: 'fal' });
    const models = all
      .filter((m) => FAL_IMAGE_MODEL_IDS.has(m.modelId))
      .map(mapImageModel);

    if (models.length > 0) {
      imageCache = { data: models, expiresAt: now + CACHE_TTL_MS };
      return models;
    }
  } catch (err) {
    logger.warn('Failed to fetch FAL image pricing from pricetoken, using static fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const fallback = staticFalImageModels();
  imageCache = { data: fallback, expiresAt: now + CACHE_TTL_MS };
  return fallback;
}

/** Return available Fal video models with live pricing from pricetoken. */
export async function fetchFalVideoModels(): Promise<FalVideoModelInfo[]> {
  const now = Date.now();
  if (videoCache && now < videoCache.expiresAt) return videoCache.data;

  try {
    const apiKey = process.env.PRICETOKEN_API_KEY;
    const client = new PriceTokenClient(apiKey ? { apiKey } : undefined);
    const all = await client.getVideoPricing({ provider: 'fal' });
    const models = all
      .filter((m) => FAL_VIDEO_MODEL_IDS.has(m.modelId))
      .map(mapVideoModel);

    if (models.length > 0) {
      videoCache = { data: models, expiresAt: now + CACHE_TTL_MS };
      return models;
    }
  } catch (err) {
    logger.warn('Failed to fetch FAL video pricing from pricetoken, using static fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const fallback = staticFalVideoModels();
  videoCache = { data: fallback, expiresAt: now + CACHE_TTL_MS };
  return fallback;
}

/** Return video models from all providers (FAL + MiniMax) with live pricing. */
export async function fetchAllVideoModels(): Promise<FalVideoModelInfo[]> {
  const now = Date.now();
  if (videoCache && now < videoCache.expiresAt) return videoCache.data;

  const knownIds = getAllVideoModelIds();

  try {
    const apiKey = process.env.PRICETOKEN_API_KEY;
    const client = new PriceTokenClient(apiKey ? { apiKey } : undefined);
    // Fetch from all video providers
    const [falModels, minimaxModels] = await Promise.all([
      client.getVideoPricing({ provider: 'fal' }).catch(() => [] as VideoModelPricing[]),
      client.getVideoPricing({ provider: 'minimax' }).catch(() => [] as VideoModelPricing[]),
    ]);
    const all = [...falModels, ...minimaxModels];
    const models = all
      .filter((m) => knownIds.has(m.modelId))
      .map(mapVideoModel);

    if (models.length > 0) {
      videoCache = { data: models, expiresAt: now + CACHE_TTL_MS };
      return models;
    }
  } catch (err) {
    logger.warn('Failed to fetch video pricing from pricetoken, using static fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const fallback = staticFalVideoModels();
  videoCache = { data: fallback, expiresAt: now + CACHE_TTL_MS };
  return fallback;
}

/** Compute clip count and per-clip duration for a video segment. */
export function getClipInfo(
  segmentDuration: number,
  maxDuration: number,
): { clipCount: number; perClipDuration: number; totalDuration: number } {
  const clipCount = Math.ceil(segmentDuration / maxDuration);
  const perClipDuration = maxDuration;
  // Total billed duration: full clips + remainder
  const remainder = segmentDuration - (clipCount - 1) * maxDuration;
  const totalDuration = (clipCount - 1) * perClipDuration + Math.min(remainder, maxDuration);
  return { clipCount, perClipDuration, totalDuration };
}

export function estimateSegmentCost(
  segment: PipelineSegmentNode,
  imageModels: ImageModelCostInfo[],
  videoModels: VideoModelCostInfo[],
): number {
  if (segment.visualMode === 'programmatic' || !segment.model) return 0;

  if (segment.visualMode === 'image') {
    const model = imageModels.find((m) => m.modelId === segment.model);
    if (!model) return 0;
    return model.pricePerImage;
  }

  if (segment.visualMode === 'video') {
    const model = videoModels.find((m) => m.modelId === segment.model);
    if (!model) return 0;
    const maxDur = model.maxDuration ?? 10;
    const { totalDuration } = getClipInfo(segment.duration, maxDur);
    return (totalDuration / 60) * model.costPerMinute;
  }

  return 0;
}

export function estimatePipelineCost(
  segments: PipelineSegmentNode[],
  imageModels: ImageModelCostInfo[],
  videoModels: VideoModelCostInfo[],
): number {
  return segments.reduce((sum, seg) => sum + estimateSegmentCost(seg, imageModels, videoModels), 0);
}

export function formatCost(cost: number): string {
  if (cost === 0) return 'Free';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export function cheapestModel<T extends { modelId: string }>(
  models: T[],
  costFn: (m: T) => number,
  fallback: string,
): string {
  if (models.length === 0) return fallback;
  const sorted = [...models].sort((a, b) => costFn(a) - costFn(b));
  return sorted[0].modelId;
}
