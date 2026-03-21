import type {
  RelevanceInput,
  CollaborativeInput,
  QualityInput,
  FreshnessInput,
  NoveltyInput,
  RecommendationSignals,
} from '../types.js';
import { computeRelevance } from './relevance.js';
import { computeCollaborative } from './collaborative.js';
import { computeQuality } from './quality.js';
import { computeFreshness } from './freshness.js';
import { computeNovelty } from './novelty.js';

export { computeRelevance } from './relevance.js';
export { computeCollaborative } from './collaborative.js';
export { computeQuality } from './quality.js';
export { computeFreshness } from './freshness.js';
export { computeNovelty } from './novelty.js';

export interface AllSignalsInput {
  relevance: RelevanceInput;
  collaborative: CollaborativeInput;
  quality: QualityInput;
  freshness: FreshnessInput;
  novelty: NoveltyInput;
}

/** Compute all five signals at once. */
export function computeAllSignals(input: AllSignalsInput): RecommendationSignals {
  return {
    relevance: computeRelevance(input.relevance),
    collaborative: computeCollaborative(input.collaborative),
    quality: computeQuality(input.quality),
    freshness: computeFreshness(input.freshness),
    novelty: computeNovelty(input.novelty),
  };
}
