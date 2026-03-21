/** Scored candidate after ranking. Generic 'id' — web adapter maps to podcastId. */
export interface ScoredCandidate {
  id: string;
  score: number;
  signals: RecommendationSignals;
  explanation: string;
}

/** Five-signal recommendation vector, each 0-1. */
export interface RecommendationSignals {
  relevance: number;
  collaborative: number;
  quality: number;
  freshness: number;
  novelty: number;
}

/** Input for relevance signal computation. */
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

/** Input for collaborative filtering signal. */
export interface CollaborativeInput {
  completionRates: number[];
}

/** Input for quality signal. */
export interface QualityInput {
  avgCompletionRate: number;
  likeToListenRatio: number;
  verifiedReferenceRate: number;
  interactionRate: number;
}

/** Input for freshness signal. */
export interface FreshnessInput {
  createdAt: Date | string;
  totalUniqueListeners: number;
  now?: Date;
}

/** Input for novelty signal. */
export interface NoveltyInput {
  relevanceScore: number;
  hasTopicAffinity: boolean;
}

/** Context required for categorizing picks into slots. */
export interface CategorizationContext {
  followedCreatorIds: Set<string>;
  interestTagIds: Set<string>;
  interestTagNames: Map<string, string>;
  interestParentIds: Set<string>;
}

/** Candidate metadata needed for diversity filtering. */
export interface DiversityCandidate {
  id: string;
  creatorId: string;
  tags: Array<{ id: string; parentId?: string | null }>;
}

export type Archetype = 'deep_listener' | 'skimmer' | 'explorer' | 'completer' | 'social_learner';
export type SignalName = 'relevance' | 'collaborative' | 'quality' | 'freshness' | 'novelty';
export type SignalWeights = Record<SignalName, number>;

export type CategoryLabel = 'Continue Learning' | 'Fresh Perspective' | 'From Your People';

export interface PickCategory {
  label: CategoryLabel;
  items: ScoredCandidate[];
}

/** Input for archetype classification. */
export interface ArchetypeInput {
  avgCompletionRate: number;
  avgSpeed: number;
  sessions: Array<{ seekCount: number; interruptCount: number }>;
}
