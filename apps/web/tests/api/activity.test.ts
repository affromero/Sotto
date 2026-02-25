import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockFollowFindMany = vi.fn();
const mockActivityFindMany = vi.fn();
const mockActivityCount = vi.fn();
const mockPodcastFindMany = vi.fn();
const mockUserFindMany = vi.fn();
const mockCollectionFindMany = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    follow: {
      findMany: (...args: unknown[]) => mockFollowFindMany(...args),
    },
    activity: {
      findMany: (...args: unknown[]) => mockActivityFindMany(...args),
      count: (...args: unknown[]) => mockActivityCount(...args),
    },
    podcast: {
      findMany: (...args: unknown[]) => mockPodcastFindMany(...args),
    },
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
    },
    collection: {
      findMany: (...args: unknown[]) => mockCollectionFindMany(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/activity/route';

function createRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/activity');
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/activity', () => {
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

  it('returns 401 when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 400 for invalid pagination params', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const response = await GET(createRequest({ page: '0' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid query parameters' });
  });

  it('returns empty activities when user follows nobody', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockFollowFindMany.mockResolvedValue([]);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ activities: [], hasMore: false });
  });

  it('returns enriched activities with podcast targets', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockFollowFindMany.mockResolvedValue([{ followingId: 'user-2' }]);

    const now = new Date();
    mockActivityFindMany.mockResolvedValue([
      {
        id: 'act-1',
        type: 'PODCAST_CREATED',
        targetId: 'pod-1',
        targetType: 'podcast',
        metadata: null,
        createdAt: now,
        user: { id: 'user-2', name: 'Jane', handle: 'jane', image: null },
      },
    ]);
    mockActivityCount.mockResolvedValue(1);
    mockPodcastFindMany.mockResolvedValue([{ id: 'pod-1', title: 'Test Podcast' }]);
    mockUserFindMany.mockResolvedValue([]);
    mockCollectionFindMany.mockResolvedValue([]);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.activities).toHaveLength(1);
    expect(body.activities[0].target).toEqual({ id: 'pod-1', title: 'Test Podcast' });
    expect(body.hasMore).toBe(false);
  });

  it('returns enriched activities with user targets', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockFollowFindMany.mockResolvedValue([{ followingId: 'user-2' }]);

    const now = new Date();
    mockActivityFindMany.mockResolvedValue([
      {
        id: 'act-1',
        type: 'USER_FOLLOWED',
        targetId: 'user-3',
        targetType: 'user',
        metadata: null,
        createdAt: now,
        user: { id: 'user-2', name: 'Jane', handle: 'jane', image: null },
      },
    ]);
    mockActivityCount.mockResolvedValue(1);
    mockPodcastFindMany.mockResolvedValue([]);
    mockUserFindMany.mockResolvedValue([{ id: 'user-3', name: 'Bob', handle: 'bob' }]);
    mockCollectionFindMany.mockResolvedValue([]);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.activities[0].target).toEqual({ name: 'Bob', handle: 'bob' });
  });

  it('sets hasMore true when more pages exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockFollowFindMany.mockResolvedValue([{ followingId: 'user-2' }]);

    const now = new Date();
    mockActivityFindMany.mockResolvedValue([
      {
        id: 'act-1',
        type: 'LIKED',
        targetId: 'pod-1',
        targetType: 'podcast',
        metadata: null,
        createdAt: now,
        user: { id: 'user-2', name: 'Jane', handle: 'jane', image: null },
      },
    ]);
    mockActivityCount.mockResolvedValue(25);
    mockPodcastFindMany.mockResolvedValue([{ id: 'pod-1', title: 'My Pod' }]);
    mockUserFindMany.mockResolvedValue([]);
    mockCollectionFindMany.mockResolvedValue([]);

    const response = await GET(createRequest({ limit: '1' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hasMore).toBe(true);
  });
});
