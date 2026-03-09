import type { VisualTypeString } from '@/lib/visual-classifier';

export type VisualMode = 'image' | 'video' | 'programmatic';

export interface PipelineSubVisualNode {
  subOrder: number;
  startOffset: number;
  duration: number;
  visualType: VisualTypeString;
  visualMode: VisualMode;
  model: string | null;
  prompt: string | null;
  metadata: Record<string, unknown> | null;
  endStatePrompt: string | null;
  estimatedCost: number;
}

export interface PipelineSegmentNode {
  segmentId: string;
  order: number;
  speaker: string;
  text: string;
  duration: number;
  visualType: VisualTypeString;
  visualMode: VisualMode;
  model: string | null;
  prompt: string | null;
  metadata: Record<string, unknown> | null;
  endStatePrompt: string | null;
  estimatedCost: number;
  subVisuals?: PipelineSubVisualNode[];
}

export interface PipelineTransition {
  fromSegmentOrder: number;
  toSegmentOrder: number;
  fromSegmentId: string;
  toSegmentId: string;
  enabled: boolean;
  recommended: boolean;
  recommendationReason?: string;
  transitionModel: string | null;
  durationSeconds: number;
  estimatedCost: number;
}

export interface VideoPipeline {
  version: 1 | 2 | 3;
  segments: PipelineSegmentNode[];
  transitions?: PipelineTransition[];
  defaultTransitionModel?: string;
  totalEstimatedCost: number;
  defaultImageModel: string;
  defaultVideoModel: string;
}

export interface FalImageModelInfo {
  modelId: string;
  displayName: string;
  pricePerImage: number;
  defaultResolution: string;
  qualityTier: string;
}

export interface FalVideoModelInfo {
  modelId: string;
  displayName: string;
  costPerMinute: number;
  resolution: string | null;
  maxDuration: number | null;
  qualityMode: string | null;
}

export interface FalModelsResponse {
  imageModels: FalImageModelInfo[];
  videoModels: FalVideoModelInfo[];
  hasFalKey: boolean;
}
