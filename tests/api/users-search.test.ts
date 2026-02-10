import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockUserFindMany = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { GET } from '@/app/api/users/search/route';

function createRequest(url: string): NextRequest {
  return new NextRequest(url);
}

const mockSession = {
  user: {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: '2025-12-31',
};

const mockUsers = [
  {
    id: 'user-2',
    handle: 'alice',
    name: 'Alice',
    image: 'https://example.com/alice.jpg',
  },
  {
    id: 'user-3',
    handle: 'alicewonder',
    name: 'Alice Wonder',
    image: null,
  },
];

describe('GET /api/users/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/users/search?handle=alice');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when handle query param too short', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const request = createRequest('http://localhost:3000/api/users/search?handle=a');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when handle query param is empty', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const request = createRequest('http://localhost:3000/api/users/search?handle=');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when handle query param is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const request = createRequest('http://localhost:3000/api/users/search');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  it('returns empty array when no matches', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockUserFindMany.mockResolvedValue([]);

    const request = createRequest('http://localhost:3000/api/users/search?handle=nonexistent');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([]);
  });

  it('returns matching users', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockUserFindMany.mockResolvedValue(mockUsers);

    const request = createRequest('http://localhost:3000/api/users/search?handle=alice');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(mockUsers);
    expect(mockUserFindMany).toHaveBeenCalledWith({
      where: {
        handle: { contains: 'alice', mode: 'insensitive' },
        id: { not: 'user-1' },
      },
      select: {
        id: true,
        handle: true,
        name: true,
        image: true,
      },
      take: 10,
      orderBy: { handle: 'asc' },
    });
  });

  it('excludes the current user from results', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockUserFindMany.mockResolvedValue([]);

    const request = createRequest('http://localhost:3000/api/users/search?handle=test');
    await GET(request);

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: 'user-1' },
        }),
      })
    );
  });

  it('limits to 10 results', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockUserFindMany.mockResolvedValue(mockUsers);

    const request = createRequest('http://localhost:3000/api/users/search?handle=alice');
    await GET(request);

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
      })
    );
  });

  it('performs case-insensitive search', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockUserFindMany.mockResolvedValue(mockUsers);

    const request = createRequest('http://localhost:3000/api/users/search?handle=ALICE');
    await GET(request);

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          handle: { contains: 'ALICE', mode: 'insensitive' },
        }),
      })
    );
  });

  it('orders results by handle ascending', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockUserFindMany.mockResolvedValue(mockUsers);

    const request = createRequest('http://localhost:3000/api/users/search?handle=alice');
    await GET(request);

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { handle: 'asc' },
      })
    );
  });
});
