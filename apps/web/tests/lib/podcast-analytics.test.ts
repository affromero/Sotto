import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPodcastFindUnique = vi.fn();
const mockPlaybackSessionAggregate = vi.fn();
const mockInteractionCount = vi.fn();
const mockPodcastRatingCount = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: { findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args) },
    playbackSession: { aggregate: (...args: unknown[]) => mockPlaybackSessionAggregate(...args) },
    interaction: { count: (...args: unknown[]) => mockInteractionCount(...args) },
    podcastRating: { count: (...args: unknown[]) => mockPodcastRatingCount(...args) },
    podcastFeature: { findUnique: vi.fn() },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

import { getPodcastOverview, getPodcastPrivateActivity } from '@/lib/podcast-analytics';

describe('podcast analytics private metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds overview from playback, saves, and private questions', async () => {
    mockPodcastFindUnique.mockResolvedValue({ playCount: 42, saveCount: 7 });
    mockPlaybackSessionAggregate.mockResolvedValue({
      _sum: { totalListenSeconds: 7200 },
      _avg: { completionPercent: 68 },
    });
    mockQueryRaw.mockResolvedValue([{ count: 11n }]);
    mockInteractionCount.mockResolvedValue(5);

    const result = await getPodcastOverview('pod-1');

    expect(mockPodcastFindUnique).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      select: { playCount: true, saveCount: true },
    });
    expect(result).toEqual({
      plays: 42,
      uniqueListeners: 11,
      avgCompletion: 68,
      listenHours: 2,
      saves: 7,
      questions: 5,
    });
  });

  it('builds private activity without social counters', async () => {
    mockPodcastFindUnique.mockResolvedValue({ saveCount: 9 });
    mockInteractionCount.mockResolvedValueOnce(6).mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    mockPodcastRatingCount.mockResolvedValue(3);

    const result = await getPodcastPrivateActivity('pod-2');

    expect(mockPodcastFindUnique).toHaveBeenCalledWith({
      where: { id: 'pod-2' },
      select: { saveCount: true },
    });
    expect(mockInteractionCount).toHaveBeenCalledWith({
      where: {
        podcastId: 'pod-2',
        status: { in: ['ANSWERED', 'INCORPORATED', 'RESOLVED'] },
      },
    });
    expect(mockInteractionCount).toHaveBeenCalledWith({
      where: { podcastId: 'pod-2', incorporated: true },
    });
    expect(mockPodcastRatingCount).toHaveBeenCalledWith({ where: { podcastId: 'pod-2' } });
    expect(result).toEqual({
      saves: 9,
      questions: 6,
      answered: 4,
      incorporated: 2,
      ratings: 3,
    });
  });
});
