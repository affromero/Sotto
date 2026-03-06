import { STATIC_IMAGE_PRICING, STATIC_VIDEO_PRICING } from 'pricetoken';
import type { PipelineSegmentNode } from '@/types/pipeline';

export function estimateSegmentCost(segment: PipelineSegmentNode): number {
  if (segment.visualMode === 'programmatic' || !segment.model) return 0;

  if (segment.visualMode === 'image') {
    const model = STATIC_IMAGE_PRICING.find((m) => m.modelId === segment.model);
    if (!model) return 0;
    return model.pricePerImage;
  }

  if (segment.visualMode === 'video') {
    const model = STATIC_VIDEO_PRICING.find((m) => m.modelId === segment.model);
    if (!model) return 0;
    const duration = Math.min(segment.duration, model.maxDuration ?? 10);
    return (duration / 60) * model.costPerMinute;
  }

  return 0;
}

export function estimatePipelineCost(segments: PipelineSegmentNode[]): number {
  return segments.reduce((sum, seg) => sum + estimateSegmentCost(seg), 0);
}

export function formatCost(cost: number): string {
  if (cost === 0) return 'Free';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export function cheapestFalImageModel(): string {
  const fal = STATIC_IMAGE_PRICING.filter((m) => m.provider === 'fal');
  fal.sort((a, b) => a.pricePerImage - b.pricePerImage);
  return fal[0]?.modelId ?? 'fal-recraft-v3';
}

export function cheapestFalVideoModel(): string {
  const fal = STATIC_VIDEO_PRICING.filter((m) => m.provider === 'fal');
  fal.sort((a, b) => a.costPerMinute - b.costPerMinute);
  return fal[0]?.modelId ?? 'fal-wan2.5-480p';
}
