import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockCollectionFindUnique = vi.fn();
const mockCollectionUpdate = vi.fn();
const mockCollectionDelete = vi.fn();
const mockCollectionFollowFindUnique = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    collection: {
      findUnique: (...args: unknown[]) => mockCollectionFindUnique(...args),
      update: (...args: unknown[]) => mockCollectionUpdate(...args),
      delete: (...args: unknown[]) => mockCollectionDelete(...args),
    },
    collectionFollow: {
      findUnique: (...args: unknown[]) => mockCollectionFollowFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, PATCH, DELETE } from '@/app/api/collections/[collectionId]/route';

function createRequest(method = 'GET', body?: unknown): NextRequest {
  const opts: RequestInit = { method };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  return new NextRequest(new URL('http://localhost:3000/api/collections/col-1'), opts);
}

async function createParams(collectionId: string) {
  return { params: Promise.resolve({ collectionId }) };
}

describe('GET /api/collections/[collectionId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when collection does not exist', async () => {
    mockAuth.mockResolvedValue(null);
    mockCollectionFindUnique.mockResolvedValue(null);

    const request = createRequest();
    const params = await createParams('non-existent');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Collection not found' });
  });

  it('returns 404 for private collection when user is not owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });
    mockCollectionFindUnique.mockResolvedValue({
      id: 'col-1',
      name: 'Private',
      description: null,
      isPublic: false,
      userId: 'user-1',
      podcastCount: 0,
      followerCount: 0,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      user: { id: 'user-1', name: 'Owner', handle: 'owner', image: null },
      items: [],
    });

    const request = createRequest();
    const params = await createParams('col-1');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Collection not found' });
  });

  it('returns public collection with items for unauthenticated user', async () => {
    mockAuth.mockResolvedValue(null);
    const now = new Date('2024-01-01T00:00:00.000Z');
    mockCollectionFindUnique.mockResolvedValue({
      id: 'col-1',
      name: 'Public Collection',
      description: 'A public one',
      isPublic: true,
      userId: 'user-1',
      podcastCount: 1,
      followerCount: 5,
      createdAt: now,
      user: { id: 'user-1', name: 'Owner', handle: 'owner', image: null },
      items: [
        {
          addedAt: now,
          order: 0,
          podcast: {
            id: 'pod-1',
            title: 'Test Podcast',
            topic: 'Tech',
            status: 'READY',
            visibility: 'PUBLIC',
            audioUrl: 'http://example.com/audio.mp3',
            duration: 300,
            playCount: 10,
            likeCount: 5,
            forkCount: 0,
            createdAt: now,
            source: 'WEB',
            isHumanContent: false,
            forkedFromId: null,
            user: { id: 'user-1', name: 'Owner', handle: 'owner', image: null },
            tags: [{ tag: { id: 'tag-1', name: 'Tech', slug: 'tech' } }],
          },
        },
      ],
    });

    const request = createRequest();
    const params = await createParams('col-1');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe('Public Collection');
    expect(body.isFollowing).toBe(false);
    expect(body.isOwner).toBe(false);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].tags).toEqual([{ id: 'tag-1', name: 'Tech', slug: 'tech' }]);
  });

  it('shows isFollowing=true when user follows the collection', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });
    const now = new Date('2024-01-01T00:00:00.000Z');
    mockCollectionFindUnique.mockResolvedValue({
      id: 'col-1',
      name: 'Public',
      description: null,
      isPublic: true,
      userId: 'user-1',
      podcastCount: 0,
      followerCount: 1,
      createdAt: now,
      user: { id: 'user-1', name: 'Owner', handle: 'owner', image: null },
      items: [],
    });
    mockCollectionFollowFindUnique.mockResolvedValue({ userId: 'user-2', collectionId: 'col-1' });

    const request = createRequest();
    const params = await createParams('col-1');
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.isFollowing).toBe(true);
    expect(body.isOwner).toBe(false);
  });
});

describe('PATCH /api/collections/[collectionId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('PATCH', { name: 'Updated' });
    const params = await createParams('col-1');
    const response = await PATCH(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 when collection does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindUnique.mockResolvedValue(null);

    const request = createRequest('PATCH', { name: 'Updated' });
    const params = await createParams('non-existent');
    const response = await PATCH(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Collection not found' });
  });

  it('returns 403 when user does not own the collection', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });
    mockCollectionFindUnique.mockResolvedValue({ userId: 'user-1' });

    const request = createRequest('PATCH', { name: 'Updated' });
    const params = await createParams('col-1');
    const response = await PATCH(request, params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 for invalid JSON body', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindUnique.mockResolvedValue({ userId: 'user-1' });

    const request = new NextRequest(new URL('http://localhost:3000/api/collections/col-1'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const params = await createParams('col-1');
    const response = await PATCH(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid JSON');
  });

  it('updates collection and returns updated data', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindUnique.mockResolvedValue({ userId: 'user-1' });
    const now = new Date('2024-01-01T00:00:00.000Z');
    mockCollectionUpdate.mockResolvedValue({
      id: 'col-1',
      name: 'Updated Name',
      description: 'Updated desc',
      isPublic: false,
      podcastCount: 3,
      followerCount: 10,
      createdAt: now,
    });

    const request = createRequest('PATCH', { name: 'Updated Name', description: 'Updated desc', isPublic: false });
    const params = await createParams('col-1');
    const response = await PATCH(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe('Updated Name');
    expect(body.createdAt).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('DELETE /api/collections/[collectionId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('DELETE');
    const params = await createParams('col-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 when collection does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindUnique.mockResolvedValue(null);

    const request = createRequest('DELETE');
    const params = await createParams('non-existent');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Collection not found' });
  });

  it('returns 403 when user does not own the collection', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });
    mockCollectionFindUnique.mockResolvedValue({ userId: 'user-1' });

    const request = createRequest('DELETE');
    const params = await createParams('col-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('deletes collection and returns success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindUnique.mockResolvedValue({ userId: 'user-1' });
    mockCollectionDelete.mockResolvedValue({});

    const request = createRequest('DELETE');
    const params = await createParams('col-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ deleted: true });
  });
});
