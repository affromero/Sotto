import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock fns at module scope
const mockArticleFindMany = vi.fn();
const mockArticleFindFirst = vi.fn();
const mockArticleGroupBy = vi.fn();
const mockBriefingLogFindMany = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockAuthenticateRequest = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    ingestedArticle: {
      findMany: (...args: unknown[]) => mockArticleFindMany(...args),
      findFirst: (...args: unknown[]) => mockArticleFindFirst(...args),
      groupBy: (...args: unknown[]) => mockArticleGroupBy(...args),
    },
    briefingLog: {
      findMany: (...args: unknown[]) => mockBriefingLogFindMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

import { GET } from '@/app/api/news/route';

function createRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/news');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

const mockArticle = {
  id: 'art-1',
  title: 'AI breakthrough in protein folding',
  url: 'https://reuters.com/ai-protein',
  summary: 'New model achieves 99% accuracy',
  source: 'Reuters',
  category: 'tech',
  pubDate: new Date('2026-03-17T10:00:00Z'),
};

function setupDefaultMocks() {
  mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockArticleFindMany.mockResolvedValue([mockArticle]);
  mockArticleFindFirst.mockResolvedValue({ fetchedAt: new Date('2026-03-18T06:00:00Z') });
  // groupBy is called twice (category, source) — return appropriate data for each
  mockArticleGroupBy
    .mockResolvedValueOnce([
      { category: 'tech', _count: 15 },
      { category: 'world', _count: 8 },
    ])
    .mockResolvedValueOnce([
      { source: 'Reuters', _count: 10 },
      { source: 'BBC', _count: 8 },
      { source: 'NPR', _count: 5 },
    ]);
  mockBriefingLogFindMany.mockResolvedValue([]);
}

describe('GET /api/news', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toHaveProperty('error');
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockArticleFindMany).not.toHaveBeenCalled();
  });

  it('returns articles with correct NewsResponse shape', async () => {
    setupDefaultMocks();

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('articles');
    expect(body).toHaveProperty('nextCursor');
    expect(body).toHaveProperty('meta');
    expect(body.meta).toHaveProperty('latestFetchedAt');
    expect(body.meta).toHaveProperty('sourceCount');
    expect(body.meta).toHaveProperty('categoryCounts');
    expect(mockCheckRateLimit).toHaveBeenCalledWith('news:user-1', 30, 60);
  });

  it('returns article data with serialized pubDate', async () => {
    setupDefaultMocks();

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.articles).toHaveLength(1);
    const article = body.articles[0];
    expect(article.id).toBe('art-1');
    expect(article.title).toBe('AI breakthrough in protein folding');
    expect(article.source).toBe('Reuters');
    expect(article.category).toBe('tech');
    expect(article.pubDate).toBe('2026-03-17T10:00:00.000Z');
  });

  it('returns meta with source count and category counts', async () => {
    setupDefaultMocks();

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.meta.sourceCount).toBe(3);
    expect(body.meta.categoryCounts).toEqual({ tech: 15, world: 8 });
    expect(body.meta.latestFetchedAt).toBe('2026-03-18T06:00:00.000Z');
  });

  it('returns null latestFetchedAt when no articles have been ingested', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockArticleFindMany.mockResolvedValue([]);
    mockArticleFindFirst.mockResolvedValue(null);
    mockArticleGroupBy.mockResolvedValue([]);
    mockBriefingLogFindMany.mockResolvedValue([]);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.meta.latestFetchedAt).toBeNull();
    expect(body.meta.sourceCount).toBe(0);
  });

  it('attaches only owner-scoped related briefing podcast ids', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockArticleFindMany.mockResolvedValue([mockArticle]);
    mockArticleFindFirst.mockResolvedValue({ fetchedAt: new Date() });
    mockArticleGroupBy.mockResolvedValue([]);
    mockBriefingLogFindMany.mockResolvedValue([
      {
        articleUrls: ['https://reuters.com/ai-protein', 'https://other.com/x'],
        podcastId: 'pod-1',
      },
    ]);

    const response = await GET(createRequest());
    const body = await response.json();

    const article = body.articles[0];
    expect(article.relatedPodcastId).toBe('pod-1');
    expect(article).not.toHaveProperty('relatedPodcastSlug');
    expect(article).not.toHaveProperty('relatedUserHandle');
    expect(mockBriefingLogFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', articleUrls: { hasSome: ['https://reuters.com/ai-protein'] } },
      select: { articleUrls: true, podcastId: true },
    });
  });

  it('does not attach podcast fields when no BriefingLog matches', async () => {
    setupDefaultMocks();

    const response = await GET(createRequest());
    const body = await response.json();

    const article = body.articles[0];
    expect(article).not.toHaveProperty('relatedPodcastId');
    expect(article).not.toHaveProperty('relatedPodcastSlug');
    expect(article).not.toHaveProperty('relatedUserHandle');
  });

  it('accepts category filter parameter', async () => {
    setupDefaultMocks();

    const response = await GET(createRequest({ category: 'tech' }));
    expect(response.status).toBe(200);
  });

  it('accepts timeRange filter parameter', async () => {
    setupDefaultMocks();

    const response = await GET(createRequest({ timeRange: '24h' }));
    expect(response.status).toBe(200);
  });

  it('returns 400 for invalid category', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });

    const response = await GET(createRequest({ category: 'sports' }));
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for invalid timeRange', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });

    const response = await GET(createRequest({ timeRange: '1y' }));
    expect(response.status).toBe(400);
  });

  it('returns 400 for limit exceeding 50', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });

    const response = await GET(createRequest({ limit: '51' }));
    expect(response.status).toBe(400);
  });

  it('returns cursor-based pagination with nextCursor', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    // Return limit+1 results to indicate more pages
    const articles = Array.from({ length: 21 }, (_, i) => ({
      ...mockArticle,
      id: `art-${i}`,
      pubDate: new Date('2026-03-17T10:00:00Z'),
    }));
    mockArticleFindMany.mockResolvedValue(articles);
    mockArticleFindFirst.mockResolvedValue({ fetchedAt: new Date() });
    mockArticleGroupBy.mockResolvedValue([]);
    mockBriefingLogFindMany.mockResolvedValue([]);

    const response = await GET(createRequest({ limit: '20' }));
    const body = await response.json();

    expect(body.articles).toHaveLength(20);
    expect(body.nextCursor).toBe('art-19');
  });

  it('returns null nextCursor when no more results', async () => {
    setupDefaultMocks();
    mockArticleFindMany.mockResolvedValue([mockArticle]);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.articles).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
  });

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false });

    const response = await GET(createRequest());
    expect(response.status).toBe(429);
  });

  it('returns empty articles with valid meta when no articles match', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockArticleFindMany.mockResolvedValue([]);
    mockArticleFindFirst.mockResolvedValue({ fetchedAt: new Date('2026-03-18T06:00:00Z') });
    mockArticleGroupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ source: 'Reuters', _count: 5 }]);
    mockBriefingLogFindMany.mockResolvedValue([]);

    const response = await GET(createRequest({ category: 'culture' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.articles).toEqual([]);
    expect(body.nextCursor).toBeNull();
    expect(body.meta.sourceCount).toBe(1);
  });

  it('handles article with null pubDate', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockArticleFindMany.mockResolvedValue([{ ...mockArticle, pubDate: null }]);
    mockArticleFindFirst.mockResolvedValue({ fetchedAt: new Date() });
    mockArticleGroupBy.mockResolvedValue([]);
    mockBriefingLogFindMany.mockResolvedValue([]);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.articles[0].pubDate).toBeNull();
  });

  it('handles article with null category in groupBy results', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockArticleFindMany.mockResolvedValue([mockArticle]);
    mockArticleFindFirst.mockResolvedValue({ fetchedAt: new Date() });
    mockArticleGroupBy
      .mockResolvedValueOnce([
        { category: null, _count: 3 },
        { category: 'tech', _count: 10 },
      ])
      .mockResolvedValueOnce([]);
    mockBriefingLogFindMany.mockResolvedValue([]);

    const response = await GET(createRequest());
    const body = await response.json();

    // null categories should be excluded from categoryCounts
    expect(body.meta.categoryCounts).toEqual({ tech: 10 });
  });

  it('uses default timeRange of 1w when not specified', async () => {
    setupDefaultMocks();

    await GET(createRequest());

    // Verify findMany was called (we check the article query went through)
    expect(mockArticleFindMany).toHaveBeenCalledTimes(1);
    const call = mockArticleFindMany.mock.calls[0][0];
    expect(call.where.pubDate.gte).toBeInstanceOf(Date);
    // The cutoff should be roughly 7 days ago
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const callCutoff = call.where.pubDate.gte.getTime();
    expect(Math.abs(callCutoff - weekAgo)).toBeLessThan(5000);
  });

  it('passes cursor to findMany when provided', async () => {
    setupDefaultMocks();

    await GET(createRequest({ cursor: 'art-prev' }));

    const call = mockArticleFindMany.mock.calls[0][0];
    expect(call.where.id).toEqual({ lt: 'art-prev' });
  });

  it('passes category to findMany when provided', async () => {
    setupDefaultMocks();

    await GET(createRequest({ category: 'science' }));

    const call = mockArticleFindMany.mock.calls[0][0];
    expect(call.where.category).toBe('science');
  });
});
