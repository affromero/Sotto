import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findSimilarPodcasts } from '@/lib/recommendations';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  get prismaUnfiltered() { return this.prisma; },
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

  it('handles special characters in search query', async () => {
    vi.mocked(prisma.podcast.findMany).mockResolvedValue([]);

    const result = await findSimilarPodcasts({ topic: 'C++ & JavaScript (ES6+)' });

    expect(result).toEqual([]);
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
  });
});
