import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { getAiProviderMeta, getProviderForModel, type AiProviderId } from './providers/ai-registry';
import { getProviderMeta, type TtsProviderId } from './providers/tts-registry';
import { getSttProviderMeta, type SttProviderId } from './providers/stt-registry';
import { prismaUnfiltered } from './prisma';
import { sidedoorStateStore } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

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

export const SYSTEM_AI_PROVIDER_IDS = ['claude-code', 'codex'] as const;
export type SystemAiProviderId = (typeof SYSTEM_AI_PROVIDER_IDS)[number];

const DISABLED_SYSTEM_AI_PROVIDER_PREFIX = '__disabled-system-ai-provider:';

const includedModelsSchema = z.array(z.string()).nullable().catch(null);
const autoModelConfigSchema = z
  .object({
    model: z.object({
      aiProvider: z.string(),
      aiModel: z.string(),
      ttsProvider: z.string(),
      ttsModel: z.string(),
      sttProvider: z.string(),
      sttModel: z.string(),
    }),
    platform: z.object({ aiProvider: z.string(), aiModel: z.string() }),
    includedModels: includedModelsSchema,
    includedTtsModels: includedModelsSchema,
    includedSttModels: includedModelsSchema,
  })
  .strict();

// Seed values for fresh installs — derived from registry, not hardcoded.
// Computed lazily (not at module load) so simply importing this module — now a
// transitive dependency of learning-ai/stt — never touches the registry; only
// creating the singleton does. Keeps tests that mock the registry from breaking
// on import.
function seeds() {
  return {
    aiProvider: 'anthropic' as const,
    aiModel:
      getAiProviderMeta('anthropic').models.find((m) => m.tier === 'balanced')?.id ??
      getAiProviderMeta('anthropic').defaultModel,
    ttsProvider: 'openai' as const,
    ttsModel: getProviderMeta('openai').defaultModel,
    sttProvider: 'openai' as const,
    sttModel: getSttProviderMeta('openai').defaultModel,
    platformAiProvider: 'anthropic' as const,
    platformAiModel: getAiProviderMeta('anthropic').defaultModel,
  };
}

export function defaultAutoModelConfig(): AutoModelConfigData {
  const seed = seeds();
  return {
    model: {
      aiProvider: seed.aiProvider,
      aiModel: seed.aiModel,
      ttsProvider: seed.ttsProvider,
      ttsModel: seed.ttsModel,
      sttProvider: seed.sttProvider,
      sttModel: seed.sttModel,
    },
    platform: {
      aiProvider: seed.platformAiProvider,
      aiModel: seed.platformAiModel,
    },
    includedModels: null,
    includedTtsModels: null,
    includedSttModels: null,
  };
}

type SharedDatabase = Pick<Prisma.TransactionClient, '$queryRawUnsafe'>;

/** Read the single shared model configuration source. */
export async function getAutoModelConfig(
  transaction?: SharedDatabase
): Promise<AutoModelConfigData> {
  const read = async (database: SharedDatabase) => {
    const state = await sidedoorStateStore(database).read();
    if (state.configuration.automaticModels === null)
      throw new Error(
        'Initialize Sotto with `npm run access -- initialize` before starting the application'
      );
    const config = autoModelConfigSchema.parse(
      state.configuration.automaticModels
    ) as AutoModelConfigData;
    assertModelProviderPairs({ model: config.model, platform: config.platform });
    return config;
  };
  return transaction ? read(transaction) : sottoTransaction(prismaUnfiltered, read);
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
export function assertModelProviderPairs(data: AutoModelConfigUpdate): void {
  const m = data.model;
  if (m?.aiProvider && m.aiModel && getProviderForModel(m.aiModel) !== m.aiProvider) {
    throw new Error(`AI model "${m.aiModel}" does not belong to provider "${m.aiProvider}".`);
  }
  if (
    m?.ttsProvider &&
    m.ttsModel &&
    !getProviderMeta(m.ttsProvider).models.some((x) => x.id === m.ttsModel)
  ) {
    throw new Error(`TTS model "${m.ttsModel}" is not a model of provider "${m.ttsProvider}".`);
  }
  if (
    m?.sttProvider &&
    m.sttModel &&
    !getSttProviderMeta(m.sttProvider).models.some((x) => x.id === m.sttModel)
  ) {
    throw new Error(`STT model "${m.sttModel}" is not a model of provider "${m.sttProvider}".`);
  }
  const p = data.platform;
  if (p?.aiProvider && p.aiModel && getProviderForModel(p.aiModel) !== p.aiProvider) {
    throw new Error(
      `Platform AI model "${p.aiModel}" does not belong to provider "${p.aiProvider}".`
    );
  }
}

/**
 * Update the auto model configuration (admin only).
 */
export async function setAutoModelConfig(
  data: AutoModelConfigUpdate,
  _adminId: string,
  transaction?: SharedDatabase
): Promise<void> {
  assertModelProviderPairs(data);
  const write = async (database: SharedDatabase) => {
    const store = sidedoorStateStore(database);
    await store.transact((state) => {
      if (state.configuration.automaticModels === null)
        throw new Error(
          'Initialize Sotto with `npm run access -- initialize` before changing configuration'
        );
      const current = autoModelConfigSchema.parse(state.configuration.automaticModels);
      const updated: AutoModelConfigData = {
        model: { ...current.model, ...data.model } as ModelConfig,
        platform: { ...current.platform, ...data.platform } as PlatformAiConfig,
        includedModels:
          data.includedModels === undefined ? current.includedModels : data.includedModels,
        includedTtsModels:
          data.includedTtsModels === undefined ? current.includedTtsModels : data.includedTtsModels,
        includedSttModels:
          data.includedSttModels === undefined ? current.includedSttModels : data.includedSttModels,
      };
      assertModelProviderPairs({ model: updated.model, platform: updated.platform });
      state.configuration.automaticModels = autoModelConfigSchema.parse(updated);
      state.revision++;
    });
  };
  if (transaction) return write(transaction);
  await sottoTransaction(prismaUnfiltered, write);
}

/**
 * Resolve effective included AI models.
 * When the list is null (unconfigured), derive from the auto default.
 */
export function resolveIncludedModels(config: AutoModelConfigData): string[] {
  return config.includedModels ?? [config.model.aiModel];
}

export function disabledSystemAiProviderKey(providerId: SystemAiProviderId): string {
  return `${DISABLED_SYSTEM_AI_PROVIDER_PREFIX}${providerId}`;
}

export function resolveDisabledSystemAiProviders(
  config: AutoModelConfigData
): Set<SystemAiProviderId> {
  const disabled = new Set<SystemAiProviderId>();
  for (const entry of config.includedModels ?? []) {
    if (!entry.startsWith(DISABLED_SYSTEM_AI_PROVIDER_PREFIX)) continue;
    const providerId = entry.slice(DISABLED_SYSTEM_AI_PROVIDER_PREFIX.length);
    if (SYSTEM_AI_PROVIDER_IDS.includes(providerId as SystemAiProviderId)) {
      disabled.add(providerId as SystemAiProviderId);
    }
  }
  return disabled;
}

export async function setSystemAiProviderEnabled(
  providerId: SystemAiProviderId,
  enabled: boolean,
  adminId: string
): Promise<void> {
  const config = await getAutoModelConfig();
  if (!enabled && config.model.aiProvider === providerId) {
    throw new Error(`Change the default AI provider before disabling ${providerId}.`);
  }
  if (!enabled && config.platform.aiProvider === providerId) {
    throw new Error(`Change the platform AI provider before disabling ${providerId}.`);
  }

  const included = new Set(config.includedModels ?? resolveIncludedModels(config));
  const disabledKey = disabledSystemAiProviderKey(providerId);
  if (enabled) {
    included.delete(disabledKey);
  } else {
    included.add(disabledKey);
  }

  await setAutoModelConfig({ includedModels: [...included] }, adminId);
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
