import { PriceTokenClient, type ImageModelPricing, type VideoModelPricing } from 'pricetoken';
import type { PipelineSegmentNode } from '@/types/pipeline';
import { getFalImageEndpoint, getFalVideoEndpoint } from './providers/fal-endpoints';

/** Minimal image model shape needed for cost estimation (accepts both ImageModelPricing and FalImageModelInfo). */
export type ImageModelCostInfo = { modelId: string; pricePerImage: number };
/** Minimal video model shape needed for cost estimation (accepts both VideoModelPricing and FalVideoModelInfo). */
export type VideoModelCostInfo = { modelId: string; costPerMinute: number; maxDuration?: number | null };

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
    const duration = Math.min(segment.duration, model.maxDuration ?? 10);
    return (duration / 60) * model.costPerMinute;
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

/** Fetch live Fal image models from pricetoken API, filtered to models with known endpoints. */
export async function fetchFalImageModels(): Promise<ImageModelPricing[]> {
  const apiKey = process.env.PRICETOKEN_API_KEY;
  const client = new PriceTokenClient(apiKey ? { apiKey } : undefined);
  const models = await client.getImagePricing({ provider: 'fal' });
  return models.filter((m) => getFalImageEndpoint(m.modelId));
}

/** Fetch live Fal video models from pricetoken API, filtered to models with known endpoints. */
export async function fetchFalVideoModels(): Promise<VideoModelPricing[]> {
  const apiKey = process.env.PRICETOKEN_API_KEY;
  const client = new PriceTokenClient(apiKey ? { apiKey } : undefined);
  const models = await client.getVideoPricing({ provider: 'fal' });
  return models.filter((m) => getFalVideoEndpoint(m.modelId));
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
