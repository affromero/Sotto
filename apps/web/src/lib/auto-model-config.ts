import { z } from 'zod';
import { prisma } from './prisma';
import type { AiProviderId } from './providers/ai-registry';
import type { TtsProviderId } from './providers/tts-registry';
import type { SttProviderId } from '@sotto/shared';

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
}

const includedModelsSchema = z.array(z.string()).nullable().catch(null);

/**
 * Get the current auto model configuration.
 * Creates the singleton row with defaults if it doesn't exist.
 */
export async function getAutoModelConfig(): Promise<AutoModelConfigData> {
  const row = await prisma.autoModelConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });

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
