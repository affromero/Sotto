import { describe, it, expect } from 'vitest';
import { constructFeed } from '../src/feed.js';
import type { FeedConstructionInput } from '../src/feed.js';
import type { RecommendationSignals, SignalWeights } from '../src/types.js';

function makeSignals(overrides?: Partial<RecommendationSignals>): RecommendationSignals {
  return {
    relevance: 0.7,
    collaborative: 0.6,
    quality: 0.8,
    freshness: 0.5,
    novelty: 0.3,
    ...overrides,
  };
}

function makeCandidate(
  id: string,
  creatorId: string,
  tagIds: string[],
  overrides?: Partial<FeedConstructionInput['candidates'][0]>
) {
  const signals = makeSignals(overrides?.signals);
  return {
    id,
    creatorId,
    signals,
    tags: tagIds.map((tid) => ({ id: tid, parentId: null })),
    relevance: signals.relevance,
    freshness: signals.freshness,
    alreadySeen: false,
    isInNetwork: true,
    ...overrides,
  };
}

const defaultWeights: SignalWeights = {
  relevance: 0.3,
  collaborative: 0.25,
  quality: 0.2,
  freshness: 0.15,
  novelty: 0.1,
};

const defaultContext = {
  followedCreatorIds: new Set<string>(),
  interestTagIds: new Set<string>(),
  interestTagNames: new Map<string, string>(),
  interestParentIds: new Set<string>(),
};

describe('constructFeed', () => {
  it('produces a ranked feed with categories', () => {
    const input: FeedConstructionInput = {
      candidates: [
        makeCandidate('p1', 'c1', ['tech']),
        makeCandidate('p2', 'c2', ['science']),
        makeCandidate('p3', 'c3', ['art']),
      ],
      weights: defaultWeights,
      context: defaultContext,
      fatigueEntries: [],
    };

    const result = constructFeed(input);
    expect(result.categories).toHaveLength(3);
    expect(result.picks.length).toBeGreaterThan(0);
    expect(result.picks.length).toBeLessThanOrEqual(7);
  });

  it('filters by quality gate', () => {
    const input: FeedConstructionInput = {
      candidates: [
        makeCandidate('p1', 'c1', ['tech'], { creatorReputation: 5 }),
        makeCandidate('p2', 'c2', ['science'], { creatorReputation: 50 }),
      ],
      weights: defaultWeights,
      context: defaultContext,
      fatigueEntries: [],
      config: {
        qualityGate: { enabled: true, minReputation: 10 },
      },
    };

    const result = constructFeed(input);
    // p1 should be filtered out (rep 5 < 10)
    const ids = result.picks.map((p) => p.id);
    expect(ids).not.toContain('p1');
    expect(ids).toContain('p2');
  });

  it('applies fatigue penalty', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const input: FeedConstructionInput = {
      candidates: [
        makeCandidate('p1', 'c1', ['tech']),
        makeCandidate('p2', 'c2', ['science']),
      ],
      weights: defaultWeights,
      context: defaultContext,
      fatigueEntries: [
        { creatorId: 'c1', action: 'skip', timestamp: new Date(now.getTime() - 3600000) },
        { creatorId: 'c1', action: 'skip', timestamp: new Date(now.getTime() - 3600000) },
        { creatorId: 'c1', action: 'skip', timestamp: new Date(now.getTime() - 3600000) },
      ],
    };

    const result = constructFeed(input);
    // c1's podcast should have lower score due to fatigue
    const p1 = result.picks.find((p) => p.id === 'p1');
    const p2 = result.picks.find((p) => p.id === 'p2');
    if (p1 && p2) {
      expect(p1.score).toBeLessThan(p2.score);
    }
  });

  it('applies dedup penalty for seen content', () => {
    const input: FeedConstructionInput = {
      candidates: [
        makeCandidate('p1', 'c1', ['tech'], { alreadySeen: true }),
        makeCandidate('p2', 'c2', ['science'], { alreadySeen: false }),
      ],
      weights: defaultWeights,
      context: defaultContext,
      fatigueEntries: [],
    };

    const result = constructFeed(input);
    const p1 = result.picks.find((p) => p.id === 'p1');
    const p2 = result.picks.find((p) => p.id === 'p2');
    if (p1 && p2) {
      expect(p1.score).toBeLessThan(p2.score);
    }
  });

  it('generates message when < 5 picks', () => {
    const input: FeedConstructionInput = {
      candidates: [makeCandidate('p1', 'c1', ['tech'])],
      weights: defaultWeights,
      context: defaultContext,
      fatigueEntries: [],
    };

    const result = constructFeed(input);
    expect(result.message).toBeTruthy();
  });

  it('no message when >= 5 picks', () => {
    const input: FeedConstructionInput = {
      candidates: Array.from({ length: 7 }, (_, i) =>
        makeCandidate(`p${i}`, `c${i}`, [`tag${i}`])
      ),
      weights: defaultWeights,
      context: defaultContext,
      fatigueEntries: [],
    };

    const result = constructFeed(input);
    expect(result.message).toBeUndefined();
  });

  it('handles empty candidates', () => {
    const result = constructFeed({
      candidates: [],
      weights: defaultWeights,
      context: defaultContext,
      fatigueEntries: [],
    });
    expect(result.picks).toEqual([]);
    expect(result.categories).toHaveLength(3);
    expect(result.message).toBeTruthy();
  });
});
