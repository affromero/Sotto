import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockCommentFindUnique = vi.fn();
const mockCommentFindMany = vi.fn();
const mockCommentCount = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    comment: {
      findUnique: (...args: unknown[]) => mockCommentFindUnique(...args),
      findMany: (...args: unknown[]) => mockCommentFindMany(...args),
      count: (...args: unknown[]) => mockCommentCount(...args),
    },
  },
}));

import { GET } from '@/app/api/podcasts/[podcastId]/comments/[commentId]/replies/route';

function createRequest(queryParams?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/podcasts/pod-1/comments/comment-1/replies');
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url);
}

async function createParams(podcastId: string, commentId: string) {
  return { params: Promise.resolve({ podcastId, commentId }) };
}

describe('GET /api/podcasts/[podcastId]/comments/[commentId]/replies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for invalid pagination params', async () => {
    const request = createRequest({ page: '-1' });
    const params = await createParams('pod-1', 'comment-1');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid query parameters' });
  });

  it('returns 404 when parent comment does not exist', async () => {
    mockCommentFindUnique.mockResolvedValue(null);

    const request = createRequest();
    const params = await createParams('pod-1', 'non-existent');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Comment not found' });
  });

  it('returns 404 when parent comment belongs to different podcast', async () => {
    mockCommentFindUnique.mockResolvedValue({ id: 'comment-1', podcastId: 'pod-other' });

    const request = createRequest();
    const params = await createParams('pod-1', 'comment-1');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Comment not found' });
  });

  it('returns empty list when comment has no replies', async () => {
    mockCommentFindUnique.mockResolvedValue({ id: 'comment-1', podcastId: 'pod-1' });
    mockCommentFindMany.mockResolvedValue([]);
    mockCommentCount.mockResolvedValue(0);

    const request = createRequest();
    const params = await createParams('pod-1', 'comment-1');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
    expect(body.totalPages).toBe(0);
  });

  it('returns paginated replies with serialized dates', async () => {
    mockCommentFindUnique.mockResolvedValue({ id: 'comment-1', podcastId: 'pod-1' });
    const now = new Date('2024-01-01T00:00:00.000Z');
    mockCommentFindMany.mockResolvedValue([
      {
        id: 'reply-1',
        content: 'I agree!',
        timestamp: null,
        replyCount: 0,
        createdAt: now,
        user: { id: 'user-2', name: 'Replier', image: null, handle: 'replier' },
      },
      {
        id: 'reply-2',
        content: 'Me too!',
        timestamp: 30.0,
        replyCount: 0,
        createdAt: now,
        user: { id: 'user-3', name: 'Another', image: null, handle: 'another' },
      },
    ]);
    mockCommentCount.mockResolvedValue(2);

    const request = createRequest();
    const params = await createParams('pod-1', 'comment-1');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(body.items[1].timestamp).toBe(30.0);
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBe(1);
  });

  it('respects custom page and limit params', async () => {
    mockCommentFindUnique.mockResolvedValue({ id: 'comment-1', podcastId: 'pod-1' });
    mockCommentFindMany.mockResolvedValue([]);
    mockCommentCount.mockResolvedValue(25);

    const request = createRequest({ page: '2', limit: '10' });
    const params = await createParams('pod-1', 'comment-1');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(10);
    expect(body.totalPages).toBe(3);
  });
});
