import { z } from 'zod';
import { prisma } from './prisma';
import { getAiProviderMeta, getProviderForModel, type AiProviderId } from './providers/ai-registry';
import { getProviderMeta, type TtsProviderId } from './providers/tts-registry';
import { getSttProviderMeta } from './providers/stt-registry';
import type { SttProviderId } from '@sotto/shared';
import { logger } from './logger';

export interface PlanModelConfig {
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
  free: PlanModelConfig;
  pro: PlanModelConfig;
  platform: PlatformAiConfig;
  freeIncludedModels: string[] | null;
  proIncludedModels: string[] | null;
  freeIncludedTtsModels: string[] | null;
  proIncludedTtsModels: string[] | null;
  freeIncludedSttModels: string[] | null;
  proIncludedSttModels: string[] | null;
}

const includedModelsSchema = z.array(z.string()).nullable().catch(null);

// Seed values for fresh installs — derived from registry, not hardcoded
const SEEDS = {
  freeAiProvider: 'anthropic' as const,
  freeAiModel: getAiProviderMeta('anthropic').defaultModel,
  freeTtsProvider: 'kittentts' as const,
  freeTtsModel: getProviderMeta('kittentts').defaultModel,
  freeSttProvider: 'openai' as const,
  freeSttModel: getSttProviderMeta('openai').defaultModel,
  proAiProvider: 'anthropic' as const,
  proAiModel: getAiProviderMeta('anthropic').models.find(m => m.tier === 'balanced')?.id ?? getAiProviderMeta('anthropic').defaultModel,
  proTtsProvider: 'elevenlabs' as const,
  proTtsModel: getProviderMeta('elevenlabs').defaultModel,
  proSttProvider: 'openai' as const,
  proSttModel: getSttProviderMeta('openai').defaultModel,
  platformAiProvider: 'anthropic' as const,
  platformAiModel: getAiProviderMeta('anthropic').defaultModel,
};

/**
 * Get the current auto model configuration.
 * Creates the singleton row with registry-derived defaults if it doesn't exist.
 * Self-heals orphaned model/provider pairs in existing rows.
 */
export async function getAutoModelConfig(): Promise<AutoModelConfigData> {
  const row = await prisma.autoModelConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton', ...SEEDS },
  });

  // Detect and fix orphaned model/provider pairs in existing rows
  const repairs: Record<string, string> = {};
  for (const [providerField, modelField, label] of [
    ['freeAiProvider', 'freeAiModel', 'free'] as const,
    ['proAiProvider', 'proAiModel', 'pro'] as const,
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
  if (Object.keys(repairs).length > 0) {
    await prisma.autoModelConfig.update({
      where: { id: 'singleton' },
      data: repairs,
    });
    Object.assign(row, repairs);
  }

  return {
    free: {
      aiProvider: row.freeAiProvider as AiProviderId,
      aiModel: row.freeAiModel,
      ttsProvider: row.freeTtsProvider as TtsProviderId,
      ttsModel: row.freeTtsModel,
      sttProvider: row.freeSttProvider as SttProviderId,
      sttModel: row.freeSttModel,
    },
    pro: {
      aiProvider: row.proAiProvider as AiProviderId,
      aiModel: row.proAiModel,
      ttsProvider: row.proTtsProvider as TtsProviderId,
      ttsModel: row.proTtsModel,
      sttProvider: row.proSttProvider as SttProviderId,
      sttModel: row.proSttModel,
    },
    platform: {
      aiProvider: row.platformAiProvider as AiProviderId,
      aiModel: row.platformAiModel,
    },
    freeIncludedModels: includedModelsSchema.parse(row.freeIncludedModels),
    proIncludedModels: includedModelsSchema.parse(row.proIncludedModels),
    freeIncludedTtsModels: includedModelsSchema.parse(row.freeIncludedTtsModels),
    proIncludedTtsModels: includedModelsSchema.parse(row.proIncludedTtsModels),
    freeIncludedSttModels: includedModelsSchema.parse(row.freeIncludedSttModels),
    proIncludedSttModels: includedModelsSchema.parse(row.proIncludedSttModels),
  };
}

/**
 * Update the auto model configuration (admin only).
 */
export async function setAutoModelConfig(
  data: {
    free?: Partial<PlanModelConfig>;
    pro?: Partial<PlanModelConfig>;
    platform?: Partial<PlatformAiConfig>;
    freeIncludedModels?: string[] | null;
    proIncludedModels?: string[] | null;
    freeIncludedTtsModels?: string[] | null;
    proIncludedTtsModels?: string[] | null;
    freeIncludedSttModels?: string[] | null;
    proIncludedSttModels?: string[] | null;
  },
  adminId: string
): Promise<void> {
  const update: Record<string, string | string[] | null> = { updatedBy: adminId };

  if (data.free) {
    if (data.free.aiProvider) update.freeAiProvider = data.free.aiProvider;
    if (data.free.aiModel) update.freeAiModel = data.free.aiModel;
    if (data.free.ttsProvider) update.freeTtsProvider = data.free.ttsProvider;
    if (data.free.ttsModel) update.freeTtsModel = data.free.ttsModel;
    if (data.free.sttProvider) update.freeSttProvider = data.free.sttProvider;
    if (data.free.sttModel) update.freeSttModel = data.free.sttModel;
  }

  if (data.pro) {
    if (data.pro.aiProvider) update.proAiProvider = data.pro.aiProvider;
    if (data.pro.aiModel) update.proAiModel = data.pro.aiModel;
    if (data.pro.ttsProvider) update.proTtsProvider = data.pro.ttsProvider;
    if (data.pro.ttsModel) update.proTtsModel = data.pro.ttsModel;
    if (data.pro.sttProvider) update.proSttProvider = data.pro.sttProvider;
    if (data.pro.sttModel) update.proSttModel = data.pro.sttModel;
  }

  if (data.platform) {
    if (data.platform.aiProvider) update.platformAiProvider = data.platform.aiProvider;
    if (data.platform.aiModel) update.platformAiModel = data.platform.aiModel;
  }

  if (data.freeIncludedModels !== undefined) {
    update.freeIncludedModels = data.freeIncludedModels;
  }

  if (data.proIncludedModels !== undefined) {
    update.proIncludedModels = data.proIncludedModels;
  }

  if (data.freeIncludedTtsModels !== undefined) {
    update.freeIncludedTtsModels = data.freeIncludedTtsModels;
  }

  if (data.proIncludedTtsModels !== undefined) {
    update.proIncludedTtsModels = data.proIncludedTtsModels;
  }

  if (data.freeIncludedSttModels !== undefined) {
    update.freeIncludedSttModels = data.freeIncludedSttModels;
  }

  if (data.proIncludedSttModels !== undefined) {
    update.proIncludedSttModels = data.proIncludedSttModels;
  }

  await prisma.autoModelConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...update },
    update,
  });
}

/**
 * Resolve effective included models per tier.
 * When lists are null (unconfigured), derive from auto defaults.
 */
export function resolveIncludedModels(config: AutoModelConfigData): {
  freeModels: string[];
  proModels: string[];
} {
  const freeModels = config.freeIncludedModels ?? [config.free.aiModel];
  const proSet = new Set([
    ...(config.proIncludedModels ?? [config.pro.aiModel]),
    ...freeModels,
  ]);
  return { freeModels, proModels: [...proSet] };
}

/**
 * Resolve effective included TTS models per tier.
 * IDs use provider:model format (e.g. "elevenlabs:eleven_v3").
 * When lists are null (unconfigured), derive from auto defaults.
 */
export function resolveTtsIncludedModels(config: AutoModelConfigData): {
  freeTtsModels: string[];
  proTtsModels: string[];
} {
  const freeTtsModels = config.freeIncludedTtsModels ?? [`${config.free.ttsProvider}:${config.free.ttsModel}`];
  const proSet = new Set([
    ...(config.proIncludedTtsModels ?? [`${config.pro.ttsProvider}:${config.pro.ttsModel}`]),
    ...freeTtsModels,
  ]);
  return { freeTtsModels, proTtsModels: [...proSet] };
}

/**
 * Resolve effective included STT models per tier.
 * IDs use provider:model format (e.g. "openai:whisper-1").
 * When lists are null (unconfigured), derive from auto defaults.
 */
export function resolveSttIncludedModels(config: AutoModelConfigData): {
  freeSttModels: string[];
  proSttModels: string[];
} {
  const freeSttModels = config.freeIncludedSttModels ?? [`${config.free.sttProvider}:${config.free.sttModel}`];
  const proSet = new Set([
    ...(config.proIncludedSttModels ?? [`${config.pro.sttProvider}:${config.pro.sttModel}`]),
    ...freeSttModels,
  ]);
  return { freeSttModels, proSttModels: [...proSet] };
}

/**
 * Resolve the auto model config for a specific plan tier.
 * 'PLATFORM' is a dedicated AI-only config for internal operations
 * (handle screening, credential lookup).
 */
export async function resolveAutoModel(plan: 'FREE' | 'PRO' | 'PLATFORM'): Promise<PlanModelConfig> {
  const config = await getAutoModelConfig();
  if (plan === 'PLATFORM') {
    return {
      ...config.free,
      aiProvider: config.platform.aiProvider,
      aiModel: config.platform.aiModel,
    };
  }
  return plan === 'PRO' ? config.pro : config.free;
}
