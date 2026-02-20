/**
 * Feature caps and toggles per user tier.
 *
 * Usage:
 *   const features = getTierFeatures(user.plan, isByokUser);
 *   if (!features.privateAllowed) return 403;
 */

export interface TierFeatures {
  maxDurationMinutes: number;
  autoApproveScript: boolean;
  webSearchEnabled: boolean;
  maxQaInteractions: number;
  privateAllowed: boolean;
  priorityQueue: boolean;
  analyticsEnabled: boolean;
}

const FREE_FEATURES: TierFeatures = {
  maxDurationMinutes: 5,
  autoApproveScript: true,
  webSearchEnabled: false,
  maxQaInteractions: 3,
  privateAllowed: false,
  priorityQueue: false,
  analyticsEnabled: false,
};

const PRO_FEATURES: TierFeatures = {
  maxDurationMinutes: 30,
  autoApproveScript: false,
  webSearchEnabled: true,
  maxQaInteractions: Infinity,
  privateAllowed: true,
  priorityQueue: true,
  analyticsEnabled: true,
};

const BYOK_FEATURES: TierFeatures = {
  ...PRO_FEATURES,
  maxDurationMinutes: Infinity,
};

/**
 * Get feature caps for a user given their plan and BYOK status.
 * BYOK users always get maximum caps regardless of subscription plan.
 */
export function getTierFeatures(plan: 'FREE' | 'PRO', isByok: boolean): TierFeatures {
  if (isByok) return BYOK_FEATURES;
  if (plan === 'PRO') return PRO_FEATURES;
  return FREE_FEATURES;
}

/**
 * BullMQ job priority for a given tier.
 * Lower = higher priority.
 */
export function getJobPriority(plan: 'FREE' | 'PRO', isByok: boolean): number {
  if (isByok || plan === 'PRO') return 1;
  return 10;
}
