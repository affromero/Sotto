import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockQueryRaw = vi.fn();
const mockPodcastRatingAggregate = vi.fn();
const mockPodcastRatingFindMany = vi.fn();
const mockPodcastRatingCount = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    podcastRating: {
      aggregate: (...args: unknown[]) => mockPodcastRatingAggregate(...args),
      findMany: (...args: unknown[]) => mockPodcastRatingFindMany(...args),
      count: (...args: unknown[]) => mockPodcastRatingCount(...args),
    },
  },
}));

import { GET } from '@/app/api/admin/ratings/route';

function createRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/admin/ratings');
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url);
}

describe('GET /api/admin/ratings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Admin access required' });
  });

  it('returns 400 for invalid range', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });

    const response = await GET(createRequest({ range: 'invalid' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid range' });
  });

  it('returns ratings data with default range', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    const mockByProvider = [{ ttsProvider: 'elevenlabs', ratingCount: 5 }];
    const mockByAi = [{ aiProvider: 'anthropic', aiModel: 'claude', ratingCount: 3 }];
    const mockAverages = {
      _avg: {
        voiceNaturalness: 4.5,
        contentAccuracy: 4.0,
        conversationFlow: 3.8,
        overallSatisfaction: 4.2,
      },
    };
    const mockRecent = [
      {
        id: 'r1',
        voiceNaturalness: 5,
        contentAccuracy: 4,
        conversationFlow: 4,
        overallSatisfaction: 5,
        comment: 'Great',
        createdAt: new Date('2026-01-01'),
        podcast: { id: 'pod-1', title: 'Test', ttsProvider: 'elevenlabs', aiProvider: 'anthropic', aiModel: 'claude' },
      },
    ];

    // $queryRaw is called twice (byProvider, byAi)
    mockQueryRaw
      .mockResolvedValueOnce(mockByProvider)
      .mockResolvedValueOnce(mockByAi);
    mockPodcastRatingAggregate.mockResolvedValue(mockAverages);
    mockPodcastRatingFindMany.mockResolvedValue(mockRecent);
    mockPodcastRatingCount.mockResolvedValue(10);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.range).toBe('30d');
    expect(body.totalCount).toBe(10);
    expect(body.overallAverages).toEqual(mockAverages._avg);
    expect(body.byProvider).toEqual(mockByProvider);
    expect(body.byAi).toEqual(mockByAi);
  });

  it('accepts valid range parameter', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockQueryRaw.mockResolvedValue([]);
    mockPodcastRatingAggregate.mockResolvedValue({ _avg: {} });
    mockPodcastRatingFindMany.mockResolvedValue([]);
    mockPodcastRatingCount.mockResolvedValue(0);

    const response = await GET(createRequest({ range: '7d' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.range).toBe('7d');
  });
});
