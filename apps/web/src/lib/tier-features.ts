/**
 * Feature caps and toggles per user tier.
 *
 * 2x2 matrix: (FREE | PRO) x (no-BYOK | BYOK)
 *
 * BYOK adds:  unlimited generation, own model choice, unlimited duration.
 * Pro adds:   private/unlisted, priority queue, analytics, voice tracks,
 *             voice cloning, script review, 4 speakers, unlimited Q&A.
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
  downloadAllowed: boolean;
  priorityQueue: boolean;
  analyticsEnabled: boolean;
  voiceTracksEnabled: boolean;
  maxVoiceTracks: number;
  voiceCloningEnabled: boolean;
}

const FREE_FEATURES: TierFeatures = {
  maxDurationMinutes: 5,
  maxSpeakers: 2,
  autoApproveScript: true,
  webSearchEnabled: true,
  maxQaInteractions: 3,
  privateAllowed: false,
  downloadAllowed: false,
  priorityQueue: false,
  analyticsEnabled: false,
  voiceTracksEnabled: false,
  maxVoiceTracks: 0,
  voiceCloningEnabled: false,
};

const PRO_FEATURES: TierFeatures = {
  maxDurationMinutes: 30,
  maxSpeakers: 4,
  autoApproveScript: false,
  webSearchEnabled: true,
  maxQaInteractions: Infinity,
  privateAllowed: true,
  downloadAllowed: true,
  priorityQueue: true,
  analyticsEnabled: true,
  voiceTracksEnabled: true,
  maxVoiceTracks: 3,
  voiceCloningEnabled: true,
};

const FREE_BYOK_FEATURES: TierFeatures = {
  ...FREE_FEATURES,
  maxDurationMinutes: Infinity,
};

const PRO_BYOK_FEATURES: TierFeatures = {
  ...PRO_FEATURES,
  maxDurationMinutes: Infinity,
  maxVoiceTracks: Infinity,
};

/**
 * Get feature caps for a user given their plan, BYOK status, and role.
 * Privileged roles (ADMIN, SYSTEM) always get maximum caps.
 */
export function getTierFeatures(plan: 'FREE' | 'PRO', isByok: boolean, role?: string): TierFeatures {
  if (PRIVILEGED_ROLES.has(role ?? '')) return PRO_BYOK_FEATURES;
  if (plan === 'PRO') return isByok ? PRO_BYOK_FEATURES : PRO_FEATURES;
  return isByok ? FREE_BYOK_FEATURES : FREE_FEATURES;
}

/**
 * Check whether a user is allowed to use a given AI model on platform credits.
 * BYOK users and privileged roles (ADMIN, SYSTEM) bypass all restrictions.
 * Free non-BYOK users can only use models with requiredPlan === 'FREE'.
 */
export function isModelAllowedForUser(
  requiredPlan: 'FREE' | 'PRO',
  userPlan: 'FREE' | 'PRO',
  isByok: boolean,
  role?: string,
): boolean {
  if (PRIVILEGED_ROLES.has(role ?? '')) return true;
  if (isByok) return true;
  if (userPlan === 'PRO') return true;
  return requiredPlan === 'FREE';
}

/**
 * BullMQ job priority for a given tier.
 * Lower = higher priority. Only Pro and privileged roles get priority.
 */
export function getJobPriority(plan: 'FREE' | 'PRO', _isByok: boolean, role?: string): number {
  if (plan === 'PRO' || PRIVILEGED_ROLES.has(role ?? '')) return 1;
  return 10;
}
