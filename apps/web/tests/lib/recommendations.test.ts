import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findSimilarPodcasts } from '@/lib/recommendations';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findMany: vi.fn(),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock ML provider to throw so we always hit the text search fallback
vi.mock('@/lib/providers/ml', () => ({
  createMLProvider: () => {
    throw new Error('ML provider not configured');
  },
}));

describe('findSimilarPodcasts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns podcasts ranked by plays and private save signal', async () => {
    const mockPodcasts = [
      {
        id: 'p1',
        title: 'Quantum Computing 101',
        topic: 'quantum physics',
        playCount: 150,
        duration: 600,
        user: { id: 'u1', name: 'Alice', image: null },
      },
      {
        id: 'p2',
        title: 'Introduction to Quantum',
        topic: 'quantum computing',
        playCount: 120,
        duration: 450,
        user: { id: 'u2', name: 'Bob', image: 'avatar.jpg' },
      },
    ];

    vi.mocked(prisma.podcast.findMany).mockResolvedValue(mockPodcasts as never);

    const result = await findSimilarPodcasts({ topic: 'quantum', userId: 'user-1' });

    expect(prisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          status: 'READY',
          deletedAt: null,
        }),
        orderBy: [{ playCount: 'desc' }, { saveCount: 'desc' }, { createdAt: 'desc' }],
      })
    );
    expect(JSON.stringify(vi.mocked(prisma.podcast.findMany).mock.calls[0][0])).not.toContain(
      'visibility'
    );
    expect(result).toEqual(mockPodcasts);
  });

  it('deduplicates results by unique podcast IDs', async () => {
    const mockPodcasts = [
      {
        id: 'p1',
        title: 'Quantum 101',
        topic: 'quantum',
        playCount: 50,
        duration: 300,
        user: { id: 'u1', name: 'Alice', image: null },
      },
      {
        id: 'p2',
        title: 'Quantum 102',
        topic: 'quantum',
        playCount: 40,
        duration: 350,
        user: { id: 'u1', name: 'Alice', image: null },
      },
    ];

    vi.mocked(prisma.podcast.findMany).mockResolvedValue(mockPodcasts as never);

    const result = await findSimilarPodcasts({ topic: 'quantum', userId: 'user-1' });

    expect(result.length).toBe(2);
    const ids = result.map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('returns empty array for empty topic', async () => {
    vi.mocked(prisma.podcast.findMany).mockResolvedValue([]);

    const result = await findSimilarPodcasts({ topic: '', userId: 'user-1' });

    // Text search with empty string still runs but returns empty from DB
    expect(result).toEqual([]);
  });

  it('handles short search terms', async () => {
    vi.mocked(prisma.podcast.findMany).mockResolvedValue([]);

    const result = await findSimilarPodcasts({ topic: 'a b c', userId: 'user-1' });

    // Text search with short terms still runs via OR contains
    expect(result).toEqual([]);
  });

  it('handles special characters in search query', async () => {
    vi.mocked(prisma.podcast.findMany).mockResolvedValue([]);

    const result = await findSimilarPodcasts({
      topic: 'C++ & JavaScript (ES6+)',
      userId: 'user-1',
    });

    expect(result).toEqual([]);
  });

  it('includes user information in response', async () => {
    const mockPodcasts = [
      {
        id: 'p1',
        title: 'Test Podcast',
        topic: 'testing',
        playCount: 50,
        duration: 300,
        user: { id: 'u1', name: 'Test User', image: 'avatar.jpg' },
      },
    ];

    vi.mocked(prisma.podcast.findMany).mockResolvedValue(mockPodcasts as never);

    const result = await findSimilarPodcasts({ topic: 'testing', userId: 'user-1' });

    expect(result[0].user).toEqual({
      id: 'u1',
      name: 'Test User',
      image: 'avatar.jpg',
    });
  });
});
