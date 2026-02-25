import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockCollectionFindUnique = vi.fn();
const mockCollectionFollowFindUnique = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    collection: {
      findUnique: (...args: unknown[]) => mockCollectionFindUnique(...args),
    },
    collectionFollow: {
      findUnique: (...args: unknown[]) => mockCollectionFollowFindUnique(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

import { POST, DELETE } from '@/app/api/collections/[collectionId]/follow/route';

function createRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/collections/col-1/follow'), {
    method: 'POST',
  });
}

async function createParams(collectionId: string) {
  return { params: Promise.resolve({ collectionId }) };
}

describe('POST /api/collections/[collectionId]/follow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const params = await createParams('col-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when collection does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindUnique.mockResolvedValue(null);

    const request = createRequest();
    const params = await createParams('non-existent');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Collection not found' });
  });

  it('returns 404 for private collection when user is not owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });
    mockCollectionFindUnique.mockResolvedValue({ id: 'col-1', userId: 'user-1', isPublic: false });

    const request = createRequest();
    const params = await createParams('col-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Collection not found' });
  });

  it('returns following: true without creating duplicate when already following', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });
    mockCollectionFindUnique.mockResolvedValue({ id: 'col-1', userId: 'user-1', isPublic: true });
    mockCollectionFollowFindUnique.mockResolvedValue({ userId: 'user-2', collectionId: 'col-1' });

    const request = createRequest();
    const params = await createParams('col-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ following: true });
  });

  it('creates follow and increments followerCount', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });
    mockCollectionFindUnique.mockResolvedValue({ id: 'col-1', userId: 'user-1', isPublic: true });
    mockCollectionFollowFindUnique.mockResolvedValue(null);
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        collectionFollow: { create: vi.fn().mockResolvedValue({}) },
        collection: { update: vi.fn().mockResolvedValue({}) },
      };
      return callback(tx);
    });

    const request = createRequest();
    const params = await createParams('col-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ following: true });
  });
});

describe('DELETE /api/collections/[collectionId]/follow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const params = await createParams('col-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns following: false when not following (idempotent)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFollowFindUnique.mockResolvedValue(null);

    const request = createRequest();
    const params = await createParams('col-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ following: false });
  });

  it('removes follow and decrements followerCount', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFollowFindUnique.mockResolvedValue({ userId: 'user-1', collectionId: 'col-1' });
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        collectionFollow: { delete: vi.fn().mockResolvedValue({}) },
        collection: { update: vi.fn().mockResolvedValue({}) },
      };
      return callback(tx);
    });

    const request = createRequest();
    const params = await createParams('col-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ following: false });
  });
});
