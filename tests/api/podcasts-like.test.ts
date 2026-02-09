import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockLikeFindUnique = vi.fn();
const mockLikeCreate = vi.fn();
const mockLikeDelete = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    like: {
      findUnique: (...args: unknown[]) => mockLikeFindUnique(...args),
      create: (...args: unknown[]) => mockLikeCreate(...args),
      delete: (...args: unknown[]) => mockLikeDelete(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

import { POST, DELETE } from '@/app/api/podcasts/[podcastId]/like/route';

function createRequest(): NextRequest {
  const url = new URL('http://localhost:3000/api/podcasts/pod-1/like');
  return new NextRequest(url, { method: 'POST' });
}

async function createParams(podcastId: string) {
  return { params: Promise.resolve({ podcastId }) };
}

describe('POST /api/podcasts/[podcastId]/like', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const params = await createParams('pod-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when session exists but user.id is missing', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createRequest();
    const params = await createParams('pod-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(null);

    const request = createRequest();
    const params = await createParams('non-existent');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Podcast not found' });
    expect(mockPodcastFindUnique).toHaveBeenCalledWith({
      where: { id: 'non-existent' },
      select: { id: true },
    });
  });

  it('returns liked: true without creating duplicate when already liked', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1' });
    mockLikeFindUnique.mockResolvedValue({
      id: 'like-1',
      userId: 'user-1',
      podcastId: 'pod-1',
      createdAt: new Date(),
    });

    const request = createRequest();
    const params = await createParams('pod-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ liked: true });
    expect(mockLikeFindUnique).toHaveBeenCalledWith({
      where: {
        userId_podcastId: { userId: 'user-1', podcastId: 'pod-1' },
      },
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('creates like and increments likeCount when not already liked', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1' });
    mockLikeFindUnique.mockResolvedValue(null);
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        like: { create: mockLikeCreate },
        podcast: { update: mockPodcastUpdate },
      };
      return callback(tx);
    });
    mockLikeCreate.mockResolvedValue({
      id: 'like-1',
      userId: 'user-1',
      podcastId: 'pod-1',
      createdAt: new Date(),
    });
    mockPodcastUpdate.mockResolvedValue({
      id: 'pod-1',
      likeCount: 11,
    });

    const request = createRequest();
    const params = await createParams('pod-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ liked: true });
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockLikeCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        podcastId: 'pod-1',
      },
    });
    expect(mockPodcastUpdate).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      data: { likeCount: { increment: 1 } },
    });
  });

  it('uses atomic transaction for like creation and count increment', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1' });
    mockLikeFindUnique.mockResolvedValue(null);

    let transactionCallback: ((tx: unknown) => Promise<unknown>) | null = null;
    mockTransaction.mockImplementation(async (callback) => {
      transactionCallback = callback;
      const tx = {
        like: { create: mockLikeCreate },
        podcast: { update: mockPodcastUpdate },
      };
      return callback(tx);
    });

    const request = createRequest();
    const params = await createParams('pod-1');
    await POST(request, params);

    expect(mockTransaction).toHaveBeenCalled();
    expect(transactionCallback).not.toBeNull();
  });

  it('checks podcast existence before checking for existing like', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1' });
    mockLikeFindUnique.mockResolvedValue(null);
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        like: { create: mockLikeCreate },
        podcast: { update: mockPodcastUpdate },
      };
      return callback(tx);
    });

    const request = createRequest();
    const params = await createParams('pod-1');
    await POST(request, params);

    const podcastCallOrder = mockPodcastFindUnique.mock.invocationCallOrder[0];
    const likeCallOrder = mockLikeFindUnique.mock.invocationCallOrder[0];

    expect(podcastCallOrder).toBeLessThan(likeCallOrder);
  });
});

describe('DELETE /api/podcasts/[podcastId]/like', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when session exists but user.id is missing', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns liked: false without deleting when like does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockLikeFindUnique.mockResolvedValue(null);

    const request = createRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ liked: false });
    expect(mockLikeFindUnique).toHaveBeenCalledWith({
      where: {
        userId_podcastId: { userId: 'user-1', podcastId: 'pod-1' },
      },
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('deletes like and decrements likeCount when like exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockLikeFindUnique.mockResolvedValue({
      id: 'like-1',
      userId: 'user-1',
      podcastId: 'pod-1',
      createdAt: new Date(),
    });
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        like: { delete: mockLikeDelete },
        podcast: { update: mockPodcastUpdate },
      };
      return callback(tx);
    });
    mockLikeDelete.mockResolvedValue({
      id: 'like-1',
      userId: 'user-1',
      podcastId: 'pod-1',
      createdAt: new Date(),
    });
    mockPodcastUpdate.mockResolvedValue({
      id: 'pod-1',
      likeCount: 9,
    });

    const request = createRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ liked: false });
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockLikeDelete).toHaveBeenCalledWith({
      where: {
        userId_podcastId: { userId: 'user-1', podcastId: 'pod-1' },
      },
    });
    expect(mockPodcastUpdate).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      data: { likeCount: { decrement: 1 } },
    });
  });

  it('uses atomic transaction for like deletion and count decrement', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockLikeFindUnique.mockResolvedValue({
      id: 'like-1',
      userId: 'user-1',
      podcastId: 'pod-1',
      createdAt: new Date(),
    });

    let transactionCallback: ((tx: unknown) => Promise<unknown>) | null = null;
    mockTransaction.mockImplementation(async (callback) => {
      transactionCallback = callback;
      const tx = {
        like: { delete: mockLikeDelete },
        podcast: { update: mockPodcastUpdate },
      };
      return callback(tx);
    });

    const request = createRequest();
    const params = await createParams('pod-1');
    await DELETE(request, params);

    expect(mockTransaction).toHaveBeenCalled();
    expect(transactionCallback).not.toBeNull();
  });

  it('handles unlike for different podcast IDs independently', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockLikeFindUnique.mockResolvedValue({
      id: 'like-2',
      userId: 'user-1',
      podcastId: 'pod-2',
      createdAt: new Date(),
    });
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        like: { delete: mockLikeDelete },
        podcast: { update: mockPodcastUpdate },
      };
      return callback(tx);
    });

    const request = createRequest();
    const params = await createParams('pod-2');
    await DELETE(request, params);

    expect(mockLikeFindUnique).toHaveBeenCalledWith({
      where: {
        userId_podcastId: { userId: 'user-1', podcastId: 'pod-2' },
      },
    });
    expect(mockLikeDelete).toHaveBeenCalledWith({
      where: {
        userId_podcastId: { userId: 'user-1', podcastId: 'pod-2' },
      },
    });
  });

  it('handles unlike for different users independently', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });
    mockLikeFindUnique.mockResolvedValue({
      id: 'like-3',
      userId: 'user-2',
      podcastId: 'pod-1',
      createdAt: new Date(),
    });
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        like: { delete: mockLikeDelete },
        podcast: { update: mockPodcastUpdate },
      };
      return callback(tx);
    });

    const request = createRequest();
    const params = await createParams('pod-1');
    await DELETE(request, params);

    expect(mockLikeFindUnique).toHaveBeenCalledWith({
      where: {
        userId_podcastId: { userId: 'user-2', podcastId: 'pod-1' },
      },
    });
  });
});
