import type { RecommendationSignals, SignalWeights, ScoredCandidate } from './types.js';
import { computeWeightedScore } from './scoring.js';

/**
 * Light rank: cheap first pass using only relevance + freshness.
 * Used to prune candidates before expensive heavy ranking.
 */
export function lightRank(
  candidates: Array<{ id: string; relevance: number; freshness: number }>,
  budget: number
): Array<{ id: string; score: number }> {
  return candidates
    .map((c) => ({
      id: c.id,
      score: c.relevance * 0.6 + c.freshness * 0.4,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, budget);
}

/**
 * Heavy rank: full 5-signal scoring with archetype weights.
 */
export function heavyRank(
  candidates: Array<{ id: string; signals: RecommendationSignals }>,
  weights: SignalWeights
): ScoredCandidate[] {
  return candidates
    .map((c) => ({
      id: c.id,
      score: computeWeightedScore(c.signals, weights),
      signals: c.signals,
      explanation: '',
    }))
    .sort((a, b) => b.score - a.score);
}
