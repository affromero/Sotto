import { z } from 'zod';
import type { SttProviderId } from '@sotto/shared';
import { prisma } from './prisma';
import { getAiProviderMeta, getProviderForModel, type AiProviderId } from './providers/ai-registry';
import { getProviderMeta, type TtsProviderId } from './providers/tts-registry';
import { getSttProviderMeta } from './providers/stt-registry';
import { getAvatarProviderMeta, getAvatarModelProvider, type AvatarProviderId } from './providers/avatar-registry';
import { logger } from './logger';

export interface ModelConfig {
  aiProvider: AiProviderId;
  aiModel: string;
  ttsProvider: TtsProviderId;
  ttsModel: string;
  sttProvider: SttProviderId;
  sttModel: string;
}

export interface PlatformAiConfig {
  aiProvider: AiProviderId;
  aiModel: string;
}

export interface AutoModelConfigData {
  model: ModelConfig;
  platform: PlatformAiConfig;
  includedModels: string[] | null;
  includedTtsModels: string[] | null;
  includedSttModels: string[] | null;
  imageProvider: string;
  imageModel: string;
  includedImageModels: string[] | null;
  videoProvider: string;
  videoModel: string;
  includedVideoModels: string[] | null;
  avatarProvider: string;
  avatarModel: string;
  includedAvatarModels: string[] | null;
  musicProvider: string;
  musicModel: string;
  includedMusicModels: string[] | null;
  motionProvider: string;
}

export interface AutoModelConfigUpdate {
  model?: Partial<ModelConfig>;
  platform?: Partial<PlatformAiConfig>;
  includedModels?: string[] | null;
  includedTtsModels?: string[] | null;
  includedSttModels?: string[] | null;
  imageProvider?: string;
  imageModel?: string;
  includedImageModels?: string[] | null;
  videoProvider?: string;
  videoModel?: string;
  includedVideoModels?: string[] | null;
  avatarProvider?: string;
  avatarModel?: string;
  includedAvatarModels?: string[] | null;
  musicProvider?: string;
  musicModel?: string;
  includedMusicModels?: string[] | null;
  motionProvider?: string;
}

const includedModelsSchema = z.array(z.string()).nullable().catch(null);

// Seed values for fresh installs — derived from registry, not hardcoded.
const SEEDS = {
  aiProvider: 'anthropic' as const,
  aiModel: getAiProviderMeta('anthropic').models.find(m => m.tier === 'balanced')?.id ?? getAiProviderMeta('anthropic').defaultModel,
  ttsProvider: 'openai' as const,
  ttsModel: getProviderMeta('openai').defaultModel,
  sttProvider: 'openai' as const,
  sttModel: getSttProviderMeta('openai').defaultModel,
  platformAiProvider: 'anthropic' as const,
  platformAiModel: getAiProviderMeta('anthropic').defaultModel,
  imageProvider: 'fal',
  imageModel: 'fal-flux-1-schnell',
  videoProvider: 'fal',
  videoModel: 'fal-wan2.5-480p',
  avatarProvider: 'heygen',
  avatarModel: getAvatarProviderMeta('heygen').defaultModel,
  musicProvider: 'suno',
  musicModel: 'suno-v5',
  motionProvider: 'remotion',
};

/**
 * Get the current auto model configuration.
 * Creates the singleton row with registry-derived defaults if it doesn't exist.
 * Self-heals orphaned model/provider pairs in existing rows.
 */
export async function getAutoModelConfig(): Promise<AutoModelConfigData> {
  let row = await prisma.autoModelConfig.findUnique({
    where: { id: 'singleton' },
  });
  if (!row) {
    try {
      row = await prisma.autoModelConfig.create({
        data: { id: 'singleton', ...SEEDS },
      });
    } catch {
      row = await prisma.autoModelConfig.findUnique({ where: { id: 'singleton' } });
      if (!row) throw new Error('AutoModelConfig singleton missing after create race');
    }
  }

  const repairs: Record<string, string> = {};
  for (const [providerField, modelField, label] of [
    ['aiProvider', 'aiModel', 'default'] as const,
    ['platformAiProvider', 'platformAiModel', 'platform'] as const,
  ]) {
    const provider = row[providerField];
    const model = row[modelField];
    const owner = getProviderForModel(model);
    if (owner && owner !== provider) {
      const corrected = getAiProviderMeta(provider as AiProviderId).defaultModel;
      repairs[modelField] = corrected;
      logger.warn(`AutoModelConfig: repaired orphaned ${label} model`, {
        was: `${provider}/${model}`,
        corrected: `${provider}/${corrected}`,
      });
    } else if (!owner) {
      const corrected = getAiProviderMeta(provider as AiProviderId).defaultModel;
      repairs[modelField] = corrected;
      logger.warn(`AutoModelConfig: repaired unknown ${label} model`, {
        was: `${provider}/${model}`,
        corrected: `${provider}/${corrected}`,
      });
    }
  }

  const avatarModelMigrations: Record<string, string> = {
    'avatar-iii': 'heygen-avatar-standard',
    'avatar-iv': 'heygen-avatar-iv',
    'runway-avatar-realtime': 'runway-characters',
  };
  const migratedAvatarModel = avatarModelMigrations[row.avatarModel];
  if (migratedAvatarModel) {
    repairs.avatarModel = migratedAvatarModel;
    logger.warn('AutoModelConfig: migrated legacy avatar model', {
      was: row.avatarModel,
      corrected: migratedAvatarModel,
    });
  } else if (!getAvatarModelProvider(row.avatarModel)) {
    const corrected = getAvatarProviderMeta(row.avatarProvider as AvatarProviderId).defaultModel;
    repairs.avatarModel = corrected;
    logger.warn('AutoModelConfig: repaired unknown avatar model', {
      was: `${row.avatarProvider}/${row.avatarModel}`,
      corrected: `${row.avatarProvider}/${corrected}`,
    });
  }

  if (Object.keys(repairs).length > 0) {
    await prisma.autoModelConfig.update({
      where: { id: 'singleton' },
      data: repairs,
    });
    Object.assign(row, repairs);
  }

  return {
    model: {
      aiProvider: row.aiProvider as AiProviderId,
      aiModel: row.aiModel,
      ttsProvider: row.ttsProvider as TtsProviderId,
      ttsModel: row.ttsModel,
      sttProvider: row.sttProvider as SttProviderId,
      sttModel: row.sttModel,
    },
    platform: {
      aiProvider: row.platformAiProvider as AiProviderId,
      aiModel: row.platformAiModel,
    },
    includedModels: includedModelsSchema.parse(row.includedModels),
    includedTtsModels: includedModelsSchema.parse(row.includedTtsModels),
    includedSttModels: includedModelsSchema.parse(row.includedSttModels),
    imageProvider: row.imageProvider,
    imageModel: row.imageModel,
    includedImageModels: includedModelsSchema.parse(row.includedImageModels),
    videoProvider: row.videoProvider,
    videoModel: row.videoModel,
    includedVideoModels: includedModelsSchema.parse(row.includedVideoModels),
    avatarProvider: row.avatarProvider,
    avatarModel: row.avatarModel,
    includedAvatarModels: includedModelsSchema.parse(row.includedAvatarModels),
    musicProvider: row.musicProvider,
    musicModel: row.musicModel,
    includedMusicModels: includedModelsSchema.parse(row.includedMusicModels),
    motionProvider: row.motionProvider,
  };
}

/**
 * Update the auto model configuration (admin only).
 */
export async function setAutoModelConfig(data: AutoModelConfigUpdate, adminId: string): Promise<void> {
  const update: Record<string, string | string[] | null> = { updatedBy: adminId };

  if (data.model) {
    if (data.model.aiProvider) update.aiProvider = data.model.aiProvider;
    if (data.model.aiModel) update.aiModel = data.model.aiModel;
    if (data.model.ttsProvider) update.ttsProvider = data.model.ttsProvider;
    if (data.model.ttsModel) update.ttsModel = data.model.ttsModel;
    if (data.model.sttProvider) update.sttProvider = data.model.sttProvider;
    if (data.model.sttModel) update.sttModel = data.model.sttModel;
  }

  if (data.platform) {
    if (data.platform.aiProvider) update.platformAiProvider = data.platform.aiProvider;
    if (data.platform.aiModel) update.platformAiModel = data.platform.aiModel;
  }

  if (data.includedModels !== undefined) update.includedModels = data.includedModels;
  if (data.includedTtsModels !== undefined) update.includedTtsModels = data.includedTtsModels;
  if (data.includedSttModels !== undefined) update.includedSttModels = data.includedSttModels;
  if (data.imageProvider) update.imageProvider = data.imageProvider;
  if (data.imageModel) update.imageModel = data.imageModel;
  if (data.includedImageModels !== undefined) update.includedImageModels = data.includedImageModels;
  if (data.videoProvider) update.videoProvider = data.videoProvider;
  if (data.videoModel) update.videoModel = data.videoModel;
  if (data.includedVideoModels !== undefined) update.includedVideoModels = data.includedVideoModels;
  if (data.avatarProvider) update.avatarProvider = data.avatarProvider;
  if (data.avatarModel) update.avatarModel = data.avatarModel;
  if (data.includedAvatarModels !== undefined) update.includedAvatarModels = data.includedAvatarModels;
  if (data.musicProvider) update.musicProvider = data.musicProvider;
  if (data.musicModel) update.musicModel = data.musicModel;
  if (data.includedMusicModels !== undefined) update.includedMusicModels = data.includedMusicModels;
  if (data.motionProvider) update.motionProvider = data.motionProvider;

  await prisma.autoModelConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...update },
    update,
  });
}

/**
 * Resolve effective included AI models.
 * When the list is null (unconfigured), derive from the auto default.
 */
export function resolveIncludedModels(config: AutoModelConfigData): string[] {
  return config.includedModels ?? [config.model.aiModel];
}

/**
 * Resolve effective included TTS models.
 * IDs use provider:model format (e.g. "elevenlabs:eleven_v3").
 */
export function resolveTtsIncludedModels(config: AutoModelConfigData): string[] {
  return config.includedTtsModels ?? [`${config.model.ttsProvider}:${config.model.ttsModel}`];
}

/**
 * Resolve effective included STT models.
 * IDs use provider:model format (e.g. "openai:whisper-1").
 */
export function resolveSttIncludedModels(config: AutoModelConfigData): string[] {
  return config.includedSttModels ?? [`${config.model.sttProvider}:${config.model.sttModel}`];
}

/**
 * Resolve effective included image models.
 */
export function resolveIncludedImageModels(config: AutoModelConfigData): string[] {
  return config.includedImageModels ?? [config.imageModel];
}

/**
 * Resolve effective included video models.
 */
export function resolveIncludedVideoModels(config: AutoModelConfigData): string[] {
  return config.includedVideoModels ?? [config.videoModel];
}

/**
 * Resolve the image provider and model for video generation.
 */
export async function resolveImageModel(): Promise<{
  imageProvider: string;
  imageModel: string;
}> {
  const config = await getAutoModelConfig();
  return { imageProvider: config.imageProvider, imageModel: config.imageModel };
}

/**
 * Resolve the video provider and model for text-to-video generation.
 */
export async function resolveVideoModel(): Promise<{
  videoProvider: string;
  videoModel: string;
}> {
  const config = await getAutoModelConfig();
  return { videoProvider: config.videoProvider, videoModel: config.videoModel };
}

/**
 * Resolve the avatar provider and model for lip-sync overlays.
 */
export async function resolveAvatarModel(): Promise<{
  avatarProvider: string;
  avatarModel: string;
}> {
  const config = await getAutoModelConfig();
  return { avatarProvider: config.avatarProvider, avatarModel: config.avatarModel };
}

/**
 * Resolve the music provider and model for background music generation.
 */
export async function resolveMusicModel(): Promise<{
  musicProvider: string;
  musicModel: string;
}> {
  const config = await getAutoModelConfig();
  return { musicProvider: config.musicProvider, musicModel: config.musicModel };
}

/**
 * Resolve the motion provider for programmatic visual rendering.
 * Returns 'hera' only when explicitly configured; defaults to 'remotion'.
 */
export async function resolveMotionProvider(): Promise<'remotion' | 'hera'> {
  const config = await getAutoModelConfig();
  return config.motionProvider === 'hera' ? 'hera' : 'remotion';
}
