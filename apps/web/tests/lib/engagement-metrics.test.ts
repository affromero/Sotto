import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSaveCount = vi.fn();
const mockInteractionCount = vi.fn();
const mockInteractionGroupBy = vi.fn();
const mockPodcastRatingCount = vi.fn();
const mockPodcastFindMany = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    save: { count: (...args: unknown[]) => mockSaveCount(...args) },
    interaction: {
      count: (...args: unknown[]) => mockInteractionCount(...args),
      groupBy: (...args: unknown[]) => mockInteractionGroupBy(...args),
    },
    podcastRating: { count: (...args: unknown[]) => mockPodcastRatingCount(...args) },
    podcast: { findMany: (...args: unknown[]) => mockPodcastFindMany(...args) },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

import {
  getDailyPrivateActivityTrend,
  getInteractionStats,
  getPrivateActivityOverview,
  getTopSaved,
} from '@/lib/engagement-metrics';

describe('engagement-metrics private activity queries', () => {
  const since = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds private activity overview from saves, questions, and ratings', async () => {
    mockSaveCount.mockResolvedValue(12);
    mockInteractionCount.mockResolvedValueOnce(8).mockResolvedValueOnce(6).mockResolvedValueOnce(3);
    mockPodcastRatingCount.mockResolvedValue(4);

    const result = await getPrivateActivityOverview(since);

    expect(result).toEqual({
      saves: 12,
      questions: 8,
      answered: 6,
      incorporated: 3,
      ratings: 4,
    });
    expect(mockSaveCount).toHaveBeenCalledWith({ where: { createdAt: { gte: since } } });
    expect(mockInteractionCount).toHaveBeenCalledWith({
      where: {
        createdAt: { gte: since },
        status: { in: ['ANSWERED', 'INCORPORATED', 'RESOLVED'] },
      },
    });
    expect(mockInteractionCount).toHaveBeenCalledWith({
      where: { createdAt: { gte: since }, incorporated: true },
    });
    expect(mockPodcastRatingCount).toHaveBeenCalledWith({ where: { createdAt: { gte: since } } });
  });

  it('maps daily private activity without reading social tables', async () => {
    mockQueryRaw.mockResolvedValue([
      { day: new Date('2026-01-01T00:00:00.000Z'), saves: 2n, questions: 3n, ratings: 1n },
      { day: new Date('2026-01-02T00:00:00.000Z'), saves: 5n, questions: 1n, ratings: 0n },
    ]);

    const result = await getDailyPrivateActivityTrend(since);
    const sql = (mockQueryRaw.mock.calls[0][0] as TemplateStringsArray).join('');

    expect(result).toEqual([
      { day: '2026-01-01', saves: 2, questions: 3, ratings: 1 },
      { day: '2026-01-02', saves: 5, questions: 1, ratings: 0 },
    ]);
    expect(sql).toContain('"Save"');
    expect(sql).toContain('"Interaction"');
    expect(sql).toContain('"PodcastRating"');
    expect(sql).not.toContain('"Like"');
    expect(sql).not.toContain('"Comment"');
    expect(sql).not.toContain('"Follow"');
    expect(sql).not.toContain('forkedFromId');
  });

  it('returns top saved podcasts using saveCount only', async () => {
    mockPodcastFindMany.mockResolvedValue([
      { id: 'pod-1', title: 'Daily Brief', saveCount: 9, user: { name: 'Ada', handle: 'ada' } },
      { id: 'pod-2', title: null, saveCount: 4, user: { name: null, handle: null } },
    ]);

    const result = await getTopSaved(2);

    expect(mockPodcastFindMany).toHaveBeenCalledWith({
      where: { deletedAt: null, saveCount: { gt: 0 } },
      orderBy: { saveCount: 'desc' },
      take: 2,
      select: {
        id: true,
        title: true,
        saveCount: true,
        user: { select: { name: true, handle: true } },
      },
    });
    expect(result).toEqual([
      { id: 'pod-1', title: 'Daily Brief', ownerName: 'Ada', ownerHandle: 'ada', count: 9 },
      { id: 'pod-2', title: null, ownerName: null, ownerHandle: null, count: 4 },
    ]);
  });

  it('computes private question rates from interaction status and helpfulness', async () => {
    mockInteractionCount.mockResolvedValue(10);
    mockInteractionGroupBy
      .mockResolvedValueOnce([
        { status: 'ANSWERED', _count: 4 },
        { status: 'INCORPORATED', _count: 2 },
        { status: 'PENDING', _count: 4 },
      ])
      .mockResolvedValueOnce([
        { helpful: true, _count: 5 },
        { helpful: false, _count: 1 },
      ]);

    const result = await getInteractionStats(since);

    expect(result).toEqual({
      totalQuestions: 10,
      answeredCount: 6,
      incorporatedCount: 2,
      helpfulCount: 5,
      unhelpfulCount: 1,
    });
  });
});
