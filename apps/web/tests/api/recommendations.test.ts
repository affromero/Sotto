import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock fns at module scope so they're properly typed as Mock
const mockPodcastFindUnique = vi.fn();
const mockFindSimilarPodcasts = vi.fn();
const mockAuth = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/recommendations', () => ({
  findSimilarPodcasts: (...args: unknown[]) => mockFindSimilarPodcasts(...args),
}));

vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { GET } from '@/app/api/recommendations/route';

const mockPrisma = {
  podcast: {
    findUnique: mockPodcastFindUnique,
  },
};

function createRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/recommendations');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

const mockRecommendation1 = {
  id: 'pod-rec-1',
  title: 'Quantum Mechanics Deep Dive',
  topic: 'Advanced quantum physics concepts',
  playCount: 150,
  duration: 720,
  user: { id: 'user-2', name: 'Bob', image: 'https://example.com/bob.jpg' },
};

const mockRecommendation2 = {
  id: 'pod-rec-2',
  title: 'Introduction to Quantum Computing',
  topic: 'Quantum computing basics',
  playCount: 90,
  duration: 600,
  user: { id: 'user-3', name: 'Charlie', image: null },
};

const mockRecommendation3 = {
  id: 'pod-rec-3',
  title: 'Quantum Theory Explained',
  topic: 'Understanding quantum mechanics',
  playCount: 200,
  duration: 900,
  user: { id: 'user-4', name: 'Diana', image: 'https://example.com/diana.jpg' },
};

const mockPodcast = {
  id: 'pod-1',
  topic: 'quantum physics introduction',
  title: 'Quantum Physics 101',
};

describe('GET /api/recommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when both podcastId and topic are missing', async () => {
    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('podcastId');
  });

  it('returns recommendations when topic is provided', async () => {
    mockAuth.mockResolvedValue(null);
    mockFindSimilarPodcasts.mockResolvedValue([mockRecommendation1, mockRecommendation2]);

    const request = createRequest({ topic: 'quantum physics' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual(mockRecommendation1);
    expect(body[1]).toEqual(mockRecommendation2);
  });

  it('returns recommendations when podcastId is provided and podcast exists', async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.podcast.findUnique.mockResolvedValue(mockPodcast);
    mockFindSimilarPodcasts.mockResolvedValue([mockRecommendation1]);

    const request = createRequest({ podcastId: 'pod-1' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual(mockRecommendation1);
  });

  it('returns 404 when podcastId is provided but podcast not found', async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.podcast.findUnique.mockResolvedValue(null);

    const request = createRequest({ podcastId: 'nonexistent' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Podcast not found');
  });

  it('returns empty array when no recommendations found', async () => {
    mockAuth.mockResolvedValue(null);
    mockFindSimilarPodcasts.mockResolvedValue([]);

    const request = createRequest({ topic: 'very specific niche topic' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([]);
  });

  it('returns multiple recommendations ordered by findSimilarPodcasts result', async () => {
    mockAuth.mockResolvedValue(null);
    mockFindSimilarPodcasts.mockResolvedValue([
      mockRecommendation3,
      mockRecommendation1,
      mockRecommendation2,
    ]);

    const request = createRequest({ topic: 'quantum' });
    const response = await GET(request);
    const body = await response.json();

    expect(body).toHaveLength(3);
    expect(body[0].id).toBe('pod-rec-3');
    expect(body[1].id).toBe('pod-rec-1');
    expect(body[2].id).toBe('pod-rec-2');
  });
});
