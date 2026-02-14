import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockUserFindUnique = vi.fn();
const mockFollowFindUnique = vi.fn();
const mockAuth = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    follow: {
      findUnique: (...args: unknown[]) => mockFollowFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

import { GET } from '@/app/api/users/[userId]/route';

const mockPrisma = {
  user: {
    findUnique: mockUserFindUnique,
  },
  follow: {
    findUnique: mockFollowFindUnique,
  },
};

function createRequest(): NextRequest {
  const url = new URL('http://localhost:3000/api/users/user-1');
  return new NextRequest(url);
}

const mockUser = {
  id: 'user-1',
  name: 'Alice Johnson',
  image: 'https://example.com/alice.jpg',
  bio: 'Science educator and podcast creator',
  createdAt: new Date('2025-01-10T10:00:00Z'),
  _count: {
    podcasts: 12,
    followers: 150,
    following: 45,
  },
};

const mockUserWithoutImage = {
  id: 'user-2',
  name: 'Bob Smith',
  image: null,
  bio: null,
  createdAt: new Date('2025-01-15T10:00:00Z'),
  _count: {
    podcasts: 3,
    followers: 10,
    following: 20,
  },
};

describe('GET /api/users/[userId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns user profile data without authentication', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'user-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('user-1');
    expect(body.name).toBe('Alice Johnson');
    expect(body.isFollowing).toBe(false);
  });

  it('returns user profile with all expected fields', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'user-1' }),
    });
    const body = await response.json();

    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('image');
    expect(body).toHaveProperty('bio');
    expect(body).toHaveProperty('createdAt');
    expect(body).toHaveProperty('podcastCount');
    expect(body).toHaveProperty('followerCount');
    expect(body).toHaveProperty('followingCount');
    expect(body).toHaveProperty('isFollowing');
  });

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'non-existent' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('User not found');
  });

  it('includes correct podcast count from _count', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'user-1' }),
    });
    const body = await response.json();

    expect(body.podcastCount).toBe(12);
  });

  it('includes correct follower count from _count', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'user-1' }),
    });
    const body = await response.json();

    expect(body.followerCount).toBe(150);
  });

  it('includes correct following count from _count', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'user-1' }),
    });
    const body = await response.json();

    expect(body.followingCount).toBe(45);
  });

  it('handles user with null image and bio', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUserWithoutImage);
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'user-2' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.image).toBeNull();
    expect(body.bio).toBeNull();
  });

  it('checks isFollowing status when authenticated user views different profile', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockAuth.mockResolvedValue({
      user: { id: 'viewer-id', name: 'Viewer', email: 'viewer@example.com' },
    });
    mockPrisma.follow.findUnique.mockResolvedValue({
      followerId: 'viewer-id',
      followingId: 'user-1',
      createdAt: new Date(),
    });

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'user-1' }),
    });
    const body = await response.json();

    expect(body.isFollowing).toBe(true);
    expect(mockPrisma.follow.findUnique).toHaveBeenCalledWith({
      where: {
        followerId_followingId: {
          followerId: 'viewer-id',
          followingId: 'user-1',
        },
      },
    });
  });

  it('returns isFollowing false when authenticated user is not following', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockAuth.mockResolvedValue({
      user: { id: 'viewer-id', name: 'Viewer', email: 'viewer@example.com' },
    });
    mockPrisma.follow.findUnique.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'user-1' }),
    });
    const body = await response.json();

    expect(body.isFollowing).toBe(false);
  });

  it('does not check follow status when viewing own profile', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice Johnson', email: 'alice@example.com' },
    });

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'user-1' }),
    });
    const body = await response.json();

    expect(body.isFollowing).toBe(false);
    expect(mockPrisma.follow.findUnique).not.toHaveBeenCalled();
  });

  it('queries user with correct select fields', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    await GET(request, {
      params: Promise.resolve({ userId: 'user-1' }),
    });

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: {
        id: true,
        name: true,
        image: true,
        bio: true,
        createdAt: true,
        _count: {
          select: {
            podcasts: { where: { status: 'READY', visibility: 'PUBLIC' } },
            followers: true,
            following: true,
          },
        },
      },
    });
  });

  it('only counts READY and PUBLIC podcasts in podcastCount', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    await GET(request, {
      params: Promise.resolve({ userId: 'user-1' }),
    });

    const call = mockPrisma.user.findUnique.mock.calls[0][0];
    expect(call.select._count.select.podcasts).toEqual({
      where: { status: 'READY', visibility: 'PUBLIC' },
    });
  });

  it('handles user with zero counts gracefully', async () => {
    const newUser = {
      id: 'user-3',
      name: 'Charlie',
      image: null,
      bio: null,
      createdAt: new Date('2025-02-01T10:00:00Z'),
      _count: {
        podcasts: 0,
        followers: 0,
        following: 0,
      },
    };

    mockPrisma.user.findUnique.mockResolvedValue(newUser);
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'user-3' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.podcastCount).toBe(0);
    expect(body.followerCount).toBe(0);
    expect(body.followingCount).toBe(0);
  });

  it('preserves createdAt timestamp in response', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'user-1' }),
    });
    const body = await response.json();

    expect(body.createdAt).toBe(mockUser.createdAt.toISOString());
  });
});
