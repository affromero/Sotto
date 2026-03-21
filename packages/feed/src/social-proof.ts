/** Social proof context for out-of-network filtering. */
export interface SocialProofInput {
  isInNetwork: boolean;
  engagerIds: Set<string>;
  userFollowingIds: Set<string>;
}

export interface SocialProofConfig {
  enabled: boolean;
  minMutualEngagers: number;
}

export const DEFAULT_SOCIAL_PROOF_CONFIG: SocialProofConfig = {
  enabled: true,
  minMutualEngagers: 1,
};

/**
 * Check if a candidate passes the social proof gate.
 * In-network candidates always pass.
 * Out-of-network candidates must have at least `minMutualEngagers`
 * users from the viewer's following set who engaged with the content.
 */
export function applySocialProofGate(
  socialProof: SocialProofInput,
  config: SocialProofConfig = DEFAULT_SOCIAL_PROOF_CONFIG
): boolean {
  if (!config.enabled) return true;
  if (socialProof.isInNetwork) return true;

  let mutualCount = 0;
  for (const engagerId of socialProof.engagerIds) {
    if (socialProof.userFollowingIds.has(engagerId)) {
      mutualCount++;
      if (mutualCount >= config.minMutualEngagers) return true;
    }
  }

  return false;
}
