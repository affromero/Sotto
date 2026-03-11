import { prisma } from './prisma';

export interface PlanVoiceConfig {
  freeVoiceCloningEnabled: boolean;
  proVoiceCloningEnabled: boolean;
  freeVoiceTracksEnabled: boolean;
  proVoiceTracksEnabled: boolean;
  freeMaxVoiceTracks: number;
  proMaxVoiceTracks: number;
  voiceMarketplaceEnabled: boolean;
}

/**
 * Get the current plan feature configuration.
 * Creates the singleton row with defaults if it doesn't exist.
 */
export async function getPlanFeatureConfig(): Promise<PlanVoiceConfig> {
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
    voiceMarketplaceEnabled: row.voiceMarketplaceEnabled,
  };
}

/**
 * Update the plan feature configuration (admin only).
 */
export async function setPlanFeatureConfig(
  data: Partial<PlanVoiceConfig>,
  adminId: string,
): Promise<void> {
  await prisma.planFeatureConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...data, updatedBy: adminId },
    update: { ...data, updatedBy: adminId },
  });
}
