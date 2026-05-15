import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockUserFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

import { GET } from '@/app/api/users/[userId]/route';

const mockPrisma = {
  user: {
    findUnique: mockUserFindUnique,
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
  },
};

describe('GET /api/users/[userId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns user profile data without authentication', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'user-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('user-1');
    expect(body.name).toBe('Alice Johnson');
    expect(body.podcastCount).toBe(12);
    expect(body).not.toHaveProperty('isFollowing');
    expect(body).not.toHaveProperty('followerCount');
    expect(body).not.toHaveProperty('followingCount');
  });

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'non-existent' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('User not found');
  });

  it('handles user with null image and bio', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUserWithoutImage);

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'user-2' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.image).toBeNull();
    expect(body.bio).toBeNull();
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
      },
    };

    mockPrisma.user.findUnique.mockResolvedValue(newUser);

    const request = createRequest();
    const response = await GET(request, {
      params: Promise.resolve({ userId: 'user-3' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.podcastCount).toBe(0);
    expect(body).not.toHaveProperty('followerCount');
    expect(body).not.toHaveProperty('followingCount');
  });
});
