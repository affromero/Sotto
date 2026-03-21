import { describe, it, expect } from 'vitest';
import { categorizePicks } from '../src/categorize.js';
import type { ScoredCandidate, DiversityCandidate, CategorizationContext } from '../src/types.js';

function makePick(
  id: string,
  score: number,
  overrides?: Partial<ScoredCandidate['signals']>
): ScoredCandidate {
  return {
    id,
    score,
    signals: {
      relevance: 0.5,
      collaborative: 0.5,
      quality: 0.5,
      freshness: 0.5,
      novelty: 0.5,
      ...overrides,
    },
    explanation: 'test',
  };
}

function makeCandidate(id: string, creatorId: string, tagIds: string[]): DiversityCandidate {
  return {
    id,
    creatorId,
    tags: tagIds.map((tid) => ({ id: tid, parentId: null })),
  };
}

const defaultConfig = {
  continueLearningSlots: 3,
  freshPerspectiveSlots: 2,
  fromYourPeopleSlots: 2,
};

describe('categorizePicks', () => {
  it('puts followed creator picks in "From Your People"', () => {
    const picks = [makePick('p1', 0.9)];
    const candidates = [makeCandidate('p1', 'creator-1', ['tag1'])];
    const context: CategorizationContext = {
      followedCreatorIds: new Set(['creator-1']),
      interestTagIds: new Set(),
      interestTagNames: new Map(),
      interestParentIds: new Set(),
    };

    const cats = categorizePicks(picks, candidates, context, defaultConfig);
    expect(cats[2].label).toBe('From Your People');
    expect(cats[2].items).toHaveLength(1);
    expect(cats[2].items[0].id).toBe('p1');
  });

  it('puts interest-matching picks in "Continue Learning"', () => {
    const picks = [makePick('p1', 0.9)];
    const candidates = [makeCandidate('p1', 'creator-1', ['ai-tag'])];
    const context: CategorizationContext = {
      followedCreatorIds: new Set(),
      interestTagIds: new Set(['ai-tag']),
      interestTagNames: new Map([['ai-tag', 'Artificial Intelligence']]),
      interestParentIds: new Set(),
    };

    const cats = categorizePicks(picks, candidates, context, defaultConfig);
    expect(cats[0].label).toBe('Continue Learning');
    expect(cats[0].items).toHaveLength(1);
    expect(cats[0].items[0].explanation).toContain('Artificial Intelligence');
  });

  it('puts high-novelty picks in "Fresh Perspective"', () => {
    const picks = [makePick('p1', 0.9, { novelty: 0.9, relevance: 0.1 })];
    const candidates = [makeCandidate('p1', 'creator-1', ['tag1'])];
    const context: CategorizationContext = {
      followedCreatorIds: new Set(),
      interestTagIds: new Set(),
      interestTagNames: new Map(),
      interestParentIds: new Set(),
    };

    const cats = categorizePicks(picks, candidates, context, defaultConfig);
    expect(cats[1].label).toBe('Fresh Perspective');
    expect(cats[1].items).toHaveLength(1);
  });

  it('respects slot limits and overflows to other categories', () => {
    const picks = Array.from({ length: 7 }, (_, i) => makePick(`p${i}`, 0.9 - i * 0.1));
    const candidates = picks.map((p) => makeCandidate(p.id, `creator-${p.id}`, ['tag1']));
    const context: CategorizationContext = {
      followedCreatorIds: new Set(),
      interestTagIds: new Set(['tag1']),
      interestTagNames: new Map([['tag1', 'Tech']]),
      interestParentIds: new Set(),
    };

    const cats = categorizePicks(picks, candidates, context, defaultConfig);
    const totalCategorized =
      cats[0].items.length + cats[1].items.length + cats[2].items.length;
    expect(totalCategorized).toBe(7);
    expect(cats[0].items.length).toBeLessThanOrEqual(3);
    expect(cats[1].items.length).toBeLessThanOrEqual(2);
    expect(cats[2].items.length).toBeLessThanOrEqual(2);
  });

  it('handles empty picks', () => {
    const context: CategorizationContext = {
      followedCreatorIds: new Set(),
      interestTagIds: new Set(),
      interestTagNames: new Map(),
      interestParentIds: new Set(),
    };

    const cats = categorizePicks([], [], context, defaultConfig);
    expect(cats).toHaveLength(3);
    expect(cats[0].items).toHaveLength(0);
    expect(cats[1].items).toHaveLength(0);
    expect(cats[2].items).toHaveLength(0);
  });

  it('returns three categories with correct labels', () => {
    const context: CategorizationContext = {
      followedCreatorIds: new Set(),
      interestTagIds: new Set(),
      interestTagNames: new Map(),
      interestParentIds: new Set(),
    };
    const cats = categorizePicks([], [], context, defaultConfig);
    expect(cats.map((c) => c.label)).toEqual([
      'Continue Learning',
      'Fresh Perspective',
      'From Your People',
    ]);
  });
});
