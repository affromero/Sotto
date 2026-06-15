import { z } from 'zod';
import { prisma } from './prisma';
import { getAiProviderMeta, getProviderForModel, type AiProviderId } from './providers/ai-registry';
import { getProviderMeta, type TtsProviderId } from './providers/tts-registry';
import { getSttProviderMeta, type SttProviderId } from './providers/stt-registry';
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
}

export interface AutoModelConfigUpdate {
  model?: Partial<ModelConfig>;
  platform?: Partial<PlatformAiConfig>;
  includedModels?: string[] | null;
  includedTtsModels?: string[] | null;
  includedSttModels?: string[] | null;
}

const includedModelsSchema = z.array(z.string()).nullable().catch(null);

// Seed values for fresh installs — derived from registry, not hardcoded.
// Computed lazily (not at module load) so simply importing this module — now a
// transitive dependency of learning-ai/stt — never touches the registry; only
// creating the singleton does. Keeps tests that mock the registry from breaking
// on import.
function seeds() {
  return {
    aiProvider: 'anthropic' as const,
    aiModel: getAiProviderMeta('anthropic').models.find(m => m.tier === 'balanced')?.id ?? getAiProviderMeta('anthropic').defaultModel,
    ttsProvider: 'openai' as const,
    ttsModel: getProviderMeta('openai').defaultModel,
    sttProvider: 'openai' as const,
    sttModel: getSttProviderMeta('openai').defaultModel,
    platformAiProvider: 'anthropic' as const,
    platformAiModel: getAiProviderMeta('anthropic').defaultModel,
  };
}

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
        data: { id: 'singleton', ...seeds() },
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
  };
}

/**
 * Validate that every provided model belongs to its paired provider before
 * persisting. `setAutoModelConfig` is written by both the admin providers page
 * and the onboarding wizard; without this guard a mismatched AI pair would be
 * silently self-healed away on the next read, and a mismatched TTS/STT pair
 * would persist but never apply (the resolvers only use the model when the
 * provider matches). Only checks pairs where both provider and a non-empty
 * model are supplied — partial updates and keyless/STT-only providers are skipped.
 */
function assertModelProviderPairs(data: AutoModelConfigUpdate): void {
  const m = data.model;
  if (m?.aiProvider && m.aiModel && getProviderForModel(m.aiModel) !== m.aiProvider) {
    throw new Error(`AI model "${m.aiModel}" does not belong to provider "${m.aiProvider}".`);
  }
  if (m?.ttsProvider && m.ttsModel && !getProviderMeta(m.ttsProvider).models.some((x) => x.id === m.ttsModel)) {
    throw new Error(`TTS model "${m.ttsModel}" is not a model of provider "${m.ttsProvider}".`);
  }
  if (m?.sttProvider && m.sttModel && !getSttProviderMeta(m.sttProvider).models.some((x) => x.id === m.sttModel)) {
    throw new Error(`STT model "${m.sttModel}" is not a model of provider "${m.sttProvider}".`);
  }
  const p = data.platform;
  if (p?.aiProvider && p.aiModel && getProviderForModel(p.aiModel) !== p.aiProvider) {
    throw new Error(`Platform AI model "${p.aiModel}" does not belong to provider "${p.aiProvider}".`);
  }
}

/**
 * Update the auto model configuration (admin only).
 */
export async function setAutoModelConfig(data: AutoModelConfigUpdate, adminId: string): Promise<void> {
  assertModelProviderPairs(data);

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
