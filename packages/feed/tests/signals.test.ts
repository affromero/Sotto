import { describe, it, expect } from 'vitest';
import {
  computeRelevance,
  computeCollaborative,
  computeQuality,
  computeFreshness,
  computeNovelty,
  computeAllSignals,
} from '../src/signals/index.js';

describe('computeRelevance', () => {
  it('returns embedding similarity when no interests', () => {
    const result = computeRelevance({
      embeddingSimilarity: 0.8,
      interestMatches: [],
      podcastTagIds: ['tag1'],
      tagParentMap: new Map(),
    });
    expect(result).toBeCloseTo(0.8);
  });

  it('blends embedding with exact interest match', () => {
    const result = computeRelevance({
      embeddingSimilarity: 0.6,
      interestMatches: [{ tagId: 'tag1', weight: 1 }],
      podcastTagIds: ['tag1'],
      tagParentMap: new Map([['tag1', null]]),
    });
    // relevance = 0.6 * 0.5 + (1/1) * 0.5 = 0.3 + 0.5 = 0.8
    expect(result).toBeCloseTo(0.8);
  });

  it('applies sibling match with 0.4 weight', () => {
    const result = computeRelevance({
      embeddingSimilarity: 0.0,
      interestMatches: [{ tagId: 'interest-tag', weight: 1 }],
      podcastTagIds: ['podcast-tag'],
      tagParentMap: new Map([
        ['interest-tag', 'parent'],
        ['podcast-tag', 'parent'],
      ]),
    });
    // interestRelevance = (1 * 0.4) / 1 = 0.4
    // relevance = 0 * 0.5 + 0.4 * 0.5 = 0.2
    expect(result).toBeCloseTo(0.2);
  });

  it('clamps to [0, 1]', () => {
    const result = computeRelevance({
      embeddingSimilarity: 1.5,
      interestMatches: [],
      podcastTagIds: [],
      tagParentMap: new Map(),
    });
    expect(result).toBe(1);
  });

  it('handles negative embedding similarity', () => {
    const result = computeRelevance({
      embeddingSimilarity: -0.5,
      interestMatches: [],
      podcastTagIds: [],
      tagParentMap: new Map(),
    });
    expect(result).toBe(0);
  });

  it('handles no podcast tags', () => {
    const result = computeRelevance({
      embeddingSimilarity: 0.7,
      interestMatches: [{ tagId: 'tag1', weight: 1 }],
      podcastTagIds: [],
      tagParentMap: new Map(),
    });
    expect(result).toBeCloseTo(0.7);
  });
});

describe('computeCollaborative', () => {
  it('returns 0 for empty completion rates', () => {
    expect(computeCollaborative({ completionRates: [] })).toBe(0);
  });

  it('computes mean of completion rates (scaled from 0-100 to 0-1)', () => {
    const result = computeCollaborative({ completionRates: [80, 60, 100] });
    // (80/100 + 60/100 + 100/100) / 3 = (0.8 + 0.6 + 1.0) / 3 = 0.8
    expect(result).toBeCloseTo(0.8);
  });

  it('clamps to 1', () => {
    const result = computeCollaborative({ completionRates: [100, 100, 100] });
    expect(result).toBe(1);
  });
});

describe('computeQuality', () => {
  it('computes weighted composite', () => {
    const result = computeQuality({
      avgCompletionRate: 80,
      likeToListenRatio: 0.5,
      verifiedReferenceRate: 0.8,
      interactionRate: 0.3,
    });
    // (80/100)*0.4 + 0.5*0.3 + 0.8*0.2 + 0.3*0.1 = 0.32 + 0.15 + 0.16 + 0.03 = 0.66
    expect(result).toBeCloseTo(0.66);
  });

  it('returns 0 for zero inputs', () => {
    const result = computeQuality({
      avgCompletionRate: 0,
      likeToListenRatio: 0,
      verifiedReferenceRate: 0,
      interactionRate: 0,
    });
    expect(result).toBe(0);
  });

  it('clamps to 1', () => {
    const result = computeQuality({
      avgCompletionRate: 100,
      likeToListenRatio: 1,
      verifiedReferenceRate: 1,
      interactionRate: 1,
    });
    expect(result).toBeCloseTo(1);
  });
});

describe('computeFreshness', () => {
  it('returns 1 for brand new content with few listeners', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const result = computeFreshness({
      createdAt: now,
      totalUniqueListeners: 0,
      now,
    });
    // timeFreshness = 1, coldStartBonus = 0.2, clamped to 1
    expect(result).toBe(1);
  });

  it('decays linearly over 30 days', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const result = computeFreshness({
      createdAt: fifteenDaysAgo,
      totalUniqueListeners: 100,
      now,
    });
    // timeFreshness = 1 - (15*24)/(30*24) = 0.5, no cold start bonus
    expect(result).toBeCloseTo(0.5);
  });

  it('returns 0 for content older than 30 days (with many listeners)', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const result = computeFreshness({
      createdAt: fortyDaysAgo,
      totalUniqueListeners: 100,
      now,
    });
    expect(result).toBe(0);
  });

  it('adds cold-start bonus for < 10 listeners', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const result = computeFreshness({
      createdAt: fifteenDaysAgo,
      totalUniqueListeners: 5,
      now,
    });
    // timeFreshness = 0.5 + coldStartBonus = 0.2 → 0.7
    expect(result).toBeCloseTo(0.7);
  });

  it('accepts string dates', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const result = computeFreshness({
      createdAt: '2026-03-21T12:00:00Z',
      totalUniqueListeners: 0,
      now,
    });
    expect(result).toBe(1);
  });
});

describe('computeNovelty', () => {
  it('returns inverse of relevance when user has topic affinity', () => {
    expect(computeNovelty({ relevanceScore: 0.8, hasTopicAffinity: true })).toBeCloseTo(0.2);
  });

  it('returns 0.5 default when no topic affinity', () => {
    expect(computeNovelty({ relevanceScore: 0.8, hasTopicAffinity: false })).toBe(0.5);
  });

  it('clamps to 0 for perfect relevance with affinity', () => {
    expect(computeNovelty({ relevanceScore: 1.0, hasTopicAffinity: true })).toBe(0);
  });
});

describe('computeAllSignals', () => {
  it('computes all five signals', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const signals = computeAllSignals({
      relevance: {
        embeddingSimilarity: 0.7,
        interestMatches: [],
        podcastTagIds: [],
        tagParentMap: new Map(),
      },
      collaborative: { completionRates: [80, 60] },
      quality: {
        avgCompletionRate: 75,
        likeToListenRatio: 0.5,
        verifiedReferenceRate: 0.6,
        interactionRate: 0.2,
      },
      freshness: { createdAt: now, totalUniqueListeners: 50, now },
      novelty: { relevanceScore: 0.7, hasTopicAffinity: true },
    });

    expect(signals.relevance).toBeCloseTo(0.7);
    expect(signals.collaborative).toBeCloseTo(0.7);
    expect(signals.quality).toBeGreaterThan(0);
    expect(signals.freshness).toBe(1);
    expect(signals.novelty).toBeCloseTo(0.3);
  });
});
