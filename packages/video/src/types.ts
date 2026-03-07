export interface VideoSegment {
  segmentId: string;
  order: number;
  speaker: string;
  text: string;
  startTime: number; // seconds
  duration: number; // seconds
  visualType: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
  assetUrl?: string;
  assetType?: string;
}

export interface RenderConfig {
  width: number;
  height: number;
  fps: number;
  codec: 'h264';
  crf: number;
  audioBitrate: string;
}

export interface Branding {
  primaryColor: string; // #D97706
  accentColor: string; // #1E3A5F
  backgroundColor: string; // #FEFCF8
  headingFont: string;
  bodyFont: string;
}

export interface VisualsInput {
  segments: VideoSegment[];
  config: RenderConfig;
  branding: Branding;
}

export interface AvatarOverlayInput {
  speaker: string;
  videoUrl: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
}

export interface RenderInput extends VisualsInput {
  audioUrl: string;
  avatarOverlays?: AvatarOverlayInput[];
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  width: 1280,
  height: 720,
  fps: 30,
  codec: 'h264',
  crf: 23,
  audioBitrate: '192k',
};

/** Render job status values — shared between Remotion sidecar and workers. */
export const RenderStatus = {
  QUEUED: 'queued',
  RENDERING: 'rendering',
  DONE: 'done',
  ERROR: 'error',
} as const;

export type RenderStatusValue = (typeof RenderStatus)[keyof typeof RenderStatus];

/**
 * Visual type enum values — must match Prisma VisualType enum exactly.
 * Single source of truth for DB ↔ Remotion component mapping.
 */
export const VisualType = {
  DATA_CHART: 'DATA_CHART',
  QUOTE: 'QUOTE',
  COMPARISON: 'COMPARISON',
  TIMELINE: 'TIMELINE',
  DIAGRAM: 'DIAGRAM',
  STOCK_FOOTAGE: 'STOCK_FOOTAGE',
  AI_ILLUSTRATION: 'AI_ILLUSTRATION',
  TEXT_CARD: 'TEXT_CARD',
} as const;

export type VisualTypeValue = (typeof VisualType)[keyof typeof VisualType];

export const DEFAULT_BRANDING: Branding = {
  primaryColor: '#D97706',
  accentColor: '#1E3A5F',
  backgroundColor: '#FEFCF8',
  headingFont: 'DM Serif Display',
  bodyFont: 'Inter',
};
