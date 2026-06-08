export interface ScoredCandidate {
  id: string;
  score: number;
  signals: RecommendationSignals;
  explanation: string;
}

export interface RecommendationSignals {
  relevance: number;
  collaborative: number;
  quality: number;
  freshness: number;
  novelty: number;
}

export interface RelevanceInput {
  embeddingSimilarity: number;
  interestMatches: InterestMatch[];
  podcastTagIds: string[];
  tagParentMap: Map<string, string | null>;
}

export interface InterestMatch {
  tagId: string;
  weight: number;
}

export interface CollaborativeInput {
  completionRates: number[];
}

export interface QualityInput {
  avgCompletionRate: number;
  saveToListenRatio: number;
  verifiedReferenceRate: number;
  interactionRate: number;
}

export interface FreshnessInput {
  createdAt: Date | string;
  totalUniqueListeners: number;
  now?: Date;
}

export interface NoveltyInput {
  relevanceScore: number;
  hasTopicAffinity: boolean;
}

export interface DiversityCandidate {
  id: string;
  creatorId: string;
  tags: Array<{ id: string; parentId?: string | null }>;
}

export interface CategorizationContext {
  interestTagIds: Set<string>;
  interestTagNames: Map<string, string>;
  interestParentIds: Set<string>;
  interestParentToName: Map<string, string>;
}

export type Archetype = 'deep_listener' | 'skimmer' | 'explorer' | 'completer' | 'active_learner';
export type SignalName = keyof RecommendationSignals;
export type SignalWeights = Record<SignalName, number>;
export type CategoryLabel = 'Continue Learning' | 'Fresh Perspective' | 'High Signal';

export interface PickCategory {
  label: CategoryLabel;
  items: ScoredCandidate[];
}

export interface ArchetypeInput {
  avgCompletionRate: number;
  avgSpeed: number;
  sessions: Array<{ seekCount: number; interruptCount: number }>;
}

export interface PrivateRecommendationConfig {
  confidenceThreshold: number;
  maxPicks: number;
  maxPerCreator: number;
  maxPerPrimaryTag: number;
  continueLearningSlots: number;
  freshPerspectiveSlots: number;
  highSignalSlots: number;
}

export const PRIVATE_RECOMMENDATION_CONFIG: PrivateRecommendationConfig = {
  confidenceThreshold: 0.45,
  maxPicks: 7,
  maxPerCreator: 1,
  maxPerPrimaryTag: 2,
  continueLearningSlots: 3,
  freshPerspectiveSlots: 2,
  highSignalSlots: 2,
};

const EXPLANATIONS: Record<SignalName, string> = {
  relevance: 'Matches your listening history and interests',
  collaborative: 'Works well for similar listening patterns',
  quality: 'Strong completion, saves, and verified sources',
  freshness: 'Recently published and actively listened to',
  novelty: 'A different angle on your interests',
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(value, 1));
}

export function computeRelevance(input: RelevanceInput): number {
  const { embeddingSimilarity, interestMatches, podcastTagIds, tagParentMap } = input;

  let relevance = embeddingSimilarity;
  if (interestMatches.length === 0 || podcastTagIds.length === 0) {
    return clamp01(relevance);
  }

  const podcastTagSet = new Set(podcastTagIds);
  let matchWeight = 0;
  let totalWeight = 0;

  for (const interest of interestMatches) {
    totalWeight += Math.abs(interest.weight);

    if (podcastTagSet.has(interest.tagId)) {
      matchWeight += interest.weight;
      continue;
    }

    const interestParent = tagParentMap.get(interest.tagId);
    if (!interestParent) continue;

    const hasSibling = podcastTagIds.some((tagId) => tagParentMap.get(tagId) === interestParent);
    if (hasSibling) {
      matchWeight += interest.weight * 0.4;
    }
  }

  if (totalWeight > 0) {
    const interestRelevance = matchWeight / totalWeight;
    relevance = Math.min(relevance * 0.5 + interestRelevance * 0.5, 1);
  }

  return clamp01(relevance);
}

export function computeCollaborative(input: CollaborativeInput): number {
  if (input.completionRates.length === 0) return 0;

  const mean =
    input.completionRates.reduce((sum, rate) => sum + rate / 100, 0) / input.completionRates.length;

  return clamp01(mean);
}

export function computeQuality(input: QualityInput): number {
  const score =
    (input.avgCompletionRate / 100) * 0.45 +
    input.saveToListenRatio * 0.25 +
    input.verifiedReferenceRate * 0.2 +
    input.interactionRate * 0.1;

  return clamp01(score);
}

export function computeFreshness(input: FreshnessInput): number {
  const createdAtDate =
    typeof input.createdAt === 'string' ? new Date(input.createdAt) : input.createdAt;
  const now = input.now ?? new Date();
  const ageHours = (now.getTime() - createdAtDate.getTime()) / (1000 * 60 * 60);
  const timeFreshness = Math.max(0, 1 - ageHours / (30 * 24));
  const coldStartBonus = input.totalUniqueListeners < 10 ? 0.2 : 0;

  return Math.min(timeFreshness + coldStartBonus, 1);
}

export function computeNovelty(input: NoveltyInput): number {
  return input.hasTopicAffinity ? clamp01(1 - input.relevanceScore) : 0.5;
}

export function classifyArchetype(input: ArchetypeInput): Archetype {
  const avgSeeks =
    input.sessions.length > 0
      ? input.sessions.reduce((sum, session) => sum + session.seekCount, 0) / input.sessions.length
      : 0;
  const avgInteractions =
    input.sessions.length > 0
      ? input.sessions.reduce((sum, session) => sum + session.interruptCount, 0) /
        input.sessions.length
      : 0;

  if (input.avgCompletionRate > 90 && input.avgSpeed <= 1.25) return 'deep_listener';
  if (input.avgCompletionRate < 50 && input.avgSpeed > 1.25 && avgSeeks > 2) return 'skimmer';
  if (input.avgCompletionRate > 90 && avgInteractions < 0.5) return 'completer';
  if (avgInteractions > 1) return 'active_learner';
  return 'explorer';
}

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
    case 'active_learner':
      return { relevance: 0.25, quality: 0.25, collaborative: 0.2, novelty: 0.15, freshness: 0.15 };
    default:
      return { relevance: 0.3, collaborative: 0.25, quality: 0.2, freshness: 0.15, novelty: 0.1 };
  }
}

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

export function explain(signals: RecommendationSignals): string {
  const [dominant] = (Object.entries(signals) as Array<[SignalName, number]>).sort(
    ([, a], [, b]) => b - a
  )[0];

  return EXPLANATIONS[dominant];
}

export function applyDiversity(
  scored: ScoredCandidate[],
  candidates: DiversityCandidate[],
  config: { maxPerCreator: number; maxPerPrimaryTag: number; maxPicks: number }
): ScoredCandidate[] {
  const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const selected: ScoredCandidate[] = [];
  const creatorCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  for (const pick of scored) {
    if (selected.length >= config.maxPicks) break;

    const candidate = candidateMap.get(pick.id);
    if (!candidate) continue;

    const creatorCount = creatorCounts.get(candidate.creatorId) ?? 0;
    if (creatorCount >= config.maxPerCreator) continue;

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

function findInterestMatch(
  candidate: DiversityCandidate,
  context: CategorizationContext
): string | undefined {
  const exactMatch = candidate.tags.find((tag) => context.interestTagIds.has(tag.id));
  if (exactMatch) return context.interestTagNames.get(exactMatch.id);

  const siblingTag = candidate.tags.find(
    (tag) => tag.parentId && context.interestParentIds.has(tag.parentId)
  );
  return siblingTag?.parentId ? context.interestParentToName.get(siblingTag.parentId) : undefined;
}

export function categorizePicks(
  picks: ScoredCandidate[],
  candidates: DiversityCandidate[],
  context: CategorizationContext,
  config: { continueLearningSlots: number; freshPerspectiveSlots: number; highSignalSlots: number }
): PickCategory[] {
  const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const categories: PickCategory[] = [
    { label: 'Continue Learning', items: [] },
    { label: 'Fresh Perspective', items: [] },
    { label: 'High Signal', items: [] },
  ];

  for (const pick of picks) {
    const candidate = candidateMap.get(pick.id);
    if (!candidate) continue;

    const matchingInterestName = findInterestMatch(candidate, context);
    if (matchingInterestName && categories[0].items.length < config.continueLearningSlots) {
      categories[0].items.push({
        ...pick,
        explanation: `Because you're interested in ${matchingInterestName}`,
      });
      continue;
    }

    if (
      pick.signals.novelty > pick.signals.relevance &&
      categories[1].items.length < config.freshPerspectiveSlots
    ) {
      categories[1].items.push(pick);
      continue;
    }

    if (categories[2].items.length < config.highSignalSlots) {
      categories[2].items.push(pick);
      continue;
    }

    if (categories[0].items.length < config.continueLearningSlots) {
      categories[0].items.push(pick);
    } else if (categories[1].items.length < config.freshPerspectiveSlots) {
      categories[1].items.push(pick);
    } else if (categories[2].items.length < config.highSignalSlots) {
      categories[2].items.push(pick);
    }
  }

  return categories;
}
