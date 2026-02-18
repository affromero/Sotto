import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock fns at module scope so they're properly typed as Mock
const mockPodcastFindMany = vi.fn();
const mockPodcastCount = vi.fn();
const mockFollowFindMany = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findMany: (...args: unknown[]) => mockPodcastFindMany(...args),
      count: (...args: unknown[]) => mockPodcastCount(...args),
    },
    follow: {
      findMany: (...args: unknown[]) => mockFollowFindMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/recommendation-engine', () => ({
  searchPodcasts: vi.fn().mockResolvedValue([]),
  getTrending: vi.fn().mockResolvedValue([]),
}));

import { GET } from '@/app/api/feed/route';

const mockPrisma = {
  podcast: {
    findMany: mockPodcastFindMany,
    count: mockPodcastCount,
  },
};

function createRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/feed');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

const mockPodcast = {
  id: 'pod-1',
  userId: 'user-1',
  title: 'Quantum Physics 101',
  topic: 'An introduction to quantum mechanics',
  status: 'READY',
  visibility: 'PUBLIC',
  audioUrl: 'https://r2.example.com/audio/pod-1.mp3',
  duration: 600,
  fileSize: 1024000,
  playCount: 42,
  likeCount: 10,
  forkCount: 2,
  saveCount: 5,
  forkedFromId: null,
  createdAt: new Date('2025-01-15T10:00:00Z'),
  updatedAt: new Date('2025-01-15T10:00:00Z'),
  user: { id: 'user-1', name: 'Alice', image: 'https://example.com/alice.jpg' },
  tags: [
    {
      id: 'pt-1',
      podcastId: 'pod-1',
      tagId: 'tag-1',
      tag: { id: 'tag-1', name: 'Science', slug: 'science' },
    },
  ],
};

const mockPodcast2 = {
  id: 'pod-2',
  userId: 'user-2',
  title: 'Machine Learning Basics',
  topic: 'Deep dive into ML algorithms',
  status: 'READY',
  visibility: 'PUBLIC',
  audioUrl: 'https://r2.example.com/audio/pod-2.mp3',
  duration: 900,
  fileSize: 2048000,
  playCount: 100,
  likeCount: 25,
  forkCount: 5,
  saveCount: 12,
  forkedFromId: null,
  createdAt: new Date('2025-01-16T10:00:00Z'),
  updatedAt: new Date('2025-01-16T10:00:00Z'),
  user: { id: 'user-2', name: 'Bob', image: null },
  tags: [
    {
      id: 'pt-2',
      podcastId: 'pod-2',
      tagId: 'tag-2',
      tag: { id: 'tag-2', name: 'Technology', slug: 'technology' },
    },
  ],
};

describe('GET /api/feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns podcasts with correct response shape', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([mockPodcast]);
    mockPrisma.podcast.count.mockResolvedValue(1);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('podcasts');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('page');
    expect(body).toHaveProperty('limit');
    expect(body).toHaveProperty('hasMore');
    expect(Array.isArray(body.podcasts)).toBe(true);
  });

  it('returns podcast data with user and tags included', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([mockPodcast]);
    mockPrisma.podcast.count.mockResolvedValue(1);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    const podcast = body.podcasts[0];
    expect(podcast.id).toBe('pod-1');
    expect(podcast.title).toBe('Quantum Physics 101');
    expect(podcast.user).toEqual({
      id: 'user-1',
      name: 'Alice',
      image: 'https://example.com/alice.jpg',
    });
    expect(podcast.tags).toHaveLength(1);
    expect(podcast.tags[0].tag.slug).toBe('science');
  });

  it('applies default parameters (page=1, limit=20, sort=recent)', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([]);
    mockPrisma.podcast.count.mockResolvedValue(0);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
  });

  it('respects pagination with page and limit parameters', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([mockPodcast2]);
    mockPrisma.podcast.count.mockResolvedValue(25);

    const request = createRequest({ page: '2', limit: '10' });
    const response = await GET(request);
    const body = await response.json();

    expect(body.page).toBe(2);
    expect(body.limit).toBe(10);
  });

  it('calculates hasMore correctly when more results exist', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([mockPodcast]);
    mockPrisma.podcast.count.mockResolvedValue(25);

    const request = createRequest({ page: '1', limit: '10' });
    const response = await GET(request);
    const body = await response.json();

    expect(body.hasMore).toBe(true);
    expect(body.total).toBe(25);
  });

  it('calculates hasMore correctly when no more results', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([mockPodcast]);
    mockPrisma.podcast.count.mockResolvedValue(1);

    const request = createRequest({ page: '1', limit: '20' });
    const response = await GET(request);
    const body = await response.json();

    expect(body.hasMore).toBe(false);
  });

  it('filters by search query on title and topic', async () => {
    // TODO: needs integration test for real filtering — the mock returns data
    // regardless of the search query, so this only verifies the endpoint accepts
    // a search parameter without error.
    mockPrisma.podcast.findMany.mockResolvedValue([mockPodcast]);
    mockPrisma.podcast.count.mockResolvedValue(1);

    const request = createRequest({ search: 'quantum' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.podcasts).toHaveLength(1);
  });

  it('filters by tag slug', async () => {
    // TODO: needs integration test for real filtering — the mock returns data
    // regardless of the tag parameter, so this only verifies the endpoint accepts
    // a tag parameter without error.
    mockPrisma.podcast.findMany.mockResolvedValue([mockPodcast]);
    mockPrisma.podcast.count.mockResolvedValue(1);

    const request = createRequest({ tag: 'science' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.podcasts).toHaveLength(1);
  });

  it.each(['recent', 'popular', 'trending'])('accepts %s sort parameter', async (sort) => {
    // NOTE: The mock returns the same data regardless of sort order, so these
    // tests only verify the endpoint accepts each sort value without error.
    // Real sort ordering needs integration tests.
    mockPrisma.podcast.findMany.mockResolvedValue([]);
    mockPrisma.podcast.count.mockResolvedValue(0);

    const request = createRequest({ sort });
    const response = await GET(request);

    expect(response.status).toBe(200);
  });

  it('returns empty podcast list when no results', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([]);
    mockPrisma.podcast.count.mockResolvedValue(0);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.podcasts).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.hasMore).toBe(false);
  });


  it('returns 400 for invalid page parameter (0)', async () => {
    const request = createRequest({ page: '0' });
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for invalid limit parameter (exceeds 50)', async () => {
    const request = createRequest({ limit: '51' });
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for invalid sort parameter', async () => {
    const request = createRequest({ sort: 'alphabetical' });
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for search string exceeding 200 characters', async () => {
    const request = createRequest({ search: 'a'.repeat(201) });
    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('returns multiple podcasts', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([mockPodcast, mockPodcast2]);
    mockPrisma.podcast.count.mockResolvedValue(2);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.podcasts).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('handles combined search and tag filter', async () => {
    // TODO: needs integration test for real filtering — the mock returns data
    // regardless of search + tag combination.
    mockPrisma.podcast.findMany.mockResolvedValue([mockPodcast]);
    mockPrisma.podcast.count.mockResolvedValue(1);

    const request = createRequest({ search: 'quantum', tag: 'science' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.podcasts).toHaveLength(1);
  });
});
