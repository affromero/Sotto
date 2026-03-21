export interface QualityGateConfig {
  enabled: boolean;
  minReputation: number;
}

export const DEFAULT_QUALITY_GATE_CONFIG: QualityGateConfig = {
  enabled: true,
  minReputation: 10,
};

/**
 * Hard distribution gate based on creator reputation.
 * Candidates from creators below the threshold are excluded from the feed.
 * Returns true if the candidate passes (should be included).
 */
export function applyQualityGate(
  reputation: number | undefined,
  config: QualityGateConfig = DEFAULT_QUALITY_GATE_CONFIG
): boolean {
  if (!config.enabled) return true;
  if (reputation === undefined) return true;
  return reputation >= config.minReputation;
}
