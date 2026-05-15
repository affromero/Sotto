import { describe, expect, it } from 'vitest';
import {
  applyDiversity,
  categorizePicks,
  classifyArchetype,
  computeQuality,
  computeRelevance,
  type CategorizationContext,
  type DiversityCandidate,
  type ScoredCandidate,
} from '@/lib/private-recommendations';

describe('private recommendation utilities', () => {
  it('scores relevance from explicit interests and sibling tags', () => {
    const tagParentMap = new Map<string, string | null>([
      ['tag-ai', 'tech'],
      ['tag-ml', 'tech'],
      ['tag-history', 'humanities'],
    ]);

    expect(
      computeRelevance({
        embeddingSimilarity: 0.2,
        interestMatches: [{ tagId: 'tag-ai', weight: 1 }],
        podcastTagIds: ['tag-ml'],
        tagParentMap,
      })
    ).toBeCloseTo(0.3);
  });

  it('uses private quality signals instead of likes or forks', () => {
    expect(
      computeQuality({
        avgCompletionRate: 80,
        saveToListenRatio: 0.4,
        verifiedReferenceRate: 0.75,
        interactionRate: 0.2,
      })
    ).toBeCloseTo(0.63);
  });

  it('keeps daily picks diverse by creator and primary tag', () => {
    const scored: ScoredCandidate[] = [
      candidate('a', 0.9),
      candidate('b', 0.8),
      candidate('c', 0.7),
    ];
    const candidates: DiversityCandidate[] = [
      diversity('a', 'creator-1', 'tag-ai'),
      diversity('b', 'creator-1', 'tag-history'),
      diversity('c', 'creator-2', 'tag-ai'),
    ];

    expect(
      applyDiversity(scored, candidates, {
        maxPerCreator: 1,
        maxPerPrimaryTag: 2,
        maxPicks: 3,
      }).map((pick) => pick.id)
    ).toEqual(['a', 'c']);
  });

  it('categorizes picks without followed-creator slots', () => {
    const context: CategorizationContext = {
      interestTagIds: new Set(['tag-ai']),
      interestTagNames: new Map([['tag-ai', 'AI']]),
      interestParentIds: new Set(['tech']),
      interestParentToName: new Map([['tech', 'AI']]),
    };
    const categories = categorizePicks(
      [
        { ...candidate('a', 0.9), signals: signals({ relevance: 0.8 }) },
        { ...candidate('b', 0.8), signals: signals({ novelty: 0.8, relevance: 0.2 }) },
        { ...candidate('c', 0.7), signals: signals({ quality: 0.9 }) },
      ],
      [
        diversity('a', 'creator-1', 'tag-ai', 'tech'),
        diversity('b', 'creator-2', 'tag-history', 'humanities'),
        diversity('c', 'creator-3', 'tag-science', 'science'),
      ],
      context,
      {
        continueLearningSlots: 1,
        freshPerspectiveSlots: 1,
        highSignalSlots: 1,
      }
    );

    expect(categories.map((category) => category.label)).toEqual([
      'Continue Learning',
      'Fresh Perspective',
      'High Signal',
    ]);
    expect(categories.map((category) => category.items.map((item) => item.id))).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ]);
  });

  it('classifies interactive listeners without social archetypes', () => {
    expect(
      classifyArchetype({
        avgCompletionRate: 75,
        avgSpeed: 1,
        sessions: [
          { seekCount: 0, interruptCount: 2 },
          { seekCount: 0, interruptCount: 3 },
        ],
      })
    ).toBe('active_learner');
  });
});

function candidate(id: string, score: number): ScoredCandidate {
  return {
    id,
    score,
    signals: signals(),
    explanation: `Pick ${id}`,
  };
}

function diversity(
  id: string,
  creatorId: string,
  tagId: string,
  parentId: string | null = null
): DiversityCandidate {
  return {
    id,
    creatorId,
    tags: [{ id: tagId, parentId }],
  };
}

function signals(overrides: Partial<ScoredCandidate['signals']> = {}): ScoredCandidate['signals'] {
  return {
    relevance: 0,
    collaborative: 0,
    quality: 0,
    freshness: 0,
    novelty: 0,
    ...overrides,
  };
}
