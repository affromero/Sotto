import type {
  ScoredCandidate,
  DiversityCandidate,
  CategorizationContext,
  PickCategory,
  SignalWeights,
  RecommendationSignals,
} from './types.js';
import { applyDiversity } from './diversity.js';
import { categorizePicks } from './categorize.js';
import { explain } from './explain.js';
import { applyQualityGate, type QualityGateConfig, DEFAULT_QUALITY_GATE_CONFIG } from './quality-gate.js';
import { applySocialProofGate, type SocialProofInput, type SocialProofConfig, DEFAULT_SOCIAL_PROOF_CONFIG } from './social-proof.js';
import { computeFatigueMultiplier, type FatigueEntry, type FatigueConfig, DEFAULT_FATIGUE_CONFIG } from './fatigue.js';
import { applyDedupPenalty, type DedupConfig, DEFAULT_DEDUP_CONFIG } from './dedup.js';
import { sourceCandidates, type SourcingConfig, DEFAULT_SOURCING_CONFIG } from './sourcing.js';
import { lightRank, heavyRank } from './pipeline.js';
import { DEFAULT_FEED_CONFIG } from './config.js';

/** Full feed construction input. */
export interface FeedConstructionInput {
  /** All candidate items with pre-computed signals. */
  candidates: Array<{
    id: string;
    creatorId: string;
    signals: RecommendationSignals;
    tags: Array<{ id: string; parentId?: string | null }>;
    relevance: number;
    freshness: number;
    creatorReputation?: number;
    socialProof?: SocialProofInput;
    alreadySeen: boolean;
    isInNetwork: boolean;
  }>;
  /** Per-user archetype weights. */
  weights: SignalWeights;
  /** Categorization context from Prisma. */
  context: CategorizationContext;
  /** Per-user fatigue entries. */
  fatigueEntries: FatigueEntry[];
  /** Optional config overrides. */
  config?: Partial<FeedConstructionConfig>;
}

export interface FeedConstructionConfig {
  confidenceThreshold: number;
  maxPicks: number;
  maxPerCreator: number;
  maxPerPrimaryTag: number;
  continueLearningSlots: number;
  freshPerspectiveSlots: number;
  fromYourPeopleSlots: number;
  lightRankBudgetMultiplier: number;
  authorDiversityPenalty: number;
  qualityGate: QualityGateConfig;
  socialProof: SocialProofConfig;
  fatigue: FatigueConfig;
  dedup: DedupConfig;
  sourcing: SourcingConfig;
}

const DEFAULT_CONSTRUCTION_CONFIG: FeedConstructionConfig = {
  confidenceThreshold: DEFAULT_FEED_CONFIG.confidenceThreshold,
  maxPicks: DEFAULT_FEED_CONFIG.maxPicks,
  maxPerCreator: DEFAULT_FEED_CONFIG.maxPerCreator,
  maxPerPrimaryTag: DEFAULT_FEED_CONFIG.maxPerPrimaryTag,
  continueLearningSlots: DEFAULT_FEED_CONFIG.continueLearningSlots,
  freshPerspectiveSlots: DEFAULT_FEED_CONFIG.freshPerspectiveSlots,
  fromYourPeopleSlots: DEFAULT_FEED_CONFIG.fromYourPeopleSlots,
  lightRankBudgetMultiplier: 2,
  authorDiversityPenalty: 0.5,
  qualityGate: DEFAULT_QUALITY_GATE_CONFIG,
  socialProof: DEFAULT_SOCIAL_PROOF_CONFIG,
  fatigue: DEFAULT_FATIGUE_CONFIG,
  dedup: DEFAULT_DEDUP_CONFIG,
  sourcing: DEFAULT_SOURCING_CONFIG,
};

/** Result of feed construction. */
export interface RankedFeed {
  picks: ScoredCandidate[];
  categories: PickCategory[];
  message?: string;
}

/**
 * Construct a complete ranked feed using the full pipeline:
 *
 * 1. Source candidates (60/40 in/out-of-network)
 * 2. Light rank (relevance + freshness → prune to 2x budget)
 * 3. Heavy rank (full 5-signal scoring)
 * 4. Quality gate (exclude low-reputation creators)
 * 5. Social proof gate (out-of-network must have mutual engagers)
 * 6. Author diversity penalty (score-halving on repeated creator)
 * 7. Fatigue multiplier (per user×creator decay)
 * 8. Dedup penalty (already-seen reduction)
 * 9. Diversity filter (creator + tag caps)
 * 10. Confidence threshold filter
 * 11. Categorize into slots
 * 12. Generate message if < 5 picks
 */
export function constructFeed(input: FeedConstructionInput): RankedFeed {
  const config = { ...DEFAULT_CONSTRUCTION_CONFIG, ...input.config };

  // 1. Source candidates
  const { inNetwork, outOfNetwork } = sourceCandidates(
    input.candidates,
    (c) => c.isInNetwork,
    input.candidates.length,
    config.sourcing
  );
  const sourced = [...inNetwork, ...outOfNetwork];

  // 2. Light rank → prune to 2x budget
  const lightRanked = lightRank(
    sourced.map((c) => ({ id: c.id, relevance: c.relevance, freshness: c.freshness })),
    config.maxPicks * config.lightRankBudgetMultiplier
  );
  const lightRankedIds = new Set(lightRanked.map((r) => r.id));
  const pruned = sourced.filter((c) => lightRankedIds.has(c.id));

  // 3. Heavy rank
  const heavyRanked = heavyRank(
    pruned.map((c) => ({ id: c.id, signals: c.signals })),
    input.weights
  );

  // Build lookup maps
  const candidateMap = new Map(input.candidates.map((c) => [c.id, c]));

  // 4-8. Apply gates and adjustments
  let ranked: ScoredCandidate[] = [];
  const creatorSeenForPenalty = new Set<string>();

  for (const item of heavyRanked) {
    const candidate = candidateMap.get(item.id);
    if (!candidate) continue;

    // 4. Quality gate
    if (!applyQualityGate(candidate.creatorReputation, config.qualityGate)) continue;

    // 5. Social proof gate
    if (candidate.socialProof && !applySocialProofGate(candidate.socialProof, config.socialProof)) {
      continue;
    }

    let adjustedScore = item.score;

    // 6. Author diversity penalty
    if (creatorSeenForPenalty.has(candidate.creatorId)) {
      adjustedScore *= 1 - config.authorDiversityPenalty;
    }
    creatorSeenForPenalty.add(candidate.creatorId);

    // 7. Fatigue multiplier
    adjustedScore *= computeFatigueMultiplier(
      input.fatigueEntries,
      candidate.creatorId,
      config.fatigue
    );

    // 8. Dedup penalty
    adjustedScore = applyDedupPenalty(adjustedScore, candidate.alreadySeen, config.dedup);

    ranked.push({
      ...item,
      score: adjustedScore,
      explanation: explain(item.signals),
    });
  }

  // Re-sort after adjustments
  ranked.sort((a, b) => b.score - a.score);

  // 9. Diversity filter
  const diversityCandidates: DiversityCandidate[] = input.candidates.map((c) => ({
    id: c.id,
    creatorId: c.creatorId,
    tags: c.tags,
  }));

  const diverse = applyDiversity(ranked, diversityCandidates, {
    maxPerCreator: config.maxPerCreator,
    maxPerPrimaryTag: config.maxPerPrimaryTag,
    maxPicks: config.maxPicks,
  });

  // 10. Confidence threshold
  const confident = diverse.filter((p) => p.score >= config.confidenceThreshold);

  // 11. Categorize
  const categories = categorizePicks(confident, diversityCandidates, input.context, {
    continueLearningSlots: config.continueLearningSlots,
    freshPerspectiveSlots: config.freshPerspectiveSlots,
    fromYourPeopleSlots: config.fromYourPeopleSlots,
  });

  const allPicks = categories.flatMap((c) => c.items);

  // 12. Message if sparse
  const message =
    allPicks.length < 5
      ? "We're still learning your taste — create a podcast about what interests you and we'll get better."
      : undefined;

  return { picks: allPicks, categories, message };
}
