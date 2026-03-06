import type { PipelineSegmentNode, FalImageModelInfo, FalVideoModelInfo } from '@/types/pipeline';

/** Minimal image model shape needed for cost estimation. */
export type ImageModelCostInfo = { modelId: string; pricePerImage: number };
/** Minimal video model shape needed for cost estimation. */
export type VideoModelCostInfo = { modelId: string; costPerMinute: number; maxDuration?: number | null };

/** Static catalog of Fal image models with pricing. */
const FAL_IMAGE_MODELS: FalImageModelInfo[] = [
  { modelId: 'fal-recraft-v3', displayName: 'Recraft V3', pricePerImage: 0.04, defaultResolution: '1280x720', qualityTier: 'high' },
  { modelId: 'fal-flux-1-pro', displayName: 'FLUX 1.1 Pro', pricePerImage: 0.04, defaultResolution: '1280x720', qualityTier: 'high' },
  { modelId: 'fal-flux-2-pro', displayName: 'FLUX 2 Pro', pricePerImage: 0.03, defaultResolution: '1280x720', qualityTier: 'best' },
  { modelId: 'fal-ideogram-v2', displayName: 'Ideogram V2', pricePerImage: 0.08, defaultResolution: '1280x720', qualityTier: 'high' },
  { modelId: 'fal-sd3', displayName: 'SD3 Medium', pricePerImage: 0.003, defaultResolution: '1280x720', qualityTier: 'standard' },
];

/** Static catalog of Fal video models with pricing. */
const FAL_VIDEO_MODELS: FalVideoModelInfo[] = [
  { modelId: 'fal-veo3-1080p', displayName: 'Veo 3 (1080p)', costPerMinute: 3.50, resolution: '1080p', maxDuration: 8, qualityMode: 'quality' },
  { modelId: 'fal-veo3-fast-1080p', displayName: 'Veo 3 Fast (1080p)', costPerMinute: 1.75, resolution: '1080p', maxDuration: 8, qualityMode: 'fast' },
  { modelId: 'fal-kling3-1080p', displayName: 'Kling 3 (1080p)', costPerMinute: 2.00, resolution: '1080p', maxDuration: 10, qualityMode: 'quality' },
  { modelId: 'fal-wan2.5-480p', displayName: 'Wan 2.5 (480p)', costPerMinute: 0.50, resolution: '480p', maxDuration: 5, qualityMode: 'fast' },
];

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

/** Return available Fal image models from local catalog. */
export async function fetchFalImageModels(): Promise<FalImageModelInfo[]> {
  return FAL_IMAGE_MODELS;
}

/** Return available Fal video models from local catalog. */
export async function fetchFalVideoModels(): Promise<FalVideoModelInfo[]> {
  return FAL_VIDEO_MODELS;
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
