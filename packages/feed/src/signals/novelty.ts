import type { NoveltyInput } from '../types.js';

/**
 * Compute novelty / anti-echo-chamber signal (0-1).
 * If user has topic affinity, novelty = inverse of relevance.
 * Otherwise, moderate default of 0.5.
 */
export function computeNovelty(input: NoveltyInput): number {
  if (input.hasTopicAffinity) {
    return Math.max(0, 1 - input.relevanceScore);
  }
  return 0.5;
}
