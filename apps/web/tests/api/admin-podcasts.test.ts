import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockPodcastCreate = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockPodcastUpdateMany = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      create: (...args: unknown[]) => mockPodcastCreate(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
      updateMany: (...args: unknown[]) => mockPodcastUpdateMany(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
  prismaUnfiltered: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
      updateMany: (...args: unknown[]) => mockPodcastUpdateMany(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

import { POST } from '@/app/api/admin/podcasts/create-as-sotto/route';
import { DELETE } from '@/app/api/admin/podcasts/[podcastId]/route';

function createPostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/admin/podcasts/create-as-sotto'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeleteRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/admin/podcasts/pod-1'), {
    method: 'DELETE',
  });
}

async function createParams(podcastId: string) {
  return { params: Promise.resolve({ podcastId }) };
}

describe('POST /api/admin/podcasts/create-as-sotto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createPostRequest({ title: 'Test', topic: 'Test' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({ role: 'USER' });

    const request = createPostRequest({ title: 'Test', topic: 'Test' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 404 when @sotto account not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1' } });
    // First call: admin role check, second call: sotto user lookup
    mockUserFindUnique
      .mockResolvedValueOnce({ role: 'ADMIN' })
      .mockResolvedValueOnce(null);

    const request = createPostRequest({ title: 'Test', topic: 'Test' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toContain('@sotto system account not found');
  });

  it('returns 400 when title or topic missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1' } });
    mockUserFindUnique
      .mockResolvedValueOnce({ role: 'ADMIN' })
      .mockResolvedValueOnce({ id: 'sotto-id' });

    const request = createPostRequest({ title: 'Test' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'title and topic are required' });
  });

  it('creates podcast owned by @sotto successfully', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1' } });
    mockUserFindUnique
      .mockResolvedValueOnce({ role: 'ADMIN' })
      .mockResolvedValueOnce({ id: 'sotto-id' });
    const created = {
      id: 'pod-1',
      userId: 'sotto-id',
      title: 'Test Podcast',
      topic: 'AI',
      status: 'PENDING',
      visibility: 'PUBLIC',
      source: 'WEB',
    };
    mockPodcastCreate.mockResolvedValue(created);

    const request = createPostRequest({ title: 'Test Podcast', topic: 'AI' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual(created);
  });
});

describe('DELETE /api/admin/podcasts/[podcastId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 404 when podcast not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockPodcastFindUnique.mockResolvedValue(null);

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Podcast not found' });
  });

  it('returns 409 when podcast already deleted', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockPodcastFindUnique.mockResolvedValue({
      forkedFromId: null,
      deletedAt: new Date(),
    });

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: 'Podcast already deleted' });
  });

  it('soft-deletes podcast and unlinks forks', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockPodcastFindUnique.mockResolvedValue({
      forkedFromId: null,
      deletedAt: null,
    });
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: {
          updateMany: mockPodcastUpdateMany,
          findUnique: vi.fn().mockResolvedValue(null),
          update: mockPodcastUpdate,
        },
      };
      return callback(tx);
    });
    mockPodcastUpdateMany.mockResolvedValue({ count: 0 });
    mockPodcastUpdate.mockResolvedValue({ id: 'pod-1' });

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });
});
