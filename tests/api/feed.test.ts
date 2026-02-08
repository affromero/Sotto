import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock prisma before importing route
vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    podcast: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

import { GET } from '@/app/api/feed/route';
import { prisma } from '@/lib/prisma';

const mockPrisma = vi.mocked(prisma);

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
    expect(podcast.user).toEqual({ id: 'user-1', name: 'Alice', image: 'https://example.com/alice.jpg' });
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

    expect(mockPrisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      })
    );
  });

  it('respects pagination with page and limit parameters', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([mockPodcast2]);
    mockPrisma.podcast.count.mockResolvedValue(25);

    const request = createRequest({ page: '2', limit: '10' });
    const response = await GET(request);
    const body = await response.json();

    expect(body.page).toBe(2);
    expect(body.limit).toBe(10);

    expect(mockPrisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
      })
    );
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
    mockPrisma.podcast.findMany.mockResolvedValue([mockPodcast]);
    mockPrisma.podcast.count.mockResolvedValue(1);

    const request = createRequest({ search: 'quantum' });
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockPrisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'READY',
          visibility: 'PUBLIC',
          OR: [
            { title: { contains: 'quantum', mode: 'insensitive' } },
            { topic: { contains: 'quantum', mode: 'insensitive' } },
          ],
        }),
      })
    );
  });

  it('filters by tag slug', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([mockPodcast]);
    mockPrisma.podcast.count.mockResolvedValue(1);

    const request = createRequest({ tag: 'science' });
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockPrisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tags: { some: { tag: { slug: 'science' } } },
        }),
      })
    );
  });

  it('sorts by recent (createdAt desc) by default', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([]);
    mockPrisma.podcast.count.mockResolvedValue(0);

    const request = createRequest({ sort: 'recent' });
    await GET(request);

    expect(mockPrisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      })
    );
  });

  it('sorts by popular (playCount desc)', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([]);
    mockPrisma.podcast.count.mockResolvedValue(0);

    const request = createRequest({ sort: 'popular' });
    await GET(request);

    expect(mockPrisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { playCount: 'desc' },
      })
    );
  });

  it('sorts by trending (likeCount desc)', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([]);
    mockPrisma.podcast.count.mockResolvedValue(0);

    const request = createRequest({ sort: 'trending' });
    await GET(request);

    expect(mockPrisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { likeCount: 'desc' },
      })
    );
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

  it('always filters to READY status and PUBLIC visibility', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([]);
    mockPrisma.podcast.count.mockResolvedValue(0);

    const request = createRequest();
    await GET(request);

    expect(mockPrisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'READY',
          visibility: 'PUBLIC',
        }),
      })
    );
  });

  it('includes user select with id, name, and image', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([]);
    mockPrisma.podcast.count.mockResolvedValue(0);

    const request = createRequest();
    await GET(request);

    expect(mockPrisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          user: { select: { id: true, name: true, image: true } },
          tags: { include: { tag: true } },
        }),
      })
    );
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
    mockPrisma.podcast.findMany.mockResolvedValue([mockPodcast]);
    mockPrisma.podcast.count.mockResolvedValue(1);

    const request = createRequest({ search: 'quantum', tag: 'science' });
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockPrisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'READY',
          visibility: 'PUBLIC',
          OR: [
            { title: { contains: 'quantum', mode: 'insensitive' } },
            { topic: { contains: 'quantum', mode: 'insensitive' } },
          ],
          tags: { some: { tag: { slug: 'science' } } },
        }),
      })
    );
  });

  it('uses count with same where clause as findMany', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([]);
    mockPrisma.podcast.count.mockResolvedValue(0);

    const request = createRequest({ search: 'test', tag: 'tech' });
    await GET(request);

    const findManyCall = mockPrisma.podcast.findMany.mock.calls[0][0];
    const countCall = mockPrisma.podcast.count.mock.calls[0][0];

    expect(countCall).toEqual({ where: findManyCall?.where });
  });

  it('calculates skip correctly for page 3 with limit 5', async () => {
    mockPrisma.podcast.findMany.mockResolvedValue([]);
    mockPrisma.podcast.count.mockResolvedValue(0);

    const request = createRequest({ page: '3', limit: '5' });
    await GET(request);

    expect(mockPrisma.podcast.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 5,
      })
    );
  });
});
