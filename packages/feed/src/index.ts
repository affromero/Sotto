// Types
export type {
  ScoredCandidate,
  RecommendationSignals,
  RelevanceInput,
  InterestMatch,
  CollaborativeInput,
  QualityInput,
  FreshnessInput,
  NoveltyInput,
  CategorizationContext,
  DiversityCandidate,
  Archetype,
  SignalName,
  SignalWeights,
  CategoryLabel,
  PickCategory,
  ArchetypeInput,
} from './types.js';

// Config
export { type FeedConfig, DEFAULT_FEED_CONFIG } from './config.js';

// Signals
export {
  computeRelevance,
  computeCollaborative,
  computeQuality,
  computeFreshness,
  computeNovelty,
  computeAllSignals,
  type AllSignalsInput,
} from './signals/index.js';

// Archetypes
export { classifyArchetype, getArchetypeWeights } from './archetypes.js';

// Scoring
export { computeWeightedScore } from './scoring.js';

// Explain
export { explain, explainDetailed } from './explain.js';

// Diversity
export { applyDiversity } from './diversity.js';

// Categorize
export { categorizePicks } from './categorize.js';

// Reputation
export {
  computeCreatorReputation,
  type CreatorReputationInput,
} from './reputation.js';

// Social Proof
export {
  applySocialProofGate,
  DEFAULT_SOCIAL_PROOF_CONFIG,
  type SocialProofInput,
  type SocialProofConfig,
} from './social-proof.js';

// Fatigue
export {
  computeFatigueMultiplier,
  DEFAULT_FATIGUE_CONFIG,
  type FatigueEntry,
  type FatigueConfig,
} from './fatigue.js';

// Quality Gate
export {
  applyQualityGate,
  DEFAULT_QUALITY_GATE_CONFIG,
  type QualityGateConfig,
} from './quality-gate.js';

// Dedup
export {
  applyDedupPenalty,
  DEFAULT_DEDUP_CONFIG,
  type DedupConfig,
} from './dedup.js';

// Sourcing
export {
  sourceCandidates,
  DEFAULT_SOURCING_CONFIG,
  type SourcingConfig,
  type SourcingResult,
} from './sourcing.js';

// Pipeline
export { lightRank, heavyRank } from './pipeline.js';

// Feed Construction
export {
  constructFeed,
  type FeedConstructionInput,
  type FeedConstructionConfig,
  type RankedFeed,
} from './feed.js';
