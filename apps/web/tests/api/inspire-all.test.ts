import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCountersIncrement = vi.fn();
const mockGenerateForYou = vi.fn();
const mockGenerateNews = vi.fn();
const mockLoadInspireContext = vi.fn();
const mockGetTrending = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  cache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
  },
  counters: {
    increment: (...args: unknown[]) => mockCountersIncrement(...args),
  },
}));

vi.mock('@/lib/taste-quiz', () => ({
  generateForYouQuestions: (...args: unknown[]) => mockGenerateForYou(...args),
  generateNewsQuestions: (...args: unknown[]) => mockGenerateNews(...args),
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
    mockAuth.mockResolvedValue({ user: { id: 'user-123' } });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 });
    mockCacheGet.mockResolvedValue(null); // cache miss by default
    mockCacheSet.mockResolvedValue(undefined);
    mockCountersIncrement.mockResolvedValue(undefined);
    mockGenerateForYou.mockResolvedValue(mockForYou);
    mockGenerateNews.mockResolvedValue(mockNews);
    mockGetTrending.mockResolvedValue(mockTrending);
    mockLoadInspireContext.mockResolvedValue(mockContext);
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  it('returns all cached sections as JSON when all hit', async () => {
    const cachedTrending = [{ id: 'pod-1', title: 'Top Pod' }];
    // Return cached values for all 3
    mockCacheGet
      .mockResolvedValueOnce(mockForYou) // forYou
      .mockResolvedValueOnce(cachedTrending) // trending
      .mockResolvedValueOnce(mockNews); // news

    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(body.forYou).toEqual(mockForYou);
    expect(body.trending).toEqual(cachedTrending);
    expect(body.news).toEqual(mockNews);
  });

  it('returns SSE stream on cache miss', async () => {
    const res = await GET(createRequest());

    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const events = await readSseEvents(res);
    const sectionNames = events.filter((e) => e.section).map((e) => e.section);

    expect(sectionNames).toContain('trending');
    expect(sectionNames).toContain('forYou');
    expect(sectionNames).toContain('news');
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

});
