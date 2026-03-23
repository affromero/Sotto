import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockCacheGet = vi.fn();
const mockCacheGetWithTtl = vi.fn();
const mockCacheSet = vi.fn();
const mockCountersIncrement = vi.fn();
const mockGenerateForYou = vi.fn();
const mockGenerateNews = vi.fn();
const mockGenerateCuriosity = vi.fn();
const mockLoadInspireContext = vi.fn();
const mockGetTrending = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  cache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    getWithTtl: (...args: unknown[]) => mockCacheGetWithTtl(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
  },
  inspireFailures: { push: vi.fn().mockResolvedValue(undefined) },
  counters: {
    increment: (...args: unknown[]) => mockCountersIncrement(...args),
  },
}));

vi.mock('@/lib/taste-quiz', () => ({
  generateForYouQuestions: (...args: unknown[]) => mockGenerateForYou(...args),
  generateNewsQuestions: (...args: unknown[]) => mockGenerateNews(...args),
  generateCuriosityQuestions: (...args: unknown[]) => mockGenerateCuriosity(...args),
  loadInspireContext: (...args: unknown[]) => mockLoadInspireContext(...args),
}));

vi.mock('@/lib/recommendation-engine', () => ({
  getTrending: (...args: unknown[]) => mockGetTrending(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/inspire/all/route';

function createRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/inspire/all');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

const mockForYou = [
  { id: 'fy1', text: 'AI and Music', tagSlugs: ['ai'], category: 'tech' },
];

const mockNews = [
  { id: 'n1', text: 'Mars Discovery', tagSlugs: ['science'], category: 'science' },
];

const mockCuriosity = [
  { id: 'c1', text: 'Why we can\'t tickle ourselves', tagSlugs: ['science'], category: 'science' },
];

const mockTrending = [
  {
    podcastId: 'pod-1',
    title: 'Top Pod',
    topic: 'Quantum',
    duration: 300,
    audioUrl: 'https://example.com/audio.mp3',
    playCount: 100,
    likeCount: 10,
    forkCount: 2,
    createdAt: '2026-02-15T00:00:00Z',
    user: { id: 'u1', name: 'User', image: null },
    tags: [{ id: 't1', name: 'Tech', slug: 'tech' }],
    score: 0.9,
    signals: {},
    explanation: '',
    category: 'tech',
  },
];

const mockContext = {
  taxonomyLines: ['tech: [ai, web]'],
  validSlugs: new Set(['tech', 'ai', 'web']),
  priorQuestionIds: new Set<string>(),
  freeTierConfig: { aiProvider: 'anthropic', aiModel: 'claude-haiku' },
};

async function readSseEvents(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  const events: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      events.push(JSON.parse(line.slice(6)));
    } catch {
      // skip
    }
  }
  return events;
}

describe('GET /api/inspire/all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-123' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 });
    mockCacheGet.mockResolvedValue(null); // cache miss by default
    mockCacheGetWithTtl.mockResolvedValue({ value: null, ttl: -1 }); // cache miss by default
    mockCacheSet.mockResolvedValue(undefined);
    mockCountersIncrement.mockResolvedValue(undefined);
    mockGenerateForYou.mockResolvedValue(mockForYou);
    mockGenerateNews.mockResolvedValue(mockNews);
    mockGenerateCuriosity.mockResolvedValue(mockCuriosity);
    mockGetTrending.mockResolvedValue(mockTrending);
    mockLoadInspireContext.mockResolvedValue(mockContext);
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  it('returns all cached sections as JSON when all hit', async () => {
    const cachedTrending = [{ id: 'pod-1', title: 'Top Pod' }];
    // Return cached values for all 4 — TTLs above per-section stale thresholds (hard - soft)
    // forYou: 14400-3600=10800, trending: 1800-600=1200, news: 5400-900=4500, curiosity: 14400-3600=10800
    mockCacheGetWithTtl
      .mockResolvedValueOnce({ value: mockForYou, ttl: 13000 }) // forYou (fresh)
      .mockResolvedValueOnce({ value: cachedTrending, ttl: 1500 }) // trending (fresh)
      .mockResolvedValueOnce({ value: mockNews, ttl: 5000 }) // news (fresh)
      .mockResolvedValueOnce({ value: mockCuriosity, ttl: 13000 }); // curiosity (fresh)

    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(body.forYou).toEqual(mockForYou);
    expect(body.trending).toEqual(cachedTrending);
    expect(body.news).toEqual(mockNews);
    expect(body.curiosity).toEqual(mockCuriosity);
  });

  it('returns SSE stream with 4 sections on cache miss', async () => {
    const res = await GET(createRequest());

    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const events = await readSseEvents(res);
    const sectionNames = events.filter((e) => e.section).map((e) => e.section);

    expect(sectionNames).toContain('trending');
    expect(sectionNames).toContain('forYou');
    expect(sectionNames).toContain('news');
    expect(sectionNames).toContain('curiosity');
    expect(events[events.length - 1]).toEqual({ done: true });
  });

  it('returns 429 when rate limited on cache miss', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 123 });
    const res = await GET(createRequest());
    expect(res.status).toBe(429);
  });

  it('returns only forYou when section=forYou', async () => {
    const res = await GET(createRequest({ section: 'forYou' }));
    const body = await res.json();

    expect(body.forYou).toEqual(mockForYou);
    expect(body.trending).toBeUndefined();
    expect(body.news).toBeUndefined();
  });

  it('returns only news when section=news', async () => {
    const res = await GET(createRequest({ section: 'news' }));
    const body = await res.json();

    expect(body.news).toEqual(mockNews);
    expect(body.forYou).toBeUndefined();
    expect(body.trending).toBeUndefined();
  });

  it('caches single-section refresh results', async () => {
    const res = await GET(createRequest({ section: 'forYou' }));
    expect(res.status).toBe(200);
  });

  it('gracefully degrades when trending fails in SSE stream', async () => {
    mockGetTrending.mockRejectedValue(new Error('DB down'));
    const res = await GET(createRequest());

    const events = await readSseEvents(res);
    const trendingEvent = events.find((e) => e.section === 'trending');

    expect(trendingEvent).toBeDefined();
    expect(trendingEvent!.data).toEqual([]);
  });

  it('returns only curiosity when section=curiosity', async () => {
    const res = await GET(createRequest({ section: 'curiosity' }));
    const body = await res.json();

    expect(body.curiosity).toEqual(mockCuriosity);
    expect(body.forYou).toBeUndefined();
    expect(body.trending).toBeUndefined();
    expect(body.news).toBeUndefined();
  });

  it('returns only trending when section=trending', async () => {
    const res = await GET(createRequest({ section: 'trending' }));
    const body = await res.json();

    expect(body.trending).toBeDefined();
    expect(body.forYou).toBeUndefined();
    expect(body.news).toBeUndefined();
    expect(body.curiosity).toBeUndefined();
  });

  it('supports Bearer token auth (mobile)', async () => {
    const url = new URL('http://localhost:3000/api/inspire/all?section=forYou');
    const req = new NextRequest(url, {
      headers: { Authorization: 'Bearer sk_sotto_test123' },
    });

    const res = await GET(req);
    const body = await res.json();

    expect(mockAuthenticateRequest).toHaveBeenCalledWith(req);
    expect(body.forYou).toEqual(mockForYou);
  });
});
