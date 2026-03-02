import { prisma } from './prisma';
import { getAiProviderMeta, type AiProviderId } from './providers/ai-registry';
import { getProviderMeta, type TtsProviderId } from './providers/tts-registry';
import { getSttProviderMeta } from './providers/stt-registry';
import type { SttProviderId } from '@sotto/shared';

export interface ProviderAllocation {
  provider: string;
  model: string;
  quota: number;
}

export interface FreeTierConfig {
  aiProvider: AiProviderId;
  aiModel: string;
  ttsProvider: TtsProviderId;
  ttsModel: string;
  sttProvider: SttProviderId;
  sttModel: string;
  dailyGenerationLimit: number;
  aiAllocations: ProviderAllocation[];
  ttsAllocations: ProviderAllocation[];
}

const DEFAULTS: Omit<FreeTierConfig, 'aiAllocations' | 'ttsAllocations'> = {
  aiProvider: 'groq',
  aiModel: getAiProviderMeta('groq').defaultModel,
  ttsProvider: 'kittentts',
  ttsModel: getProviderMeta('kittentts').defaultModel,
  sttProvider: 'groq',
  sttModel: getSttProviderMeta('groq').defaultModel,
  dailyGenerationLimit: 1,
};

function parseAllocations(json: unknown): ProviderAllocation[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (item): item is ProviderAllocation =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.provider === 'string' &&
      typeof item.model === 'string' &&
      typeof item.quota === 'number'
  );
}

/**
 * Get the current free tier configuration.
 * Creates the singleton row with defaults if it doesn't exist.
 */
export async function getFreeTierConfig(): Promise<FreeTierConfig> {
  const row = await prisma.freeTierConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      aiProvider: DEFAULTS.aiProvider,
      aiModel: DEFAULTS.aiModel,
      ttsProvider: DEFAULTS.ttsProvider,
      ttsModel: DEFAULTS.ttsModel,
      sttProvider: DEFAULTS.sttProvider,
      sttModel: DEFAULTS.sttModel,
      dailyGenerationLimit: DEFAULTS.dailyGenerationLimit,
    },
  });

  return {
    aiProvider: row.aiProvider as AiProviderId,
    aiModel: row.aiModel,
    ttsProvider: row.ttsProvider as TtsProviderId,
    ttsModel: row.ttsModel,
    sttProvider: row.sttProvider as SttProviderId,
    sttModel: row.sttModel,
    dailyGenerationLimit: row.dailyGenerationLimit,
    aiAllocations: parseAllocations(row.aiAllocations),
    ttsAllocations: parseAllocations(row.ttsAllocations),
  };
}

/**
 * Update the free tier configuration (admin only).
 */
export async function setFreeTierConfig(
  data: Partial<FreeTierConfig>,
  adminId: string
): Promise<void> {
  await prisma.freeTierConfig.upsert({
    where: { id: 'singleton' },
    update: {
      ...(data.aiProvider !== undefined && { aiProvider: data.aiProvider }),
      ...(data.aiModel !== undefined && { aiModel: data.aiModel }),
      ...(data.ttsProvider !== undefined && { ttsProvider: data.ttsProvider }),
      ...(data.ttsModel !== undefined && { ttsModel: data.ttsModel }),
      ...(data.sttProvider !== undefined && { sttProvider: data.sttProvider }),
      ...(data.sttModel !== undefined && { sttModel: data.sttModel }),
      ...(data.dailyGenerationLimit !== undefined && {
        dailyGenerationLimit: data.dailyGenerationLimit,
      }),
      ...(data.aiAllocations !== undefined && { aiAllocations: data.aiAllocations }),
      ...(data.ttsAllocations !== undefined && { ttsAllocations: data.ttsAllocations }),
      updatedBy: adminId,
    },
    create: {
      id: 'singleton',
      aiProvider: data.aiProvider ?? DEFAULTS.aiProvider,
      aiModel: data.aiModel ?? DEFAULTS.aiModel,
      ttsProvider: data.ttsProvider ?? DEFAULTS.ttsProvider,
      ttsModel: data.ttsModel ?? DEFAULTS.ttsModel,
      sttProvider: data.sttProvider ?? DEFAULTS.sttProvider,
      sttModel: data.sttModel ?? DEFAULTS.sttModel,
      dailyGenerationLimit: data.dailyGenerationLimit ?? DEFAULTS.dailyGenerationLimit,
      aiAllocations: data.aiAllocations ?? [],
      ttsAllocations: data.ttsAllocations ?? [],
      updatedBy: adminId,
    },
  });
}
