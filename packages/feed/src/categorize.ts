import type {
  ScoredCandidate,
  DiversityCandidate,
  CategorizationContext,
  PickCategory,
  CategoryLabel,
} from './types.js';

interface CategorizeConfig {
  continueLearningSlots: number;
  freshPerspectiveSlots: number;
  fromYourPeopleSlots: number;
}

/**
 * Categorize scored picks into labeled slots:
 * - "Continue Learning": matches user interests (exact or sibling tag)
 * - "Fresh Perspective": novelty > relevance
 * - "From Your People": from followed creators
 */
export function categorizePicks(
  picks: ScoredCandidate[],
  candidates: DiversityCandidate[],
  context: CategorizationContext,
  config: CategorizeConfig
): PickCategory[] {
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  const categories: PickCategory[] = [
    { label: 'Continue Learning' as CategoryLabel, items: [] },
    { label: 'Fresh Perspective' as CategoryLabel, items: [] },
    { label: 'From Your People' as CategoryLabel, items: [] },
  ];

  for (const pick of picks) {
    const candidate = candidateMap.get(pick.id);
    if (!candidate) continue;

    // Check interest match (exact or sibling via same parent)
    const exactMatch = candidate.tags.find((t) => context.interestTagIds.has(t.id));
    let matchingInterestName = exactMatch ? context.interestTagNames.get(exactMatch.id) : null;

    if (!matchingInterestName) {
      const siblingTag = candidate.tags.find(
        (t) => t.parentId && context.interestParentIds.has(t.parentId)
      );
      if (siblingTag && siblingTag.parentId) {
        // Look up the user's interest tag name that shares this parent
        matchingInterestName =
          context.interestParentToName.get(siblingTag.parentId) ?? undefined;
      }
    }

    if (
      context.followedCreatorIds.has(candidate.creatorId) &&
      categories[2].items.length < config.fromYourPeopleSlots
    ) {
      categories[2].items.push(pick);
    } else if (
      matchingInterestName &&
      categories[0].items.length < config.continueLearningSlots
    ) {
      categories[0].items.push({
        ...pick,
        explanation: `Because you're interested in ${matchingInterestName}`,
      });
    } else if (
      pick.signals.novelty > pick.signals.relevance &&
      categories[1].items.length < config.freshPerspectiveSlots
    ) {
      categories[1].items.push(pick);
    } else if (categories[0].items.length < config.continueLearningSlots) {
      categories[0].items.push(pick);
    } else if (categories[1].items.length < config.freshPerspectiveSlots) {
      categories[1].items.push(pick);
    } else if (categories[2].items.length < config.fromYourPeopleSlots) {
      categories[2].items.push(pick);
    }
  }

  return categories;
}
