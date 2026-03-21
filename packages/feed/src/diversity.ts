import type { ScoredCandidate, DiversityCandidate } from './types.js';

/**
 * Apply Maximal Marginal Relevance diversity to scored candidates.
 * Enforces creator cap and primary tag cap.
 */
export function applyDiversity(
  scored: ScoredCandidate[],
  candidates: DiversityCandidate[],
  config: { maxPerCreator: number; maxPerPrimaryTag: number; maxPicks: number }
): ScoredCandidate[] {
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));
  const selected: ScoredCandidate[] = [];
  const creatorCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  for (const pick of scored) {
    if (selected.length >= config.maxPicks) break;

    const candidate = candidateMap.get(pick.id);
    if (!candidate) continue;

    // Creator diversity
    const creatorCount = creatorCounts.get(candidate.creatorId) ?? 0;
    if (creatorCount >= config.maxPerCreator) continue;

    // Tag diversity
    const primaryTag = candidate.tags[0]?.id;
    if (primaryTag && (tagCounts.get(primaryTag) ?? 0) >= config.maxPerPrimaryTag) continue;

    selected.push(pick);
    creatorCounts.set(candidate.creatorId, creatorCount + 1);
    if (primaryTag) {
      tagCounts.set(primaryTag, (tagCounts.get(primaryTag) ?? 0) + 1);
    }
  }

  return selected;
}
