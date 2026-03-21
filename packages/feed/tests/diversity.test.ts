import { describe, it, expect } from 'vitest';
import { applyDiversity } from '../src/diversity.js';
import type { ScoredCandidate, DiversityCandidate } from '../src/types.js';

function makeScoredCandidate(id: string, score: number): ScoredCandidate {
  return {
    id,
    score,
    signals: { relevance: 0.5, collaborative: 0.5, quality: 0.5, freshness: 0.5, novelty: 0.5 },
    explanation: 'test',
  };
}

function makeDiversityCandidate(
  id: string,
  creatorId: string,
  tagIds: string[]
): DiversityCandidate {
  return {
    id,
    creatorId,
    tags: tagIds.map((tid) => ({ id: tid, parentId: null })),
  };
}

describe('applyDiversity', () => {
  it('limits picks to maxPicks', () => {
    const scored = Array.from({ length: 10 }, (_, i) => makeScoredCandidate(`p${i}`, 1 - i * 0.1));
    const candidates = scored.map((s) => makeDiversityCandidate(s.id, `creator-${s.id}`, ['tag1']));

    const result = applyDiversity(scored, candidates, {
      maxPerCreator: 1,
      maxPerPrimaryTag: 10,
      maxPicks: 5,
    });
    expect(result).toHaveLength(5);
  });

  it('enforces creator cap', () => {
    const scored = [
      makeScoredCandidate('p1', 0.9),
      makeScoredCandidate('p2', 0.8),
      makeScoredCandidate('p3', 0.7),
    ];
    const candidates = [
      makeDiversityCandidate('p1', 'creator-a', ['tag1']),
      makeDiversityCandidate('p2', 'creator-a', ['tag2']),
      makeDiversityCandidate('p3', 'creator-b', ['tag3']),
    ];

    const result = applyDiversity(scored, candidates, {
      maxPerCreator: 1,
      maxPerPrimaryTag: 10,
      maxPicks: 10,
    });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(['p1', 'p3']);
  });

  it('enforces primary tag cap', () => {
    const scored = [
      makeScoredCandidate('p1', 0.9),
      makeScoredCandidate('p2', 0.8),
      makeScoredCandidate('p3', 0.7),
      makeScoredCandidate('p4', 0.6),
    ];
    const candidates = [
      makeDiversityCandidate('p1', 'c1', ['same-tag']),
      makeDiversityCandidate('p2', 'c2', ['same-tag']),
      makeDiversityCandidate('p3', 'c3', ['same-tag']),
      makeDiversityCandidate('p4', 'c4', ['diff-tag']),
    ];

    const result = applyDiversity(scored, candidates, {
      maxPerCreator: 10,
      maxPerPrimaryTag: 2,
      maxPicks: 10,
    });
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual(['p1', 'p2', 'p4']);
  });

  it('handles candidates with no tags', () => {
    const scored = [makeScoredCandidate('p1', 0.9)];
    const candidates = [makeDiversityCandidate('p1', 'c1', [])];

    const result = applyDiversity(scored, candidates, {
      maxPerCreator: 1,
      maxPerPrimaryTag: 2,
      maxPicks: 10,
    });
    expect(result).toHaveLength(1);
  });

  it('skips scored items without matching candidates', () => {
    const scored = [makeScoredCandidate('p1', 0.9), makeScoredCandidate('p-missing', 0.8)];
    const candidates = [makeDiversityCandidate('p1', 'c1', ['tag1'])];

    const result = applyDiversity(scored, candidates, {
      maxPerCreator: 1,
      maxPerPrimaryTag: 2,
      maxPicks: 10,
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });

  it('returns empty for empty input', () => {
    const result = applyDiversity([], [], { maxPerCreator: 1, maxPerPrimaryTag: 2, maxPicks: 7 });
    expect(result).toEqual([]);
  });
});
