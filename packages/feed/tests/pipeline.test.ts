import { describe, it, expect } from 'vitest';
import { lightRank, heavyRank } from '../src/pipeline.js';
import type { RecommendationSignals, SignalWeights } from '../src/types.js';

describe('lightRank', () => {
  it('prunes to budget', () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      relevance: Math.random(),
      freshness: Math.random(),
    }));
    const result = lightRank(candidates, 10);
    expect(result).toHaveLength(10);
  });

  it('sorts by weighted relevance + freshness', () => {
    const candidates = [
      { id: 'a', relevance: 0.5, freshness: 0.5 },
      { id: 'b', relevance: 1.0, freshness: 1.0 },
      { id: 'c', relevance: 0.0, freshness: 0.0 },
    ];
    const result = lightRank(candidates, 3);
    expect(result[0].id).toBe('b');
    expect(result[result.length - 1].id).toBe('c');
  });

  it('returns all when budget exceeds candidates', () => {
    const candidates = [{ id: 'a', relevance: 0.5, freshness: 0.5 }];
    const result = lightRank(candidates, 10);
    expect(result).toHaveLength(1);
  });
});

describe('heavyRank', () => {
  const weights: SignalWeights = {
    relevance: 0.3,
    collaborative: 0.25,
    quality: 0.2,
    freshness: 0.15,
    novelty: 0.1,
  };

  it('scores and sorts candidates', () => {
    const signals1: RecommendationSignals = {
      relevance: 1.0, collaborative: 1.0, quality: 1.0, freshness: 1.0, novelty: 1.0,
    };
    const signals2: RecommendationSignals = {
      relevance: 0.1, collaborative: 0.1, quality: 0.1, freshness: 0.1, novelty: 0.1,
    };
    const candidates = [
      { id: 'low', signals: signals2 },
      { id: 'high', signals: signals1 },
    ];
    const result = heavyRank(candidates, weights);
    expect(result[0].id).toBe('high');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('produces ScoredCandidate shape', () => {
    const signals: RecommendationSignals = {
      relevance: 0.5, collaborative: 0.5, quality: 0.5, freshness: 0.5, novelty: 0.5,
    };
    const result = heavyRank([{ id: 'test', signals }], weights);
    expect(result[0]).toHaveProperty('id');
    expect(result[0]).toHaveProperty('score');
    expect(result[0]).toHaveProperty('signals');
    expect(result[0]).toHaveProperty('explanation');
  });
});
