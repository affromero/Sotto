import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPodcastFindMany = vi.fn();
const mockPlaybackSessionCount = vi.fn();
const mockPlaybackSessionAggregate = vi.fn();
const mockSaveCount = vi.fn();
const mockInteractionCount = vi.fn();
const mockInteractionGroupBy = vi.fn();
const mockPodcastRatingCount = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: { findMany: (...args: unknown[]) => mockPodcastFindMany(...args) },
    playbackSession: {
      count: (...args: unknown[]) => mockPlaybackSessionCount(...args),
      aggregate: (...args: unknown[]) => mockPlaybackSessionAggregate(...args),
    },
    save: { count: (...args: unknown[]) => mockSaveCount(...args) },
    interaction: {
      count: (...args: unknown[]) => mockInteractionCount(...args),
      groupBy: (...args: unknown[]) => mockInteractionGroupBy(...args),
    },
    podcastRating: { count: (...args: unknown[]) => mockPodcastRatingCount(...args) },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

import { getCreatorPrivateActivity, getCreatorTopPodcasts } from '@/lib/creator-metrics';

describe('creator metrics private analytics', () => {
  const since = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps top podcasts with saves and private questions', async () => {
    mockPodcastFindMany.mockResolvedValue([
      { id: 'pod-1', title: 'Morning Brief', playCount: 120, saveCount: 8 },
      { id: 'pod-2', title: null, playCount: 40, saveCount: 2 },
    ]);
    mockQueryRaw.mockResolvedValue([{ podcastId: 'pod-1', avgCompletion: 77 }]);
    mockInteractionGroupBy.mockResolvedValue([{ podcastId: 'pod-1', _count: { id: 5 } }]);

    const result = await getCreatorTopPodcasts('user-1', since, 2);

    expect(mockPodcastFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null },
      orderBy: { playCount: 'desc' },
      take: 2,
      select: {
        id: true,
        title: true,
        playCount: true,
        saveCount: true,
      },
    });
    expect(mockInteractionGroupBy).toHaveBeenCalledWith({
      by: ['podcastId'],
      where: { podcastId: { in: ['pod-1', 'pod-2'] }, createdAt: { gte: since } },
      _count: { id: true },
    });
    expect(result).toEqual([
      {
        id: 'pod-1',
        title: 'Morning Brief',
        plays: 120,
        completionPercent: 77,
        saves: 8,
        questions: 5,
      },
      {
        id: 'pod-2',
        title: null,
        plays: 40,
        completionPercent: 0,
        saves: 2,
        questions: 0,
      },
    ]);
  });

  it('counts creator private activity without social tables', async () => {
    mockPodcastFindMany.mockResolvedValue([{ id: 'pod-1' }, { id: 'pod-2' }]);
    mockSaveCount.mockResolvedValue(9);
    mockInteractionCount.mockResolvedValueOnce(7).mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    mockPodcastRatingCount.mockResolvedValue(3);

    const result = await getCreatorPrivateActivity('user-1', since);

    expect(mockSaveCount).toHaveBeenCalledWith({
      where: { podcastId: { in: ['pod-1', 'pod-2'] }, createdAt: { gte: since } },
    });
    expect(mockInteractionCount).toHaveBeenCalledWith({
      where: {
        podcastId: { in: ['pod-1', 'pod-2'] },
        createdAt: { gte: since },
        status: { in: ['ANSWERED', 'INCORPORATED', 'RESOLVED'] },
      },
    });
    expect(mockPodcastRatingCount).toHaveBeenCalledWith({
      where: { podcastId: { in: ['pod-1', 'pod-2'] }, createdAt: { gte: since } },
    });
    expect(result).toEqual({
      saves: 9,
      questions: 7,
      answered: 4,
      incorporated: 2,
      ratings: 3,
    });
  });

  it('returns zero private activity when the creator has no podcasts', async () => {
    mockPodcastFindMany.mockResolvedValue([]);

    const result = await getCreatorPrivateActivity('user-empty', since);

    expect(result).toEqual({ saves: 0, questions: 0, answered: 0, incorporated: 0, ratings: 0 });
    expect(mockSaveCount).not.toHaveBeenCalled();
    expect(mockInteractionCount).not.toHaveBeenCalled();
    expect(mockPodcastRatingCount).not.toHaveBeenCalled();
  });
});
