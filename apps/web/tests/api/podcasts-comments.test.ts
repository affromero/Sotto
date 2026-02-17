import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockCommentFindMany = vi.fn();
const mockCommentCount = vi.fn();
const mockCommentFindUnique = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
    comment: {
      findMany: (...args: unknown[]) => mockCommentFindMany(...args),
      count: (...args: unknown[]) => mockCommentCount(...args),
      findUnique: (...args: unknown[]) => mockCommentFindUnique(...args),
    },
    activity: {
      create: vi.fn().mockReturnValue({ catch: vi.fn() }),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

import { GET, POST } from '@/app/api/podcasts/[podcastId]/comments/route';

function createGetRequest(queryParams?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/podcasts/pod-1/comments');
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url);
}

function createPostRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/comments'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createParams(podcastId: string) {
  return { params: Promise.resolve({ podcastId }) };
}

describe('GET /api/podcasts/[podcastId]/comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when podcast does not exist', async () => {
    mockPodcastFindUnique.mockResolvedValue(null);

    const request = createGetRequest();
    const params = await createParams('non-existent');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Podcast not found' });
  });

  it('returns 404 for private podcast when user is not owner', async () => {
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', visibility: 'PRIVATE', userId: 'user-1' });
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });

    const request = createGetRequest();
    const params = await createParams('pod-1');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Not found' });
  });

  it('returns 400 for invalid pagination params', async () => {
    const request = createGetRequest({ page: '0', limit: '200' });
    const params = await createParams('pod-1');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid query parameters' });
  });

  it('returns paginated comments for public podcast', async () => {
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', visibility: 'PUBLIC', userId: 'user-1' });
    const now = new Date('2024-01-01T00:00:00.000Z');
    mockCommentFindMany.mockResolvedValue([
      {
        id: 'comment-1',
        content: 'Great podcast!',
        timestamp: null,
        replyCount: 0,
        createdAt: now,
        user: { id: 'user-2', name: 'Fan', image: null, handle: 'fan' },
      },
    ]);
    mockCommentCount.mockResolvedValue(1);

    const request = createGetRequest();
    const params = await createParams('pod-1');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].content).toBe('Great podcast!');
    expect(body.items[0].createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBe(1);
  });

  it('allows owner to view comments on private podcast', async () => {
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', visibility: 'PRIVATE', userId: 'user-1' });
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCommentFindMany.mockResolvedValue([]);
    mockCommentCount.mockResolvedValue(0);

    const request = createGetRequest();
    const params = await createParams('pod-1');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe('POST /api/podcasts/[podcastId]/comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createPostRequest({ content: 'Test' });
    const params = await createParams('pod-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when content is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const request = createPostRequest({});
    const params = await createParams('pod-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid input');
  });

  it('returns 400 when content is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const request = createPostRequest({ content: '' });
    const params = await createParams('pod-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid input');
  });

  it('returns 404 when podcast does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(null);

    const request = createPostRequest({ content: 'Hello' });
    const params = await createParams('non-existent');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Podcast not found' });
  });

  it('returns 404 when parent comment does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-2' });
    mockCommentFindUnique.mockResolvedValue(null);

    const request = createPostRequest({ content: 'Reply', parentId: 'non-existent' });
    const params = await createParams('pod-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Parent comment not found' });
  });

  it('returns 404 when parent comment belongs to different podcast', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-2' });
    mockCommentFindUnique.mockResolvedValue({ id: 'comment-1', podcastId: 'pod-other' });

    const request = createPostRequest({ content: 'Reply', parentId: 'comment-1' });
    const params = await createParams('pod-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Parent comment not found' });
  });

  it('creates top-level comment and returns 201', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-2' });
    const now = new Date('2024-01-01T00:00:00.000Z');
    const createdComment = {
      id: 'comment-1',
      content: 'Great episode!',
      timestamp: null,
      replyCount: 0,
      createdAt: now,
      user: { id: 'user-1', name: 'User', image: null, handle: 'user1' },
    };
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        comment: {
          create: vi.fn().mockResolvedValue(createdComment),
          update: vi.fn().mockResolvedValue({}),
        },
        podcast: { update: vi.fn().mockResolvedValue({}) },
      };
      return callback(tx);
    });

    const request = createPostRequest({ content: 'Great episode!' });
    const params = await createParams('pod-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe('comment-1');
    expect(body.content).toBe('Great episode!');
    expect(body.createdAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('creates comment with timestamp', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', userId: 'user-2' });
    const now = new Date('2024-01-01T00:00:00.000Z');
    const createdComment = {
      id: 'comment-2',
      content: 'What does this mean?',
      timestamp: 42.5,
      replyCount: 0,
      createdAt: now,
      user: { id: 'user-1', name: 'User', image: null, handle: 'user1' },
    };
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        comment: {
          create: vi.fn().mockResolvedValue(createdComment),
          update: vi.fn().mockResolvedValue({}),
        },
        podcast: { update: vi.fn().mockResolvedValue({}) },
      };
      return callback(tx);
    });

    const request = createPostRequest({ content: 'What does this mean?', timestamp: 42.5 });
    const params = await createParams('pod-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.timestamp).toBe(42.5);
  });
});
