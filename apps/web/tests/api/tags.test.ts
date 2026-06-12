import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock fn at module scope so it's properly typed as Mock
const mockTagFindMany = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    tag: {
      findMany: (...args: unknown[]) => mockTagFindMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

import { GET } from '@/app/api/v1/tags/route';

const mockPrisma = {
  tag: {
    findMany: mockTagFindMany,
  },
};

function createRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/v1/tags'));
}

describe('GET /api/v1/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a list of tags with correct shape', async () => {
    mockPrisma.tag.findMany.mockResolvedValue([
      { id: 'tag-1', name: 'Science', slug: 'science', _count: { episodes: 15 } },
      { id: 'tag-2', name: 'Technology', slug: 'technology', _count: { episodes: 10 } },
    ] as never);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);

    expect(body[0]).toEqual({
      id: 'tag-1',
      name: 'Science',
      slug: 'science',
      episodeCount: 15,
    });

    expect(body[1]).toEqual({
      id: 'tag-2',
      name: 'Technology',
      slug: 'technology',
      episodeCount: 10,
    });
  });

  it('returns empty array when no tags exist', async () => {
    mockPrisma.tag.findMany.mockResolvedValue([]);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([]);
  });

  it('maps _count.episodes to episodeCount in response', async () => {
    mockPrisma.tag.findMany.mockResolvedValue([
      { id: 'tag-1', name: 'Art', slug: 'art', _count: { episodes: 0 } },
      { id: 'tag-2', name: 'Music', slug: 'music', _count: { episodes: 42 } },
    ] as never);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body[0].episodeCount).toBe(0);
    expect(body[1].episodeCount).toBe(42);

    // Verify _count is not in the response (it's mapped to episodeCount)
    expect(body[0]).not.toHaveProperty('_count');
    expect(body[1]).not.toHaveProperty('_count');
  });

  // Verifies the response preserves the order returned by the database query (ordered by episode count desc)
  it('returns tags ordered by episode count descending', async () => {
    mockPrisma.tag.findMany.mockResolvedValue([
      { id: 'tag-1', name: 'Science', slug: 'science', _count: { episodes: 50 } },
      { id: 'tag-2', name: 'Technology', slug: 'technology', _count: { episodes: 30 } },
      { id: 'tag-3', name: 'History', slug: 'history', _count: { episodes: 10 } },
    ] as never);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body[0].episodeCount).toBe(50);
    expect(body[1].episodeCount).toBe(30);
    expect(body[2].episodeCount).toBe(10);
  });

});
