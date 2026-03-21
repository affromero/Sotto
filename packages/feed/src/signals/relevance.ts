import type { RelevanceInput } from '../types.js';

/**
 * Compute relevance signal (0-1).
 * Blends embedding similarity with explicit interest tag matching.
 * Supports hierarchical tags: exact match = full weight, sibling (same parent) = 0.4 weight.
 */
export function computeRelevance(input: RelevanceInput): number {
  const { embeddingSimilarity, interestMatches, podcastTagIds, tagParentMap } = input;

  let relevance = embeddingSimilarity;

  if (interestMatches.length === 0 || podcastTagIds.length === 0) {
    return Math.max(0, Math.min(relevance, 1));
  }

  const podcastTagSet = new Set(podcastTagIds);
  let matchWeight = 0;
  let totalWeight = 0;

  for (const interest of interestMatches) {
    totalWeight += Math.abs(interest.weight);

    if (podcastTagSet.has(interest.tagId)) {
      // Exact match: full weight
      matchWeight += interest.weight;
    } else {
      // Sibling match: same parent → 0.4 weight
      const interestParent = tagParentMap.get(interest.tagId);
      if (interestParent) {
        const hasSibling = podcastTagIds.some((tagId) => {
          const podcastTagParent = tagParentMap.get(tagId);
          return podcastTagParent === interestParent;
        });
        if (hasSibling) {
          matchWeight += interest.weight * 0.4;
        }
      }
    }
  }

  if (totalWeight > 0) {
    const interestRelevance = matchWeight / totalWeight;
    // Blend: explicit interests (stronger prior) with embedding similarity
    relevance = Math.min(relevance * 0.5 + interestRelevance * 0.5, 1);
  }

  return Math.max(0, Math.min(relevance, 1));
}
