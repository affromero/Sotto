import { describe, it, expect } from 'vitest';
import { computeWeightedScore } from '../src/scoring.js';
import type { RecommendationSignals, SignalWeights } from '../src/types.js';

describe('computeWeightedScore', () => {
  it('computes weighted sum of signals', () => {
    const signals: RecommendationSignals = {
      relevance: 0.8,
      collaborative: 0.6,
      quality: 0.7,
      freshness: 0.5,
      novelty: 0.3,
    };
    const weights: SignalWeights = {
      relevance: 0.3,
      collaborative: 0.25,
      quality: 0.2,
      freshness: 0.15,
      novelty: 0.1,
    };
    // 0.8*0.3 + 0.6*0.25 + 0.7*0.2 + 0.5*0.15 + 0.3*0.1
    // = 0.24 + 0.15 + 0.14 + 0.075 + 0.03 = 0.635
    const result = computeWeightedScore(signals, weights);
    expect(result).toBeCloseTo(0.635);
  });

  it('returns 0 for zero signals', () => {
    const signals: RecommendationSignals = {
      relevance: 0,
      collaborative: 0,
      quality: 0,
      freshness: 0,
      novelty: 0,
    };
    const weights: SignalWeights = {
      relevance: 0.3,
      collaborative: 0.25,
      quality: 0.2,
      freshness: 0.15,
      novelty: 0.1,
    };
    expect(computeWeightedScore(signals, weights)).toBe(0);
  });

  it('returns max possible when all signals are 1', () => {
    const signals: RecommendationSignals = {
      relevance: 1,
      collaborative: 1,
      quality: 1,
      freshness: 1,
      novelty: 1,
    };
    const weights: SignalWeights = {
      relevance: 0.3,
      collaborative: 0.25,
      quality: 0.2,
      freshness: 0.15,
      novelty: 0.1,
    };
    expect(computeWeightedScore(signals, weights)).toBeCloseTo(1.0);
  });
});
