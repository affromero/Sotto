import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockCommentFindUnique = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    comment: {
      findUnique: (...args: unknown[]) => mockCommentFindUnique(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

import { DELETE } from '@/app/api/podcasts/[podcastId]/comments/[commentId]/route';

function createRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/comments/comment-1'), {
    method: 'DELETE',
  });
}

async function createParams(podcastId: string, commentId: string) {
  return { params: Promise.resolve({ podcastId, commentId }) };
}

describe('DELETE /api/podcasts/[podcastId]/comments/[commentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const params = await createParams('pod-1', 'comment-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when session exists but user.id is missing', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createRequest();
    const params = await createParams('pod-1', 'comment-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 when comment does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCommentFindUnique.mockResolvedValue(null);

    const request = createRequest();
    const params = await createParams('pod-1', 'non-existent');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Comment not found' });
  });

  it('returns 404 when comment belongs to different podcast', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCommentFindUnique.mockResolvedValue({
      id: 'comment-1',
      userId: 'user-1',
      podcastId: 'pod-other',
      parentId: null,
      podcast: { userId: 'user-2' },
    });

    const request = createRequest();
    const params = await createParams('pod-1', 'comment-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Comment not found' });
  });

  it('returns 403 when user is neither comment author nor podcast owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-3' } });
    mockCommentFindUnique.mockResolvedValue({
      id: 'comment-1',
      userId: 'user-1',
      podcastId: 'pod-1',
      parentId: null,
      podcast: { userId: 'user-2' },
    });

    const request = createRequest();
    const params = await createParams('pod-1', 'comment-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('allows comment author to delete their own comment', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCommentFindUnique.mockResolvedValue({
      id: 'comment-1',
      userId: 'user-1',
      podcastId: 'pod-1',
      parentId: null,
      podcast: { userId: 'user-2' },
    });
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        comment: {
          count: vi.fn().mockResolvedValue(0),
          delete: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue({}),
        },
        podcast: { update: vi.fn().mockResolvedValue({}) },
      };
      return callback(tx);
    });

    const request = createRequest();
    const params = await createParams('pod-1', 'comment-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });

  it('allows podcast owner to delete any comment on their podcast', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });
    mockCommentFindUnique.mockResolvedValue({
      id: 'comment-1',
      userId: 'user-1',
      podcastId: 'pod-1',
      parentId: null,
      podcast: { userId: 'user-2' },
    });
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        comment: {
          count: vi.fn().mockResolvedValue(3),
          delete: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue({}),
        },
        podcast: { update: vi.fn().mockResolvedValue({}) },
      };
      return callback(tx);
    });

    const request = createRequest();
    const params = await createParams('pod-1', 'comment-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });

  it('decrements parent replyCount when deleting a reply', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCommentFindUnique.mockResolvedValue({
      id: 'comment-2',
      userId: 'user-1',
      podcastId: 'pod-1',
      parentId: 'comment-1',
      podcast: { userId: 'user-2' },
    });
    const mockCommentUpdate = vi.fn().mockResolvedValue({});
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        comment: {
          count: vi.fn().mockResolvedValue(0),
          delete: vi.fn().mockResolvedValue({}),
          update: mockCommentUpdate,
        },
        podcast: { update: vi.fn().mockResolvedValue({}) },
      };
      return callback(tx);
    });

    const request = createRequest();
    const params = await createParams('pod-1', 'comment-2');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    // Should have called comment.update to decrement parent replyCount
    expect(mockCommentUpdate).toHaveBeenCalled();
  });
});
