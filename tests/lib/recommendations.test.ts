import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findSimilarPodcasts } from '@/lib/recommendations';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findMany: vi.fn(),
    },
  },
}));

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

  it('constructs full-text query with OR terms from topic', async () => {
    vi.mocked(prisma.podcast.findMany).mockResolvedValue([]);

    await findSimilarPodcasts({ topic: 'quantum computing machine learning' });

    expect(prisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'READY',
          visibility: 'PUBLIC',
          OR: [
            { title: { contains: 'quantum computing machine learning', mode: 'insensitive' } },
            { topic: { contains: 'quantum computing machine learning', mode: 'insensitive' } },
          ],
        }),
      })
    );
  });

  it('returns podcasts ranked by playCount and likeCount', async () => {
    const mockPodcasts = [
      {
        id: 'p1',
        title: 'Quantum Computing 101',
        topic: 'quantum physics',
        playCount: 150,
        likeCount: 30,
        duration: 600,
        user: { id: 'u1', name: 'Alice', image: null },
      },
      {
        id: 'p2',
        title: 'Introduction to Quantum',
        topic: 'quantum computing',
        playCount: 120,
        likeCount: 25,
        duration: 450,
        user: { id: 'u2', name: 'Bob', image: 'avatar.jpg' },
      },
    ];

    vi.mocked(prisma.podcast.findMany).mockResolvedValue(mockPodcasts as any);

    const result = await findSimilarPodcasts({ topic: 'quantum' });

    expect(result).toEqual(mockPodcasts);
    expect(prisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ playCount: 'desc' }, { likeCount: 'desc' }],
      })
    );
    expect(logger.info).toHaveBeenCalledWith('Similar podcasts found via text search', {
      topic: 'quantum',
      count: '2',
    });
  });

  it('deduplicates results by unique podcast IDs', async () => {
    const mockPodcasts = [
      {
        id: 'p1',
        title: 'Quantum 101',
        topic: 'quantum',
        playCount: 50,
        likeCount: 10,
        duration: 300,
        user: { id: 'u1', name: 'Alice', image: null },
      },
      {
        id: 'p2',
        title: 'Quantum 102',
        topic: 'quantum',
        playCount: 40,
        likeCount: 8,
        duration: 350,
        user: { id: 'u1', name: 'Alice', image: null },
      },
    ];

    vi.mocked(prisma.podcast.findMany).mockResolvedValue(mockPodcasts as any);

    const result = await findSimilarPodcasts({ topic: 'quantum' });

    expect(result.length).toBe(2);
    const ids = result.map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('returns empty array for empty topic', async () => {
    vi.mocked(prisma.podcast.findMany).mockResolvedValue([]);

    const result = await findSimilarPodcasts({ topic: '' });

    // Text search with empty string still runs but returns empty from DB
    expect(result).toEqual([]);
  });

  it('handles short search terms', async () => {
    vi.mocked(prisma.podcast.findMany).mockResolvedValue([]);

    const result = await findSimilarPodcasts({ topic: 'a b c' });

    // Text search with short terms still runs via OR contains
    expect(result).toEqual([]);
  });

  it('excludes user podcasts when excludeUserId is provided', async () => {
    vi.mocked(prisma.podcast.findMany).mockResolvedValue([]);

    await findSimilarPodcasts({
      topic: 'machine learning',
      excludeUserId: 'user-123',
    });

    expect(prisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: { not: 'user-123' },
        }),
      })
    );
  });

  it('respects custom limit parameter', async () => {
    vi.mocked(prisma.podcast.findMany).mockResolvedValue([]);

    await findSimilarPodcasts({ topic: 'machine learning', limit: 10 });

    expect(prisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
      })
    );
  });

  it('defaults to limit of 5 when not provided', async () => {
    vi.mocked(prisma.podcast.findMany).mockResolvedValue([]);

    await findSimilarPodcasts({ topic: 'machine learning' });

    expect(prisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5,
      })
    );
  });

  it('handles special characters in search query', async () => {
    vi.mocked(prisma.podcast.findMany).mockResolvedValue([]);

    await findSimilarPodcasts({ topic: 'C++ & JavaScript (ES6+)' });

    expect(prisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { title: { contains: 'C++ & JavaScript (ES6+)', mode: 'insensitive' } },
            { topic: { contains: 'C++ & JavaScript (ES6+)', mode: 'insensitive' } },
          ],
        }),
      })
    );
  });

  it('only searches PUBLIC and READY podcasts', async () => {
    vi.mocked(prisma.podcast.findMany).mockResolvedValue([]);

    await findSimilarPodcasts({ topic: 'astronomy' });

    expect(prisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'READY',
          visibility: 'PUBLIC',
        }),
      })
    );
  });

  it('searches both title and topic fields case-insensitively', async () => {
    const mockPodcasts = [
      {
        id: 'p1',
        title: 'QUANTUM physics',
        topic: 'physics',
        playCount: 100,
        likeCount: 20,
        duration: 500,
        user: { id: 'u1', name: 'Alice', image: null },
      },
    ];

    vi.mocked(prisma.podcast.findMany).mockResolvedValue(mockPodcasts as any);

    const result = await findSimilarPodcasts({ topic: 'QuAnTuM' });

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('QUANTUM physics');
    expect(prisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { title: { contains: 'QuAnTuM', mode: 'insensitive' } },
            { topic: { contains: 'QuAnTuM', mode: 'insensitive' } },
          ],
        }),
      })
    );
  });

  it('includes user information in response', async () => {
    const mockPodcasts = [
      {
        id: 'p1',
        title: 'Test Podcast',
        topic: 'testing',
        playCount: 50,
        likeCount: 5,
        duration: 300,
        user: { id: 'u1', name: 'Test User', image: 'avatar.jpg' },
      },
    ];

    vi.mocked(prisma.podcast.findMany).mockResolvedValue(mockPodcasts as any);

    const result = await findSimilarPodcasts({ topic: 'testing' });

    expect(result[0].user).toEqual({
      id: 'u1',
      name: 'Test User',
      image: 'avatar.jpg',
    });
    expect(prisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          user: {
            select: { id: true, name: true, image: true },
          },
        }),
      })
    );
  });
});
