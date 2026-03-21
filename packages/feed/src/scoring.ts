import type { RecommendationSignals, SignalWeights } from './types.js';

/**
 * Compute weighted score from signals and per-archetype weights.
 */
export function computeWeightedScore(
  signals: RecommendationSignals,
  weights: SignalWeights
): number {
  return (
    signals.relevance * weights.relevance +
    signals.collaborative * weights.collaborative +
    signals.quality * weights.quality +
    signals.freshness * weights.freshness +
    signals.novelty * weights.novelty
  );
}
