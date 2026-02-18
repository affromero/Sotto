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

import { GET } from '@/app/api/tags/route';

const mockPrisma = {
  tag: {
    findMany: mockTagFindMany,
  },
};

function createRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/tags'));
}

describe('GET /api/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a list of tags with correct shape', async () => {
    mockPrisma.tag.findMany.mockResolvedValue([
      { id: 'tag-1', name: 'Science', slug: 'science', _count: { podcasts: 15 } },
      { id: 'tag-2', name: 'Technology', slug: 'technology', _count: { podcasts: 10 } },
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
      podcastCount: 15,
    });

    expect(body[1]).toEqual({
      id: 'tag-2',
      name: 'Technology',
      slug: 'technology',
      podcastCount: 10,
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

  it('maps _count.podcasts to podcastCount in response', async () => {
    mockPrisma.tag.findMany.mockResolvedValue([
      { id: 'tag-1', name: 'Art', slug: 'art', _count: { podcasts: 0 } },
      { id: 'tag-2', name: 'Music', slug: 'music', _count: { podcasts: 42 } },
    ] as never);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body[0].podcastCount).toBe(0);
    expect(body[1].podcastCount).toBe(42);

    // Verify _count is not in the response (it's mapped to podcastCount)
    expect(body[0]).not.toHaveProperty('_count');
    expect(body[1]).not.toHaveProperty('_count');
  });

  // Verifies the response preserves the order returned by the database query (ordered by podcast count desc)
  it('returns tags ordered by podcast count descending', async () => {
    mockPrisma.tag.findMany.mockResolvedValue([
      { id: 'tag-1', name: 'Science', slug: 'science', _count: { podcasts: 50 } },
      { id: 'tag-2', name: 'Technology', slug: 'technology', _count: { podcasts: 30 } },
      { id: 'tag-3', name: 'History', slug: 'history', _count: { podcasts: 10 } },
    ] as never);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body[0].podcastCount).toBe(50);
    expect(body[1].podcastCount).toBe(30);
    expect(body[2].podcastCount).toBe(10);
  });

});
