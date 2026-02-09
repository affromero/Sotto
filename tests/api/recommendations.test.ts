import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock fns at module scope so they're properly typed as Mock
const mockPodcastFindUnique = vi.fn();
const mockFindSimilarPodcasts = vi.fn();
const mockAuth = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
  },
}));

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
  likeCount: 30,
  duration: 720,
  user: { id: 'user-2', name: 'Bob', image: 'https://example.com/bob.jpg' },
};

const mockRecommendation2 = {
  id: 'pod-rec-2',
  title: 'Introduction to Quantum Computing',
  topic: 'Quantum computing basics',
  playCount: 90,
  likeCount: 18,
  duration: 600,
  user: { id: 'user-3', name: 'Charlie', image: null },
};

const mockRecommendation3 = {
  id: 'pod-rec-3',
  title: 'Quantum Theory Explained',
  topic: 'Understanding quantum mechanics',
  playCount: 200,
  likeCount: 45,
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
    expect(body.error).toBe('Either podcastId or topic query parameter is required');
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

  it('calls findSimilarPodcasts with topic from query param', async () => {
    mockAuth.mockResolvedValue(null);
    mockFindSimilarPodcasts.mockResolvedValue([]);

    const request = createRequest({ topic: 'machine learning' });
    await GET(request);

    expect(mockFindSimilarPodcasts).toHaveBeenCalledWith({
      topic: 'machine learning',
      excludeUserId: undefined,
      limit: 10,
    });
  });

  it('calls findSimilarPodcasts with topic from podcast when podcastId provided', async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.podcast.findUnique.mockResolvedValue(mockPodcast);
    mockFindSimilarPodcasts.mockResolvedValue([]);

    const request = createRequest({ podcastId: 'pod-1' });
    await GET(request);

    expect(mockFindSimilarPodcasts).toHaveBeenCalledWith({
      topic: 'quantum physics introduction',
      excludeUserId: undefined,
      limit: 10,
    });
  });

  it('uses podcast title as fallback when podcast has no topic', async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.podcast.findUnique.mockResolvedValue({
      id: 'pod-2',
      topic: null,
      title: 'Machine Learning Basics',
    });
    mockFindSimilarPodcasts.mockResolvedValue([]);

    const request = createRequest({ podcastId: 'pod-2' });
    await GET(request);

    expect(mockFindSimilarPodcasts).toHaveBeenCalledWith({
      topic: 'Machine Learning Basics',
      excludeUserId: undefined,
      limit: 10,
    });
  });

  it('excludes authenticated user from recommendations', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockFindSimilarPodcasts.mockResolvedValue([]);

    const request = createRequest({ topic: 'quantum physics' });
    await GET(request);

    expect(mockFindSimilarPodcasts).toHaveBeenCalledWith({
      topic: 'quantum physics',
      excludeUserId: 'user-1',
      limit: 10,
    });
  });

  it('does not exclude user when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);
    mockFindSimilarPodcasts.mockResolvedValue([]);

    const request = createRequest({ topic: 'quantum physics' });
    await GET(request);

    expect(mockFindSimilarPodcasts).toHaveBeenCalledWith({
      topic: 'quantum physics',
      excludeUserId: undefined,
      limit: 10,
    });
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

  it('returns recommendations with correct shape including user data', async () => {
    mockAuth.mockResolvedValue(null);
    mockFindSimilarPodcasts.mockResolvedValue([mockRecommendation1]);

    const request = createRequest({ topic: 'quantum' });
    const response = await GET(request);
    const body = await response.json();

    const rec = body[0];
    expect(rec).toHaveProperty('id');
    expect(rec).toHaveProperty('title');
    expect(rec).toHaveProperty('topic');
    expect(rec).toHaveProperty('playCount');
    expect(rec).toHaveProperty('likeCount');
    expect(rec).toHaveProperty('duration');
    expect(rec).toHaveProperty('user');
    expect(rec.user).toHaveProperty('id');
    expect(rec.user).toHaveProperty('name');
    expect(rec.user).toHaveProperty('image');
  });

  it('prioritizes podcastId over topic when both are provided', async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.podcast.findUnique.mockResolvedValue(mockPodcast);
    mockFindSimilarPodcasts.mockResolvedValue([]);

    const request = createRequest({ podcastId: 'pod-1', topic: 'machine learning' });
    await GET(request);

    expect(mockFindSimilarPodcasts).toHaveBeenCalledWith({
      topic: 'quantum physics introduction',
      excludeUserId: undefined,
      limit: 10,
    });
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

  it('calls prisma.podcast.findUnique with correct select fields', async () => {
    mockAuth.mockResolvedValue(null);
    mockPrisma.podcast.findUnique.mockResolvedValue(mockPodcast);
    mockFindSimilarPodcasts.mockResolvedValue([]);

    const request = createRequest({ podcastId: 'pod-1' });
    await GET(request);

    expect(mockPrisma.podcast.findUnique).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      select: { topic: true, title: true },
    });
  });

  it('handles session with missing user gracefully', async () => {
    mockAuth.mockResolvedValue({ user: null });
    mockFindSimilarPodcasts.mockResolvedValue([]);

    const request = createRequest({ topic: 'quantum' });
    await GET(request);

    expect(mockFindSimilarPodcasts).toHaveBeenCalledWith({
      topic: 'quantum',
      excludeUserId: undefined,
      limit: 10,
    });
  });
});
