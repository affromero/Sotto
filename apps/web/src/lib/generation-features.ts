/**
 * Feature access. The self-hosted / BYOK product has no plans, tiers, or
 * quotas — every learner gets full access.
 */

export interface GenerationFeatures {
  maxDurationMinutes: number;
  maxSpeakers: number;
  autoApproveScript: boolean;
  webSearchEnabled: boolean;
  maxQaInteractions: number;
  privateAllowed: boolean;
  priorityQueue: boolean;
  analyticsEnabled: boolean;
}

const FULL_ACCESS: GenerationFeatures = {
  maxDurationMinutes: Infinity,
  maxSpeakers: 4,
  autoApproveScript: false,
  webSearchEnabled: true,
  maxQaInteractions: Infinity,
  privateAllowed: true,
  priorityQueue: false,
  analyticsEnabled: true,
};

/** Every learner gets full access — no plan/tier/quota gating. */
export function getGenerationFeatures(): GenerationFeatures {
  return FULL_ACCESS;
}

/** Single shared queue priority — no tiers. */
export function getJobPriority(): number {
  return 1;
}
