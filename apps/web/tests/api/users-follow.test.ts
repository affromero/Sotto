import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuth = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

const mockPrismaUserFindUnique = vi.fn();
const mockPrismaFollowCreate = vi.fn();
const mockPrismaFollowDelete = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
    },
    follow: {
      create: (...args: unknown[]) => mockPrismaFollowCreate(...args),
      delete: (...args: unknown[]) => mockPrismaFollowDelete(...args),
    },
    activity: {
      create: vi.fn().mockReturnValue({ catch: vi.fn() }),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

// ---- Import under test ----
import { POST, DELETE } from '@/app/api/users/[userId]/follow/route';

// ---- Helpers ----

function createMockRequest(): NextRequest {
  return {
    json: async () => ({}),
  } as NextRequest;
}

// ---- Tests ----

describe('POST /api/users/[userId]/follow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createMockRequest();
    const response = await POST(request, {
      params: Promise.resolve({ userId: 'target-user-id' }),
    });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createMockRequest();
    const response = await POST(request, {
      params: Promise.resolve({ userId: 'target-user-id' }),
    });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 400 when trying to follow yourself', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-123' } });

    const request = createMockRequest();
    const response = await POST(request, {
      params: Promise.resolve({ userId: 'user-123' }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toMatchObject({ error: 'Cannot follow yourself' });
  });

  it('returns 404 when target user does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'current-user-id' } });
    mockPrismaUserFindUnique.mockResolvedValue(null);

    const request = createMockRequest();
    const response = await POST(request, {
      params: Promise.resolve({ userId: 'non-existent-user' }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toMatchObject({ error: 'User not found' });
  });

  it('successfully creates a new follow relationship', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'follower-id' } });
    mockPrismaUserFindUnique.mockResolvedValue({
      id: 'following-id',
      name: 'Target User',
      email: 'target@example.com',
    });
    mockPrismaFollowCreate.mockResolvedValue({
      followerId: 'follower-id',
      followingId: 'following-id',
      createdAt: new Date(),
    });

    const request = createMockRequest();
    const response = await POST(request, {
      params: Promise.resolve({ userId: 'following-id' }),
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual({ following: true });
  });

  it('returns 200 when already following (P2002 unique constraint violation)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'follower-id' } });
    mockPrismaUserFindUnique.mockResolvedValue({
      id: 'following-id',
      name: 'Target User',
    });

    const constraintError = new Error('Unique constraint violation');
    Object.assign(constraintError, { code: 'P2002' });
    mockPrismaFollowCreate.mockRejectedValue(constraintError);

    const request = createMockRequest();
    const response = await POST(request, {
      params: Promise.resolve({ userId: 'following-id' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ following: true });
  });

  it('throws error for non-P2002 database errors', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'follower-id' } });
    mockPrismaUserFindUnique.mockResolvedValue({
      id: 'following-id',
      name: 'Target User',
    });

    const databaseError = new Error('Database connection failed');
    Object.assign(databaseError, { code: 'P1001' });
    mockPrismaFollowCreate.mockRejectedValue(databaseError);

    const request = createMockRequest();

    await expect(
      POST(request, {
        params: Promise.resolve({ userId: 'following-id' }),
      })
    ).rejects.toThrow('Database connection failed');
  });

});

describe('DELETE /api/users/[userId]/follow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createMockRequest();
    const response = await DELETE(request, {
      params: Promise.resolve({ userId: 'target-user-id' }),
    });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createMockRequest();
    const response = await DELETE(request, {
      params: Promise.resolve({ userId: 'target-user-id' }),
    });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: 'Unauthorized' });
  });

  it('successfully deletes an existing follow relationship', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'follower-id' } });
    mockPrismaFollowDelete.mockResolvedValue({
      followerId: 'follower-id',
      followingId: 'following-id',
      createdAt: new Date(),
    });

    const request = createMockRequest();
    const response = await DELETE(request, {
      params: Promise.resolve({ userId: 'following-id' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ following: false });
  });

  it('returns 200 when not following (P2025 record not found)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'follower-id' } });

    const notFoundError = new Error('Record not found');
    Object.assign(notFoundError, { code: 'P2025' });
    mockPrismaFollowDelete.mockRejectedValue(notFoundError);

    const request = createMockRequest();
    const response = await DELETE(request, {
      params: Promise.resolve({ userId: 'following-id' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ following: false });
  });

  it('throws error for non-P2025 database errors', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'follower-id' } });

    const databaseError = new Error('Database connection failed');
    Object.assign(databaseError, { code: 'P1001' });
    mockPrismaFollowDelete.mockRejectedValue(databaseError);

    const request = createMockRequest();

    await expect(
      DELETE(request, {
        params: Promise.resolve({ userId: 'following-id' }),
      })
    ).rejects.toThrow('Database connection failed');
  });

});
