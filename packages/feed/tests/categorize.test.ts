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

function makeCandidate(
  id: string,
  creatorId: string,
  tags: Array<{ id: string; parentId?: string | null }>
): DiversityCandidate {
  return {
    id,
    creatorId,
    tags: tags.map((t) => ({ id: t.id, parentId: t.parentId ?? null })),
  };
}

function emptyContext(): CategorizationContext {
  return {
    followedCreatorIds: new Set(),
    interestTagIds: new Set(),
    interestTagNames: new Map(),
    interestParentIds: new Set(),
    interestParentToName: new Map(),
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
    const candidates = [makeCandidate('p1', 'creator-1', [{ id: 'tag1' }])];
    const context: CategorizationContext = {
      ...emptyContext(),
      followedCreatorIds: new Set(['creator-1']),
    };

    const cats = categorizePicks(picks, candidates, context, defaultConfig);
    expect(cats[2].label).toBe('From Your People');
    expect(cats[2].items).toHaveLength(1);
    expect(cats[2].items[0].id).toBe('p1');
  });

  it('puts interest-matching picks in "Continue Learning"', () => {
    const picks = [makePick('p1', 0.9)];
    const candidates = [makeCandidate('p1', 'creator-1', [{ id: 'ai-tag' }])];
    const context: CategorizationContext = {
      ...emptyContext(),
      interestTagIds: new Set(['ai-tag']),
      interestTagNames: new Map([['ai-tag', 'Artificial Intelligence']]),
    };

    const cats = categorizePicks(picks, candidates, context, defaultConfig);
    expect(cats[0].label).toBe('Continue Learning');
    expect(cats[0].items).toHaveLength(1);
    expect(cats[0].items[0].explanation).toContain('Artificial Intelligence');
  });

  it('matches sibling tags via shared parent', () => {
    const picks = [makePick('p1', 0.9)];
    // Podcast has tag "react" with parent "frontend"
    const candidates = [
      makeCandidate('p1', 'creator-1', [{ id: 'react', parentId: 'frontend' }]),
    ];
    // User is interested in "vue" which also has parent "frontend"
    const context: CategorizationContext = {
      ...emptyContext(),
      interestTagIds: new Set(['vue']),
      interestTagNames: new Map([['vue', 'Vue.js']]),
      interestParentIds: new Set(['frontend']),
      interestParentToName: new Map([['frontend', 'Vue.js']]),
    };

    const cats = categorizePicks(picks, candidates, context, defaultConfig);
    expect(cats[0].label).toBe('Continue Learning');
    expect(cats[0].items).toHaveLength(1);
    expect(cats[0].items[0].explanation).toContain('Vue.js');
  });

  it('puts high-novelty picks in "Fresh Perspective"', () => {
    const picks = [makePick('p1', 0.9, { novelty: 0.9, relevance: 0.1 })];
    const candidates = [makeCandidate('p1', 'creator-1', [{ id: 'tag1' }])];

    const cats = categorizePicks(picks, candidates, emptyContext(), defaultConfig);
    expect(cats[1].label).toBe('Fresh Perspective');
    expect(cats[1].items).toHaveLength(1);
  });

  it('respects slot limits and overflows to other categories', () => {
    const picks = Array.from({ length: 7 }, (_, i) => makePick(`p${i}`, 0.9 - i * 0.1));
    const candidates = picks.map((p) =>
      makeCandidate(p.id, `creator-${p.id}`, [{ id: 'tag1' }])
    );
    const context: CategorizationContext = {
      ...emptyContext(),
      interestTagIds: new Set(['tag1']),
      interestTagNames: new Map([['tag1', 'Tech']]),
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
    const cats = categorizePicks([], [], emptyContext(), defaultConfig);
    expect(cats).toHaveLength(3);
    expect(cats[0].items).toHaveLength(0);
    expect(cats[1].items).toHaveLength(0);
    expect(cats[2].items).toHaveLength(0);
  });

  it('returns three categories with correct labels', () => {
    const cats = categorizePicks([], [], emptyContext(), defaultConfig);
    expect(cats.map((c) => c.label)).toEqual([
      'Continue Learning',
      'Fresh Perspective',
      'From Your People',
    ]);
  });
});
