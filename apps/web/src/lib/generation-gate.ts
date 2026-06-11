/** Generation gating. Self-hosted / BYOK has no plans, tiers, or quotas. */

export type GateReason = 'ok';

export interface GenerationGateResult {
  allowed: boolean;
  reason: GateReason;
}

const UNLIMITED: GenerationGateResult = {
  allowed: true,
  reason: 'ok',
};

/** Generation is always allowed — no plan/tier/quota gating. */
export async function checkGenerationGate(_userId: string): Promise<GenerationGateResult> {
  return UNLIMITED;
}
