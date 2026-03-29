import { prisma } from './prisma';

export interface BriefingConfigData {
  enabled: boolean;
  defaultAiModel: string | null;
  defaultTtsProvider: string | null;
  defaultTtsModel: string | null;
  maxArticlesPerBriefing: number;
  targetDurationMinutes: number;
  maxBriefingsPerBatch: number;
  pollIntervalMs: number;
}

const DEFAULTS: BriefingConfigData = {
  enabled: true,
  defaultAiModel: null,
  defaultTtsProvider: null,
  defaultTtsModel: null,
  maxArticlesPerBriefing: 5,
  targetDurationMinutes: 6,
  maxBriefingsPerBatch: 50,
  pollIntervalMs: 900000,
};

export async function getBriefingConfig(): Promise<BriefingConfigData> {
  const row = await prisma.briefingConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      enabled: DEFAULTS.enabled,
      defaultTtsProvider: DEFAULTS.defaultTtsProvider,
      maxArticlesPerBriefing: DEFAULTS.maxArticlesPerBriefing,
      targetDurationMinutes: DEFAULTS.targetDurationMinutes,
      maxBriefingsPerBatch: DEFAULTS.maxBriefingsPerBatch,
      pollIntervalMs: DEFAULTS.pollIntervalMs,
    },
  });

  return {
    enabled: row.enabled,
    defaultAiModel: row.defaultAiModel,
    defaultTtsProvider: row.defaultTtsProvider,
    defaultTtsModel: row.defaultTtsModel,
    maxArticlesPerBriefing: row.maxArticlesPerBriefing,
    targetDurationMinutes: row.targetDurationMinutes,
    maxBriefingsPerBatch: row.maxBriefingsPerBatch,
    pollIntervalMs: row.pollIntervalMs,
  };
}

export async function setBriefingConfig(
  data: Partial<BriefingConfigData>,
  adminId: string,
): Promise<void> {
  await prisma.briefingConfig.upsert({
    where: { id: 'singleton' },
    update: {
      ...(data.enabled !== undefined && { enabled: data.enabled }),
      ...(data.defaultAiModel !== undefined && { defaultAiModel: data.defaultAiModel }),
      ...(data.defaultTtsProvider !== undefined && { defaultTtsProvider: data.defaultTtsProvider }),
      ...(data.defaultTtsModel !== undefined && { defaultTtsModel: data.defaultTtsModel }),
      ...(data.maxArticlesPerBriefing !== undefined && { maxArticlesPerBriefing: data.maxArticlesPerBriefing }),
      ...(data.targetDurationMinutes !== undefined && { targetDurationMinutes: data.targetDurationMinutes }),
      ...(data.maxBriefingsPerBatch !== undefined && { maxBriefingsPerBatch: data.maxBriefingsPerBatch }),
      ...(data.pollIntervalMs !== undefined && { pollIntervalMs: data.pollIntervalMs }),
      updatedBy: adminId,
    },
    create: {
      id: 'singleton',
      enabled: data.enabled ?? DEFAULTS.enabled,
      defaultAiModel: data.defaultAiModel ?? DEFAULTS.defaultAiModel,
      defaultTtsProvider: data.defaultTtsProvider ?? DEFAULTS.defaultTtsProvider,
      defaultTtsModel: data.defaultTtsModel ?? DEFAULTS.defaultTtsModel,
      maxArticlesPerBriefing: data.maxArticlesPerBriefing ?? DEFAULTS.maxArticlesPerBriefing,
      targetDurationMinutes: data.targetDurationMinutes ?? DEFAULTS.targetDurationMinutes,
      maxBriefingsPerBatch: data.maxBriefingsPerBatch ?? DEFAULTS.maxBriefingsPerBatch,
      pollIntervalMs: data.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
      updatedBy: adminId,
    },
  });
}
