/**
 * Feature caps and toggles per user tier.
 *
 * Usage:
 *   const features = getTierFeatures(user.plan, isByokUser, user.role);
 *   if (!features.privateAllowed) return 403;
 */

const PRIVILEGED_ROLES = new Set(['ADMIN', 'SYSTEM']);

export interface TierFeatures {
  maxDurationMinutes: number;
  maxSpeakers: number;
  autoApproveScript: boolean;
  webSearchEnabled: boolean;
  maxQaInteractions: number;
  privateAllowed: boolean;
  priorityQueue: boolean;
  analyticsEnabled: boolean;
  voiceTracksEnabled: boolean;
  maxVoiceTracks: number;
}

const FREE_FEATURES: TierFeatures = {
  maxDurationMinutes: 5,
  maxSpeakers: 2,
  autoApproveScript: true,
  webSearchEnabled: false,
  maxQaInteractions: 3,
  privateAllowed: false,
  priorityQueue: false,
  analyticsEnabled: false,
  voiceTracksEnabled: false,
  maxVoiceTracks: 0,
};

const PRO_FEATURES: TierFeatures = {
  maxDurationMinutes: 30,
  maxSpeakers: 4,
  autoApproveScript: false,
  webSearchEnabled: true,
  maxQaInteractions: Infinity,
  privateAllowed: true,
  priorityQueue: true,
  analyticsEnabled: true,
  voiceTracksEnabled: true,
  maxVoiceTracks: 3,
};

const BYOK_FEATURES: TierFeatures = {
  ...PRO_FEATURES,
  maxDurationMinutes: Infinity,
};

/**
 * Get feature caps for a user given their plan, BYOK status, and role.
 * BYOK users and privileged roles (ADMIN, SYSTEM) always get maximum caps.
 */
export function getTierFeatures(plan: 'FREE' | 'PRO', isByok: boolean, role?: string): TierFeatures {
  if (isByok || PRIVILEGED_ROLES.has(role ?? '')) return BYOK_FEATURES;
  if (plan === 'PRO') return PRO_FEATURES;
  return FREE_FEATURES;
}

/**
 * BullMQ job priority for a given tier.
 * Lower = higher priority.
 */
export function getJobPriority(plan: 'FREE' | 'PRO', isByok: boolean, role?: string): number {
  if (isByok || plan === 'PRO' || PRIVILEGED_ROLES.has(role ?? '')) return 1;
  return 10;
}
