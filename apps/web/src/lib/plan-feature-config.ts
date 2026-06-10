import { prisma } from './prisma';

export interface PlanFeatureConfigData {
  freeVoiceCloningEnabled: boolean;
  proVoiceCloningEnabled: boolean;
  freeVoiceTracksEnabled: boolean;
  proVoiceTracksEnabled: boolean;
  freeMaxVoiceTracks: number;
  proMaxVoiceTracks: number;
  avatarUploadsEnabled: boolean;
  avatarGenerationEnabled: boolean;
}

/** @deprecated Use PlanFeatureConfigData instead */
export type PlanVoiceConfig = PlanFeatureConfigData;

/**
 * Get the current plan feature configuration.
 * Creates the singleton row with defaults if it doesn't exist.
 */
export async function getPlanFeatureConfig(): Promise<PlanFeatureConfigData> {
  const row = await prisma.planFeatureConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });

  return {
    freeVoiceCloningEnabled: row.freeVoiceCloningEnabled,
    proVoiceCloningEnabled: row.proVoiceCloningEnabled,
    freeVoiceTracksEnabled: row.freeVoiceTracksEnabled,
    proVoiceTracksEnabled: row.proVoiceTracksEnabled,
    freeMaxVoiceTracks: row.freeMaxVoiceTracks,
    proMaxVoiceTracks: row.proMaxVoiceTracks,
    avatarUploadsEnabled: row.avatarUploadsEnabled,
    avatarGenerationEnabled: row.avatarGenerationEnabled,
  };
}

/**
 * Update the plan feature configuration (admin only).
 */
export async function setPlanFeatureConfig(
  data: Partial<PlanFeatureConfigData>,
  adminId: string,
): Promise<void> {
  await prisma.planFeatureConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...data, updatedBy: adminId },
    update: { ...data, updatedBy: adminId },
  });
}
