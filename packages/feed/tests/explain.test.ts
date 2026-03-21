import { describe, it, expect } from 'vitest';
import { explain, explainDetailed } from '../src/explain.js';
import type { RecommendationSignals } from '../src/types.js';

describe('explain', () => {
  it('returns relevance explanation when relevance is dominant', () => {
    const signals: RecommendationSignals = {
      relevance: 0.9,
      collaborative: 0.1,
      quality: 0.1,
      freshness: 0.1,
      novelty: 0.1,
    };
    expect(explain(signals)).toBe('Matches your listening history and interests');
  });

  it('returns collaborative explanation', () => {
    const signals: RecommendationSignals = {
      relevance: 0.1,
      collaborative: 0.9,
      quality: 0.1,
      freshness: 0.1,
      novelty: 0.1,
    };
    expect(explain(signals)).toBe('Highly rated by listeners with similar taste');
  });

  it('returns quality explanation', () => {
    const signals: RecommendationSignals = {
      relevance: 0.1,
      collaborative: 0.1,
      quality: 0.9,
      freshness: 0.1,
      novelty: 0.1,
    };
    expect(explain(signals)).toBe('Outstanding engagement and verified sources');
  });

  it('returns freshness explanation', () => {
    const signals: RecommendationSignals = {
      relevance: 0.1,
      collaborative: 0.1,
      quality: 0.1,
      freshness: 0.9,
      novelty: 0.1,
    };
    expect(explain(signals)).toBe('Recently published and gaining traction');
  });

  it('returns novelty explanation', () => {
    const signals: RecommendationSignals = {
      relevance: 0.1,
      collaborative: 0.1,
      quality: 0.1,
      freshness: 0.1,
      novelty: 0.9,
    };
    expect(explain(signals)).toBe('Something different — explore a new perspective');
  });
});

describe('explainDetailed', () => {
  it('returns all signals sorted by value descending', () => {
    const signals: RecommendationSignals = {
      relevance: 0.3,
      collaborative: 0.8,
      quality: 0.5,
      freshness: 0.1,
      novelty: 0.6,
    };
    const detailed = explainDetailed(signals);
    expect(detailed).toHaveLength(5);
    expect(detailed[0].signal).toBe('collaborative');
    expect(detailed[0].value).toBe(0.8);
    expect(detailed[1].signal).toBe('novelty');
    // Values should be descending
    for (let i = 1; i < detailed.length; i++) {
      expect(detailed[i].value).toBeLessThanOrEqual(detailed[i - 1].value);
    }
  });

  it('includes labels for all signals', () => {
    const signals: RecommendationSignals = {
      relevance: 0.5,
      collaborative: 0.5,
      quality: 0.5,
      freshness: 0.5,
      novelty: 0.5,
    };
    const detailed = explainDetailed(signals);
    for (const entry of detailed) {
      expect(entry.label).toBeTruthy();
    }
  });
});
