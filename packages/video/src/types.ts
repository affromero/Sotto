export interface VideoSubVisual {
  subOrder: number;
  startOffset: number; // seconds from segment start
  duration: number; // seconds
  visualType: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
  assetUrl?: string;
  assetType?: string;
}

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
  subVisuals?: VideoSubVisual[];
  ttsProvider?: string; // Showcase: per-segment TTS provider ID (e.g. 'elevenlabs')
  ttsModel?: string; // Showcase: per-segment TTS model ID
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

export interface VideoTransition {
  fromSegmentOrder: number;
  toSegmentOrder: number;
  assetUrl: string;
  durationSeconds: number;
}

export interface VisualsInput {
  segments: VideoSegment[];
  config: RenderConfig;
  branding: Branding;
  transitions?: VideoTransition[];
  enableLightLeaks?: boolean;
}

export interface AvatarOverlayInput {
  speaker: string;
  videoUrl: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  maskShape?: 'none' | 'rounded' | 'circle';
}

export interface RenderInput extends VisualsInput {
  audioUrl: string;
  avatarOverlays?: AvatarOverlayInput[];
}

/** A single zoom-level frame for globe-to-location zoom animations in MapSlide. */
export interface MapZoomFrame {
  zoom: number;
  assetUrl: string;
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
  MAP_OVERLAY: 'MAP_OVERLAY',
} as const;

export type VisualTypeValue = (typeof VisualType)[keyof typeof VisualType];

export const DEFAULT_BRANDING: Branding = {
  primaryColor: '#D97706',
  accentColor: '#1E3A5F',
  backgroundColor: '#FEFCF8',
  headingFont: 'DM Serif Display',
  bodyFont: 'Inter',
};

// ---------------------------------------------------------------------------
// Launch Video types (demo/launch composition pipeline)
// ---------------------------------------------------------------------------

export interface TimingSegment {
  start: number;
  end: number;
  speed: number; // 0 = skip, 1 = normal, 8 = fast
}

export interface ActionTimingEntry {
  type: string;
  timestampMs: number;
  meta?: Record<string, unknown>;
}

export interface SceneSfxConfig {
  clickSounds?: boolean;
  typingSounds?: boolean;
  ambientUrl?: string;
  ambientVolume?: number;
  cues?: Array<{ atSeconds: number; sfxUrl: string; volume?: number }>;
}

export interface ProviderBannerConfig {
  provider: string;
  showAtSeconds?: number;
  hideAtSeconds?: number | null;
  position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
}

export interface TextOverlayConfig {
  text: string;
  position: 'center' | 'bottom-center' | 'top-center' | 'bottom-left' | 'bottom-right';
  showAtSeconds: number;
  hideAtSeconds: number;
  fontSize?: number;
  backgroundColor?: string;
  textColor?: string;
}

export interface SubtitleConfig {
  enabled: boolean;
  style?: 'default' | 'cinematic';
  position?: 'bottom' | 'top';
  fontSize?: number;
}

export interface LaunchAvatarConfig {
  videoUrl?: string;
  posX?: number;
  posY?: number;
  width?: number;
  height?: number;
  maskShape?: 'none' | 'rounded' | 'circle';
  showAtSeconds?: number;
  hideAtSeconds?: number | null;
}

export interface LaunchSceneInput {
  recordingUrl: string;
  voiceoverUrl?: string;
  timingSegments?: TimingSegment[];
  sfxConfig?: SceneSfxConfig;
  actionTimingLog?: ActionTimingEntry[];
  providerBanner?: ProviderBannerConfig;
  overlays?: TextOverlayConfig[];
  subtitles?: SubtitleConfig;
  narration?: string;
  avatarConfig?: LaunchAvatarConfig;
  transitionUrl?: string;
  /** Pre-calculated by worker via /probe — seconds */
  recordingDurationSec?: number;
  /** Pre-calculated by worker via /probe — seconds */
  voiceoverDurationSec?: number;
}

export interface LaunchVideoInput {
  scenes: LaunchSceneInput[];
  backgroundMusicUrl?: string;
  backgroundMusicVolume?: number;
  gradeVideo?: boolean;
  config?: RenderConfig;
}
