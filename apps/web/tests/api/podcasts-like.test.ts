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

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    like: {
      findUnique: (...args: unknown[]) => mockLikeFindUnique(...args),
      create: (...args: unknown[]) => mockLikeCreate(...args),
      delete: (...args: unknown[]) => mockLikeDelete(...args),
    },
    activity: {
      create: vi.fn().mockReturnValue({ catch: vi.fn() }),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

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
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session exists but user.id is missing', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createRequest();
    const params = await createParams('pod-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(null);

    const request = createRequest();
    const params = await createParams('non-existent');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found' });
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
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session exists but user.id is missing', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
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
  });

});
