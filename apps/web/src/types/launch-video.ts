import { z } from 'zod';
import type { DemoAction } from './demo-actions';
import { demoActionSchema } from '@/lib/validations';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface LaunchVideoScript {
  version: 1;
  project: {
    title: string;
    description?: string;
  };
  defaults: {
    ttsProvider: string;
    ttsModel?: string;
    ttsVoiceId: string;
    backgroundMusicUrl?: string;
    backgroundMusicVolume?: number; // 0.0-1.0, default 0.1
    subtitles?: SubtitleConfig;
  };
  scenes: LaunchVideoScene[];
}

export interface LaunchVideoScene {
  title: string;
  narration: string;
  actions: DemoAction[];
  sfx?: SceneSfxConfig;
  providerBanner?: ProviderBannerConfig;
  avatar?: AvatarConfig;
  overlays?: TextOverlayConfig[];
  subtitles?: SubtitleConfig;
  transition?: { type: 'fade' | 'dissolve' | 'wipe' };
  ttsProvider?: string;
  ttsModel?: string;
  ttsVoiceId?: string;
}

export interface SceneSfxConfig {
  clickSounds?: boolean;       // default true — play click SFX on 'click' actions
  typingSounds?: boolean;      // default true — play keystroke SFX on 'type' actions
  ambientUrl?: string;         // looping background for this scene
  ambientVolume?: number;      // 0.0-1.0, default 0.15
  cues?: SfxCue[];
}

export interface SfxCue {
  atSeconds: number;
  sfxUrl: string;
  volume?: number;
}

export interface ProviderBannerConfig {
  provider: string;              // display name: "ElevenLabs", "OpenAI TTS", etc.
  showAtSeconds?: number;        // default 0
  hideAtSeconds?: number | null; // null = entire scene
  position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
}

export interface AvatarConfig {
  videoUrl?: string;             // pre-generated avatar clip (R2 URL), filled post-generation
  posX?: number;                 // 0.0-1.0, default 0.72
  posY?: number;                 // default 0.05
  width?: number;                // default 0.25
  height?: number;               // default 0.35
  maskShape?: 'none' | 'rounded' | 'circle';
  showAtSeconds?: number;
  hideAtSeconds?: number | null;
}

export interface TextOverlayConfig {
  text: string;
  position: 'center' | 'bottom-center' | 'top-center' | 'bottom-left' | 'bottom-right';
  showAtSeconds: number;
  hideAtSeconds: number;
  fontSize?: number;             // default 24
  backgroundColor?: string;      // default 'rgba(0,0,0,0.7)'
  textColor?: string;            // default '#FFFFFF'
}

export interface SubtitleConfig {
  enabled: boolean;
  style?: 'default' | 'cinematic'; // default = white + black outline, cinematic = larger + box
  position?: 'bottom' | 'top';     // default 'bottom'
  fontSize?: number;                // default 32
}

export interface ActionTimingEntry {
  type: string;
  timestampMs: number;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const sfxCueSchema = z.object({
  atSeconds: z.number().min(0),
  sfxUrl: z.string().url(),
  volume: z.number().min(0).max(1).optional(),
});

const sceneSfxConfigSchema = z.object({
  clickSounds: z.boolean().optional(),
  typingSounds: z.boolean().optional(),
  ambientUrl: z.string().url().optional(),
  ambientVolume: z.number().min(0).max(1).optional(),
  cues: z.array(sfxCueSchema).optional(),
});

const providerBannerConfigSchema = z.object({
  provider: z.string().min(1).max(100),
  showAtSeconds: z.number().min(0).optional(),
  hideAtSeconds: z.number().min(0).nullable().optional(),
  position: z.enum(['bottom-left', 'bottom-right', 'top-left', 'top-right']).optional(),
});

const avatarConfigSchema = z.object({
  videoUrl: z.string().url().optional(),
  posX: z.number().min(0).max(1).optional(),
  posY: z.number().min(0).max(1).optional(),
  width: z.number().min(0.05).max(1).optional(),
  height: z.number().min(0.05).max(1).optional(),
  maskShape: z.enum(['none', 'rounded', 'circle']).optional(),
  showAtSeconds: z.number().min(0).optional(),
  hideAtSeconds: z.number().min(0).nullable().optional(),
});

const textOverlayConfigSchema = z.object({
  text: z.string().min(1).max(500),
  position: z.enum(['center', 'bottom-center', 'top-center', 'bottom-left', 'bottom-right']),
  showAtSeconds: z.number().min(0),
  hideAtSeconds: z.number().min(0),
  fontSize: z.number().min(8).max(120).optional(),
  backgroundColor: z.string().max(50).optional(),
  textColor: z.string().max(50).optional(),
});

const subtitleConfigSchema = z.object({
  enabled: z.boolean(),
  style: z.enum(['default', 'cinematic']).optional(),
  position: z.enum(['bottom', 'top']).optional(),
  fontSize: z.number().min(12).max(72).optional(),
});

const launchVideoSceneSchema = z.object({
  title: z.string().min(1).max(200),
  narration: z.string().min(1),
  actions: z.array(demoActionSchema),
  sfx: sceneSfxConfigSchema.optional(),
  providerBanner: providerBannerConfigSchema.optional(),
  avatar: avatarConfigSchema.optional(),
  overlays: z.array(textOverlayConfigSchema).optional(),
  subtitles: subtitleConfigSchema.optional(),
  transition: z.object({
    type: z.enum(['fade', 'dissolve', 'wipe']),
  }).optional(),
  ttsProvider: z.string().max(50).optional(),
  ttsModel: z.string().max(100).optional(),
  ttsVoiceId: z.string().max(200).optional(),
});

export const launchVideoScriptSchema = z.object({
  version: z.literal(1),
  project: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
  }),
  defaults: z.object({
    ttsProvider: z.string().min(1).max(50),
    ttsModel: z.string().max(100).optional(),
    ttsVoiceId: z.string().min(1).max(200),
    backgroundMusicUrl: z.string().url().optional(),
    backgroundMusicVolume: z.number().min(0).max(1).optional(),
    subtitles: subtitleConfigSchema.optional(),
  }),
  scenes: z.array(launchVideoSceneSchema).min(1),
});

/** Body for POST /api/admin/demo/[projectId]/import-script */
export const importScriptBodySchema = z.object({
  script: launchVideoScriptSchema,
});

/** Body for POST /api/admin/demo/[projectId]/podcast */
export const linkPodcastBodySchema = z.union([
  z.object({ podcastId: z.string().min(1) }),
  z.object({
    topic: z.string().min(1).max(5000),
    title: z.string().max(200).optional(),
  }),
]);

/** Body for POST /api/admin/demo/[projectId]/avatar */
export const generateAvatarBodySchema = z.object({
  narrationText: z.string().min(1).max(5000),
  avatarId: z.string().min(1),
  avatarProvider: z.enum(['heygen', 'runway']).optional(),
});

// Re-export sub-schemas for use in updateDemoSceneSchema extension
export {
  sceneSfxConfigSchema,
  providerBannerConfigSchema,
  avatarConfigSchema,
  textOverlayConfigSchema,
  subtitleConfigSchema,
};
