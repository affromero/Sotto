import { prisma } from './prisma';
import type { AiProviderId } from './providers/ai-registry';
import type { TtsProviderId } from './providers/tts-registry';
import type { SttProviderId } from '@sotto/shared';

export interface FreeTierConfig {
  aiProvider: AiProviderId;
  aiModel: string;
  ttsProvider: TtsProviderId;
  ttsModel: string;
  sttProvider: SttProviderId;
  sttModel: string;
  generationLimit: number;
}

const DEFAULTS: FreeTierConfig = {
  aiProvider: 'anthropic',
  aiModel: 'claude-haiku-4-5-20251001',
  ttsProvider: 'openai',
  ttsModel: 'tts-1-hd',
  sttProvider: 'groq',
  sttModel: 'whisper-large-v3-turbo',
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
      ttsModel: DEFAULTS.ttsModel,
      sttProvider: DEFAULTS.sttProvider,
      sttModel: DEFAULTS.sttModel,
      generationLimit: DEFAULTS.generationLimit,
    },
  });

  return {
    aiProvider: row.aiProvider as AiProviderId,
    aiModel: row.aiModel,
    ttsProvider: row.ttsProvider as TtsProviderId,
    ttsModel: row.ttsModel,
    sttProvider: row.sttProvider as SttProviderId,
    sttModel: row.sttModel,
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
      ...(data.ttsModel !== undefined && { ttsModel: data.ttsModel }),
      ...(data.sttProvider !== undefined && { sttProvider: data.sttProvider }),
      ...(data.sttModel !== undefined && { sttModel: data.sttModel }),
      ...(data.generationLimit !== undefined && { generationLimit: data.generationLimit }),
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
      generationLimit: data.generationLimit ?? DEFAULTS.generationLimit,
      updatedBy: adminId,
    },
  });
}
