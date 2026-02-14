import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPersonalizedTopics,
  getTrendingTopics,
  getCurrentEvents,
  drillDown,
} from '@/lib/inspire-engine';
import { prisma } from '@/lib/prisma';
import { cache } from '@/lib/redis';
import { getTrending } from '@/lib/recommendation-engine';
import { logger } from '@/lib/logger';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userInterest: {
      findMany: vi.fn(),
    },
    tag: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/redis', () => ({
  cache: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('@/lib/recommendation-engine', () => ({
  getTrending: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('getPersonalizedTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns generic topics when user has no interests', async () => {
    vi.mocked(prisma.userInterest.findMany).mockResolvedValue([]);
    vi.mocked(cache.get).mockResolvedValue(null);

    const result = await getPersonalizedTopics('user-123');

    expect(result).toHaveLength(4);
    expect(result[0]).toHaveProperty('title');
    expect(result[0]).toHaveProperty('category');
    expect(result[0]).toHaveProperty('hook');
    expect(result[0].title).toBe('How AI is Changing Creative Work');
    expect(result[0].category).toBe('Technology');
  });

  it('returns cached topics when available', async () => {
    const cachedTopics = [{ title: 'Cached Topic', category: 'Science', hook: 'From cache' }];

    vi.mocked(prisma.userInterest.findMany).mockResolvedValue([
      {
        userId: 'user-123',
        tagId: 'tag-1',
        weight: 1.0,
        tag: { name: 'Physics', slug: 'physics' },
      } as any,
    ]);
    vi.mocked(cache.get).mockResolvedValue(cachedTopics);

    const result = await getPersonalizedTopics('user-123');

    expect(result).toEqual(cachedTopics);
    expect(cache.get).toHaveBeenCalledWith('inspire:foryou:user-123');
  });

  it('returns fallback topics when ANTHROPIC_API_KEY is not set', async () => {
    vi.mocked(prisma.userInterest.findMany).mockResolvedValue([
      {
        userId: 'user-123',
        tagId: 'tag-1',
        weight: 1.0,
        tag: { name: 'Quantum Physics', slug: 'quantum-physics' },
      } as any,
      {
        userId: 'user-123',
        tagId: 'tag-2',
        weight: 0.8,
        tag: { name: 'Machine Learning', slug: 'machine-learning' },
      } as any,
    ]);
    vi.mocked(cache.get).mockResolvedValue(null);

    const result = await getPersonalizedTopics('user-123');

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Deep dive into Quantum Physics');
    expect(result[0].category).toBe('Quantum Physics');
    expect(result[0].hook).toBe('Explore the latest developments in quantum physics');
    expect(result[1].title).toBe('Deep dive into Machine Learning');
    expect(result[1].category).toBe('Machine Learning');
  });

  it('respects weight ordering from user interests', async () => {
    vi.mocked(prisma.userInterest.findMany).mockResolvedValue([
      {
        userId: 'user-123',
        tagId: 'tag-1',
        weight: 0.9,
        tag: { name: 'Topic A', slug: 'topic-a' },
      } as any,
      {
        userId: 'user-123',
        tagId: 'tag-2',
        weight: 0.7,
        tag: { name: 'Topic B', slug: 'topic-b' },
      } as any,
    ]);
    vi.mocked(cache.get).mockResolvedValue(null);

    const result = await getPersonalizedTopics('user-123');

    // Higher-weighted topic should appear first in fallback results
    expect(result[0].category).toBe('Topic A');
    expect(result[1].category).toBe('Topic B');
  });
});

describe('getTrendingTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached trending topics when available', async () => {
    const cachedTopics = [
      { title: 'Trending Topic', category: 'Technology', hook: '1000 listens this week' },
    ];

    vi.mocked(cache.get).mockResolvedValue(cachedTopics);

    const result = await getTrendingTopics();

    expect(result).toEqual(cachedTopics);
    expect(cache.get).toHaveBeenCalledWith('inspire:trending');
    expect(getTrending).not.toHaveBeenCalled();
  });

  it('returns empty array when getTrending throws', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(getTrending).mockRejectedValue(new Error('Database error'));

    const result = await getTrendingTopics();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('Failed to get trending topics', {
      error: 'Database error',
    });
  });

  it('formats trending podcasts into topic suggestions', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(getTrending).mockResolvedValue([
      {
        id: 'p1',
        title: 'Quantum Computing Explained',
        playCount: 500,
        tags: [{ name: 'Science' }],
      } as any,
      {
        id: 'p2',
        title: 'AI Ethics',
        playCount: 400,
        tags: [{ name: 'Technology' }],
      } as any,
    ]);

    const result = await getTrendingTopics();

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Quantum Computing Explained');
    expect(result[0].category).toBe('Science');
    expect(result[0].hook).toBe('500 listens this week');
    expect(result[1].title).toBe('AI Ethics');
    expect(result[1].category).toBe('Technology');
    expect(result[1].hook).toBe('400 listens this week');
  });

  it('uses Trending as fallback category when no tags exist', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(getTrending).mockResolvedValue([
      {
        id: 'p1',
        title: 'No Tags Podcast',
        playCount: 300,
        tags: [],
      } as any,
    ]);

    const result = await getTrendingTopics();

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('Trending');
  });

  it('limits results to first 4 podcasts', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(getTrending).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: `p${i}`,
        title: `Podcast ${i}`,
        playCount: 100 - i,
        tags: [{ name: 'Category' }],
      })) as any
    );

    const result = await getTrendingTopics();

    expect(result).toHaveLength(4);
  });

  it('caches trending topics when successfully retrieved', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(getTrending).mockResolvedValue([
      {
        id: 'p1',
        title: 'Test',
        playCount: 100,
        tags: [{ name: 'Tech' }],
      } as any,
    ]);

    await getTrendingTopics();

    expect(cache.set).toHaveBeenCalledWith('inspire:trending', expect.any(Array), 3600);
  });

  it('does not cache when no trending topics found', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(getTrending).mockResolvedValue([]);

    const result = await getTrendingTopics();

    expect(result).toEqual([]);
    expect(cache.set).not.toHaveBeenCalled();
  });
});

describe('getCurrentEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns generic suggestions when ANTHROPIC_API_KEY is not set', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);

    const result = await getCurrentEvents();

    expect(result).toHaveLength(3);
    expect(result[0]).toHaveProperty('title');
    expect(result[0]).toHaveProperty('category');
    expect(result[0]).toHaveProperty('hook');
    expect(result[0].title).toBe('Latest in Space Exploration');
    expect(result[0].category).toBe('Science');
  });

  it('returns cached events when available', async () => {
    const cachedEvents = [{ title: 'Cached Event', category: 'News', hook: 'Breaking news' }];

    vi.mocked(cache.get).mockResolvedValue(cachedEvents);

    const result = await getCurrentEvents(['Technology']);

    expect(result).toEqual(cachedEvents);
    expect(cache.get).toHaveBeenCalledWith('inspire:news:Technology');
  });

  it('generates cache key from sorted interests', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);

    await getCurrentEvents(['Science', 'Technology', 'Art']);

    expect(cache.get).toHaveBeenCalledWith('inspire:news:Art,Science,Technology');
  });

  it('uses general cache key when no interests provided', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);

    await getCurrentEvents();

    expect(cache.get).toHaveBeenCalledWith('inspire:news:general');
  });

  it('returns generic suggestions for empty interests array', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);

    const result = await getCurrentEvents([]);

    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('Latest in Space Exploration');
  });
});

describe('drillDown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns fallback subtopics when ANTHROPIC_API_KEY is not set', async () => {
    const result = await drillDown('Technology');

    expect(result).toHaveLength(4);
    expect(result[0].title).toBe("Technology: Beginner's Guide");
    expect(result[0].category).toBe('Technology');
    expect(result[0].hook).toBe('Start from the fundamentals');
    expect(result[1].title).toBe('Technology: Latest Breakthroughs');
    expect(result[2].title).toBe('Technology: Controversies');
    expect(result[3].title).toBe('Technology: Future Predictions');
  });

  it('includes category in all fallback subtopics', async () => {
    const result = await drillDown('Quantum Physics');

    expect(result).toHaveLength(4);
    result.forEach((topic) => {
      expect(topic.category).toBe('Quantum Physics');
      expect(topic.title).toContain('Quantum Physics');
    });
  });

  it('generates fallback subtopics without parentTitle', async () => {
    const result = await drillDown('Biology');

    expect(result).toHaveLength(4);
    expect(result[0]).toHaveProperty('title');
    expect(result[0]).toHaveProperty('category');
    expect(result[0]).toHaveProperty('hook');
  });

  it('generates fallback subtopics with parentTitle', async () => {
    const result = await drillDown('Machine Learning', 'Deep Learning Basics');

    expect(result).toHaveLength(4);
    expect(result[0].category).toBe('Machine Learning');
  });

  it('returns fallback with special characters in category', async () => {
    const result = await drillDown('C++ & Low-Level Programming');

    expect(result).toHaveLength(4);
    expect(result[0].title).toBe("C++ & Low-Level Programming: Beginner's Guide");
    expect(result[0].category).toBe('C++ & Low-Level Programming');
  });

  it('returns fallback with very long category name', async () => {
    const longCategory = 'a'.repeat(200);
    const result = await drillDown(longCategory);

    expect(result).toHaveLength(4);
    result.forEach((topic) => {
      expect(topic.category).toBe(longCategory);
    });
  });
});
