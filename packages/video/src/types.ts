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

export interface RenderInput extends VisualsInput {
  audioUrl: string;
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  width: 1280,
  height: 720,
  fps: 30,
  codec: 'h264',
  crf: 23,
  audioBitrate: '192k',
};

export const DEFAULT_BRANDING: Branding = {
  primaryColor: '#D97706',
  accentColor: '#1E3A5F',
  backgroundColor: '#FEFCF8',
  headingFont: 'DM Serif Display',
  bodyFont: 'Inter',
};
