import { prisma } from './prisma';
import type { AiProviderId } from './providers/ai-registry';
import type { TtsProviderId } from './providers/tts-registry';

export interface FreeTierConfig {
  aiProvider: AiProviderId;
  aiModel: string;
  ttsProvider: TtsProviderId;
  generationLimit: number;
}

const DEFAULTS: FreeTierConfig = {
  aiProvider: 'anthropic',
  aiModel: 'claude-haiku-4-5-20251001',
  ttsProvider: 'openai',
  generationLimit: 3,
};

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
      generationLimit: DEFAULTS.generationLimit,
    },
  });

  return {
    aiProvider: row.aiProvider as AiProviderId,
    aiModel: row.aiModel,
    ttsProvider: row.ttsProvider as TtsProviderId,
    generationLimit: row.generationLimit,
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
      ...(data.generationLimit !== undefined && { generationLimit: data.generationLimit }),
      updatedBy: adminId,
    },
    create: {
      id: 'singleton',
      aiProvider: data.aiProvider ?? DEFAULTS.aiProvider,
      aiModel: data.aiModel ?? DEFAULTS.aiModel,
      ttsProvider: data.ttsProvider ?? DEFAULTS.ttsProvider,
      generationLimit: data.generationLimit ?? DEFAULTS.generationLimit,
      updatedBy: adminId,
    },
  });
}
