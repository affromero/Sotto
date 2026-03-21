import type { Archetype, ArchetypeInput, SignalWeights } from './types.js';

/**
 * Classify a user into a behavioral archetype based on listening patterns.
 */
export function classifyArchetype(input: ArchetypeInput): Archetype {
  const { avgCompletionRate, avgSpeed, sessions } = input;

  const avgSeeks =
    sessions.length > 0
      ? sessions.reduce((sum, s) => sum + s.seekCount, 0) / sessions.length
      : 0;
  const avgInteractions =
    sessions.length > 0
      ? sessions.reduce((sum, s) => sum + s.interruptCount, 0) / sessions.length
      : 0;

  if (avgCompletionRate > 90 && avgSpeed <= 1.25) return 'deep_listener';
  if (avgCompletionRate < 50 && avgSpeed > 1.25 && avgSeeks > 2) return 'skimmer';
  if (avgCompletionRate > 90 && avgInteractions < 0.5) return 'completer';
  if (avgInteractions > 1) return 'social_learner';
  return 'explorer';
}

/**
 * Get signal weights for a given archetype.
 * Each archetype emphasizes different signals.
 */
export function getArchetypeWeights(archetype: Archetype | string): SignalWeights {
  switch (archetype) {
    case 'deep_listener':
      return { relevance: 0.35, quality: 0.3, collaborative: 0.2, novelty: 0.1, freshness: 0.05 };
    case 'skimmer':
      return { quality: 0.3, freshness: 0.25, relevance: 0.2, novelty: 0.15, collaborative: 0.1 };
    case 'explorer':
      return { novelty: 0.3, freshness: 0.25, quality: 0.2, collaborative: 0.15, relevance: 0.1 };
    case 'completer':
      return { relevance: 0.3, collaborative: 0.25, quality: 0.25, freshness: 0.15, novelty: 0.05 };
    case 'social_learner':
      return { collaborative: 0.35, quality: 0.25, relevance: 0.2, freshness: 0.1, novelty: 0.1 };
    default:
      return { relevance: 0.3, collaborative: 0.25, quality: 0.2, freshness: 0.15, novelty: 0.1 };
  }
}
