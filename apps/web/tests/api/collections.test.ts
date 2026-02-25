import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockCollectionFindMany = vi.fn();
const mockCollectionCreate = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    collection: {
      findMany: (...args: unknown[]) => mockCollectionFindMany(...args),
      create: (...args: unknown[]) => mockCollectionCreate(...args),
    },
    activity: {
      create: vi.fn().mockReturnValue({ catch: vi.fn() }),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST } from '@/app/api/collections/route';

function createPostRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/collections'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/collections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session exists but user.id is missing', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns empty array when user has no collections', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCollectionFindMany.mockResolvedValue([]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ collections: [] });
  });

  it('returns collections with serialized dates', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    const now = new Date('2024-01-01T00:00:00.000Z');
    mockCollectionFindMany.mockResolvedValue([
      {
        id: 'col-1',
        name: 'My Collection',
        description: 'desc',
        isPublic: true,
        podcastCount: 3,
        followerCount: 10,
        createdAt: now,
      },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.collections).toHaveLength(1);
    expect(body.collections[0].createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(body.collections[0].name).toBe('My Collection');
  });
});

describe('POST /api/collections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createPostRequest({ name: 'Test' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 400 when name is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const request = createPostRequest({});
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 when name is empty string', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const request = createPostRequest({ name: '' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid JSON body', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const request = new NextRequest(new URL('http://localhost:3000/api/collections'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid JSON');
  });

  it('creates collection and returns 201 with serialized date', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    const now = new Date('2024-01-01T00:00:00.000Z');
    mockCollectionCreate.mockResolvedValue({
      id: 'col-1',
      name: 'New Collection',
      description: null,
      isPublic: true,
      podcastCount: 0,
      followerCount: 0,
      createdAt: now,
    });

    const request = createPostRequest({ name: 'New Collection' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe('col-1');
    expect(body.name).toBe('New Collection');
    expect(body.createdAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('passes description and isPublic to prisma create', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    const now = new Date('2024-01-01T00:00:00.000Z');
    mockCollectionCreate.mockResolvedValue({
      id: 'col-2',
      name: 'Private',
      description: 'Secret stuff',
      isPublic: false,
      podcastCount: 0,
      followerCount: 0,
      createdAt: now,
    });

    const request = createPostRequest({ name: 'Private', description: 'Secret stuff', isPublic: false });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.isPublic).toBe(false);
    expect(body.description).toBe('Secret stuff');
  });
});
