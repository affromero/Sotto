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
