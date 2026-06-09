/**
 * suggestClassTopics: turn the learner's interests into class-topic suggestions,
 * falling back to curiosity starters when there are none.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { userInterest: { findMany: (...a: unknown[]) => mockFindMany(...a) } },
}));

import { suggestClassTopics } from '@/lib/class-topics';

describe('suggestClassTopics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the learner interests (highest weight first) as topics', async () => {
    mockFindMany.mockResolvedValue([{ tag: { name: 'Space' } }, { tag: { name: 'Cooking' } }]);
    const { topics } = await suggestClassTopics('u1');
    expect(topics).toEqual([
      { label: 'Space', query: 'Space' },
      { label: 'Cooking', query: 'Cooking' },
    ]);
    // ordered by weight desc, limited
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' }, orderBy: { weight: 'desc' } }),
    );
  });

  it('falls back to curiosity starters when the learner has no interests', async () => {
    mockFindMany.mockResolvedValue([]);
    const { topics } = await suggestClassTopics('u1');
    expect(topics.length).toBeGreaterThan(0);
    expect(topics.every((t) => t.label && t.query)).toBe(true);
  });

  it('skips interests with a missing tag name', async () => {
    mockFindMany.mockResolvedValue([{ tag: { name: 'History' } }, { tag: null }]);
    const { topics } = await suggestClassTopics('u1');
    expect(topics).toEqual([{ label: 'History', query: 'History' }]);
  });
});
