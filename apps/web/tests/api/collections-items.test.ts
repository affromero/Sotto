import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockCollectionFindUnique = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockCollectionItemFindUnique = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    collection: {
      findUnique: (...args: unknown[]) => mockCollectionFindUnique(...args),
    },
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
    collectionItem: {
      findUnique: (...args: unknown[]) => mockCollectionItemFindUnique(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@prisma/client', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, { code }: { code: string }) {
        super(message);
        this.code = code;
      }
    },
  },
}));

import { POST, DELETE } from '@/app/api/collections/[collectionId]/items/route';
import { Prisma } from '@prisma/client';

function createRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/collections/col-1/items'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createParams(collectionId: string) {
  return { params: Promise.resolve({ collectionId }) };
}

describe('POST /api/collections/[collectionId]/items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest({ podcastId: 'pod-1' });
    const params = await createParams('col-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 when collection does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindUnique.mockResolvedValue(null);

    const request = createRequest({ podcastId: 'pod-1' });
    const params = await createParams('non-existent');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Collection not found' });
  });

  it('returns 403 when user does not own the collection', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });
    mockCollectionFindUnique.mockResolvedValue({ userId: 'user-1', _count: { items: 0 } });

    const request = createRequest({ podcastId: 'pod-1' });
    const params = await createParams('col-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 when podcastId is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindUnique.mockResolvedValue({ userId: 'user-1', _count: { items: 0 } });

    const request = createRequest({});
    const params = await createParams('col-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 404 when podcast does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindUnique.mockResolvedValue({ userId: 'user-1', _count: { items: 0 } });
    mockPodcastFindUnique.mockResolvedValue(null);

    const request = createRequest({ podcastId: 'non-existent' });
    const params = await createParams('col-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Podcast not found' });
  });

  it('adds podcast to collection and returns 201', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindUnique.mockResolvedValue({ userId: 'user-1', _count: { items: 2 } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1' });
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        collectionItem: { create: vi.fn().mockResolvedValue({}) },
        collection: { update: vi.fn().mockResolvedValue({}) },
      };
      return callback(tx);
    });

    const request = createRequest({ podcastId: 'pod-1' });
    const params = await createParams('col-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ added: true });
  });

  it('returns 200 with alreadyExists when podcast is already in collection', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindUnique.mockResolvedValue({ userId: 'user-1', _count: { items: 2 } });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1' });
    mockTransaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002' } as never)
    );

    const request = createRequest({ podcastId: 'pod-1' });
    const params = await createParams('col-1');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ added: true, alreadyExists: true });
  });
});

describe('DELETE /api/collections/[collectionId]/items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest({ podcastId: 'pod-1' });
    const params = await createParams('col-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 when collection does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindUnique.mockResolvedValue(null);

    const request = createRequest({ podcastId: 'pod-1' });
    const params = await createParams('non-existent');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Collection not found' });
  });

  it('returns 403 when user does not own the collection', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });
    mockCollectionFindUnique.mockResolvedValue({ userId: 'user-1' });

    const request = createRequest({ podcastId: 'pod-1' });
    const params = await createParams('col-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns removed: true when item does not exist (idempotent)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindUnique.mockResolvedValue({ userId: 'user-1' });
    mockCollectionItemFindUnique.mockResolvedValue(null);

    const request = createRequest({ podcastId: 'pod-1' });
    const params = await createParams('col-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ removed: true });
  });

  it('removes item from collection and returns removed: true', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindUnique.mockResolvedValue({ userId: 'user-1' });
    mockCollectionItemFindUnique.mockResolvedValue({ collectionId: 'col-1', podcastId: 'pod-1' });
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        collectionItem: { delete: vi.fn().mockResolvedValue({}) },
        collection: { update: vi.fn().mockResolvedValue({}) },
      };
      return callback(tx);
    });

    const request = createRequest({ podcastId: 'pod-1' });
    const params = await createParams('col-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ removed: true });
  });
});
