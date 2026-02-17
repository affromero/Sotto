import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock fn at module scope so it's properly typed as Mock
const mockTagFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  get prismaUnfiltered() { return this.prisma; },
  prisma: {
    tag: {
      findMany: (...args: unknown[]) => mockTagFindMany(...args),
    },
  },
}));

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

  it('returns each tag with id, name, slug, and podcastCount fields', async () => {
    mockPrisma.tag.findMany.mockResolvedValue([
      { id: 'tag-1', name: 'History', slug: 'history', _count: { podcasts: 8 } },
    ] as never);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    const tag = body[0];
    expect(tag).toHaveProperty('id');
    expect(tag).toHaveProperty('name');
    expect(tag).toHaveProperty('slug');
    expect(tag).toHaveProperty('podcastCount');
    expect(typeof tag.id).toBe('string');
    expect(typeof tag.name).toBe('string');
    expect(typeof tag.slug).toBe('string');
    expect(typeof tag.podcastCount).toBe('number');
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

  it('handles a single tag correctly', async () => {
    mockPrisma.tag.findMany.mockResolvedValue([
      { id: 'tag-only', name: 'Philosophy', slug: 'philosophy', _count: { podcasts: 3 } },
    ] as never);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      id: 'tag-only',
      name: 'Philosophy',
      slug: 'philosophy',
      podcastCount: 3,
    });
  });

  it('handles tags with zero podcast count', async () => {
    mockPrisma.tag.findMany.mockResolvedValue([
      { id: 'tag-1', name: 'Unused Tag', slug: 'unused-tag', _count: { podcasts: 0 } },
    ] as never);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body[0].podcastCount).toBe(0);
  });
});
