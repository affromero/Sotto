import type { RecommendationSignals, SignalName } from './types.js';

const EXPLANATIONS: Record<SignalName, string> = {
  relevance: 'Matches your listening history and interests',
  collaborative: 'Highly rated by listeners with similar taste',
  quality: 'Outstanding engagement and verified sources',
  freshness: 'Recently published and gaining traction',
  novelty: 'Something different — explore a new perspective',
};

/**
 * Generate a human-readable explanation based on the dominant signal.
 */
export function explain(signals: RecommendationSignals): string {
  const dominant = (Object.entries(signals) as Array<[SignalName, number]>).sort(
    ([, a], [, b]) => b - a
  )[0][0];

  return EXPLANATIONS[dominant] ?? 'Recommended for you';
}

/**
 * Generate a detailed explanation with all signal contributions.
 */
export function explainDetailed(
  signals: RecommendationSignals
): Array<{ signal: SignalName; value: number; label: string }> {
  return (Object.entries(signals) as Array<[SignalName, number]>)
    .sort(([, a], [, b]) => b - a)
    .map(([signal, value]) => ({
      signal,
      value,
      label: EXPLANATIONS[signal] ?? 'Recommended for you',
    }));
}
