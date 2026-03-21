export interface DedupConfig {
  enabled: boolean;
  seenPenalty: number;
}

export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
  enabled: true,
  seenPenalty: 0.5,
};

/**
 * Apply a score penalty for already-seen content.
 * Reduces the score by `seenPenalty` multiplier if the candidate is in the seen set.
 */
export function applyDedupPenalty(
  score: number,
  alreadySeen: boolean,
  config: DedupConfig = DEFAULT_DEDUP_CONFIG
): number {
  if (!config.enabled) return score;
  if (!alreadySeen) return score;
  return score * (1 - config.seenPenalty);
}
