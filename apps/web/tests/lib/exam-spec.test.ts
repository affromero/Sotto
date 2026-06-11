/**
 * resolveExamSpec aggregates every curriculum lesson at the exam level into one
 * representative objective + grammar + vocab set for the section generators.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLessonFindMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { lesson: { findMany: (...a: unknown[]) => mockLessonFindMany(...a) } },
}));

import { resolveExamSpec } from '@/lib/exam-spec';

describe('resolveExamSpec', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dedupes vocab and grammar across the level lessons and builds an objective', async () => {
    mockLessonFindMany.mockResolvedValue([
      {
        objective: 'Order food',
        canDoSummary: 'Can order a meal',
        grammarPoints: ['akkusativ'],
        targetVocab: [{ lemma: 'der Kaffee', gloss: 'coffee' }],
      },
      {
        objective: 'Make small talk',
        canDoSummary: 'Can chat about the weekend',
        grammarPoints: ['akkusativ', 'perfekt'],
        targetVocab: [
          { lemma: 'der Kaffee', gloss: 'coffee' },
          { lemma: 'das Wetter', gloss: 'weather' },
        ],
      },
    ]);

    const spec = await resolveExamSpec('cur1', 'B1');
    expect(spec.grammarPoints.sort()).toEqual(['akkusativ', 'perfekt']);
    expect(spec.targetVocab).toHaveLength(2);
    expect(spec.objective).toContain('B1');
    expect(spec.objective).toContain('Can order a meal');
  });

  it('falls back to a generic objective when the level has no lessons', async () => {
    mockLessonFindMany.mockResolvedValue([]);
    const spec = await resolveExamSpec('cur1', 'C1');
    expect(spec.grammarPoints).toEqual([]);
    expect(spec.targetVocab).toEqual([]);
    expect(spec.objective).toContain('C1');
  });
});
