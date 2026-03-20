import { PriceTokenClient, STATIC_IMAGE_PRICING, STATIC_VIDEO_PRICING } from 'pricetoken';
import type { ImageModelPricing, VideoModelPricing } from 'pricetoken';
import type { PipelineSegmentNode, PipelineTransition, FalImageModelInfo, FalVideoModelInfo } from '@/types/pipeline';
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

/** Video models from the registry that aren't in pricetoken (e.g. Hera). */
function registryOnlyVideoModels(alreadyFetched: Set<string>): FalVideoModelInfo[] {
  const result: FalVideoModelInfo[] = [];
  for (const provider of getAllVideoProviderMeta()) {
    for (const model of provider.models) {
      if (!alreadyFetched.has(model.id)) {
        result.push({
          modelId: model.id,
          displayName: model.displayName,
          costPerMinute: model.costPerMinute,
          resolution: null,
          maxDuration: 60, // registry models default to 60s max
          qualityMode: model.tier,
        });
      }
    }
  }
  return result;
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

/** Return video models from all providers (FAL + MiniMax + Runway) with live pricing. */
export async function fetchAllVideoModels(): Promise<FalVideoModelInfo[]> {
  const now = Date.now();
  if (videoCache && now < videoCache.expiresAt) return videoCache.data;

  const knownIds = getAllVideoModelIds();

  try {
    const apiKey = process.env.PRICETOKEN_API_KEY;
    const client = new PriceTokenClient(apiKey ? { apiKey } : undefined);
    // Fetch from all video providers
    const [falModels, minimaxModels, runwayModels, replicateModels] = await Promise.all([
      client.getVideoPricing({ provider: 'fal' }).catch(() => [] as VideoModelPricing[]),
      client.getVideoPricing({ provider: 'minimax' }).catch(() => [] as VideoModelPricing[]),
      client.getVideoPricing({ provider: 'runway' }).catch(() => [] as VideoModelPricing[]),
      client.getVideoPricing({ provider: 'replicate' }).catch(() => [] as VideoModelPricing[]),
    ]);
    const all = [...falModels, ...minimaxModels, ...runwayModels, ...replicateModels];
    const models = all
      .filter((m) => knownIds.has(m.modelId))
      .map(mapVideoModel);

    if (models.length > 0) {
      // Append registry-only models not covered by pricetoken (e.g. Hera)
      const fetchedIds = new Set(models.map((m) => m.modelId));
      const extra = registryOnlyVideoModels(fetchedIds);
      const merged = [...models, ...extra];
      videoCache = { data: merged, expiresAt: now + CACHE_TTL_MS };
      return merged;
    }
  } catch (err) {
    logger.warn('Failed to fetch video pricing from pricetoken, using static fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const fallback = staticFalVideoModels();
  // Append registry-only models to fallback too
  const fallbackIds = new Set(fallback.map((m) => m.modelId));
  const extra = registryOnlyVideoModels(fallbackIds);
  const merged = [...fallback, ...extra];
  videoCache = { data: merged, expiresAt: now + CACHE_TTL_MS };
  return merged;
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

function estimateSingleVisualCost(
  visualMode: string,
  model: string | null,
  duration: number,
  imageModels: ImageModelCostInfo[],
  videoModels: VideoModelCostInfo[],
): number {
  if (visualMode === 'programmatic' || !model) return 0;

  if (visualMode === 'image') {
    const im = imageModels.find((m) => m.modelId === model);
    if (!im) return 0;
    return im.pricePerImage;
  }

  if (visualMode === 'video') {
    const vm = videoModels.find((m) => m.modelId === model);
    if (!vm) return 0;
    const maxDur = vm.maxDuration ?? 10;
    const { totalDuration } = getClipInfo(duration, maxDur);
    const videoCost = (totalDuration / 60) * vm.costPerMinute;
    const cheapestImagePrice = imageModels.length > 0
      ? Math.min(...imageModels.map((m) => m.pricePerImage))
      : 0;
    const frameCost = cheapestImagePrice * 2;
    return videoCost + frameCost;
  }

  return 0;
}

export function estimateSegmentCost(
  segment: PipelineSegmentNode,
  imageModels: ImageModelCostInfo[],
  videoModels: VideoModelCostInfo[],
): number {
  // If segment has sub-visuals, sum cost per sub-visual
  if (segment.subVisuals && segment.subVisuals.length > 0) {
    return segment.subVisuals.reduce((sum, sv) =>
      sum + estimateSingleVisualCost(sv.visualMode, sv.model, sv.duration, imageModels, videoModels),
    0);
  }

  return estimateSingleVisualCost(segment.visualMode, segment.model, segment.duration, imageModels, videoModels);
}

export function estimateTransitionCost(
  transition: PipelineTransition,
  videoModels: VideoModelCostInfo[],
): number {
  if (!transition.enabled || !transition.transitionModel) return 0;
  const vm = videoModels.find((m) => m.modelId === transition.transitionModel);
  if (!vm) return 0;
  return (transition.durationSeconds / 60) * vm.costPerMinute;
}

export function estimateAllTransitionsCost(
  transitions: PipelineTransition[],
  videoModels: VideoModelCostInfo[],
): number {
  return transitions.reduce((sum, t) => sum + estimateTransitionCost(t, videoModels), 0);
}

export function estimatePipelineCost(
  segments: PipelineSegmentNode[],
  imageModels: ImageModelCostInfo[],
  videoModels: VideoModelCostInfo[],
  transitions?: PipelineTransition[],
): number {
  const segmentCost = segments.reduce((sum, seg) => sum + estimateSegmentCost(seg, imageModels, videoModels), 0);
  const transitionCost = transitions ? estimateAllTransitionsCost(transitions, videoModels) : 0;
  return segmentCost + transitionCost;
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
