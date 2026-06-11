/**
 * Feature access. The self-hosted / BYOK product has no plans, tiers, or
 * quotas — every learner gets full access.
 */

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
  voiceCloningEnabled: boolean;
}

const FULL_ACCESS: TierFeatures = {
  maxDurationMinutes: Infinity,
  maxSpeakers: 4,
  autoApproveScript: false,
  webSearchEnabled: true,
  maxQaInteractions: Infinity,
  privateAllowed: true,
  priorityQueue: false,
  analyticsEnabled: true,
  voiceTracksEnabled: true,
  maxVoiceTracks: Infinity,
  voiceCloningEnabled: true,
};

/** Every learner gets full access — no plan/tier/quota gating. */
export function getTierFeatures(): TierFeatures {
  return FULL_ACCESS;
}

/** Single shared queue priority — no tiers. */
export function getJobPriority(): number {
  return 1;
}
