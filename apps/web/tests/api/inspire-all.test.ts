import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockGenerateForYou = vi.fn();
const mockGenerateNews = vi.fn();
const mockGetTrending = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock('@/lib/taste-quiz', () => ({
  generateForYouQuestions: (...args: unknown[]) => mockGenerateForYou(...args),
  generateNewsQuestions: (...args: unknown[]) => mockGenerateNews(...args),
}));

vi.mock('@/lib/recommendation-engine', () => ({
  getTrending: (...args: unknown[]) => mockGetTrending(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
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

describe('GET /api/inspire/all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: 'user-123' } });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 });
    mockGenerateForYou.mockResolvedValue(mockForYou);
    mockGenerateNews.mockResolvedValue(mockNews);
    mockGetTrending.mockResolvedValue(mockTrending);
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 123 });
    const res = await GET(createRequest());
    expect(res.status).toBe(429);
  });

  it('returns all three sections on full fetch', async () => {
    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.forYou).toEqual(mockForYou);
    expect(body.trending).toHaveLength(1);
    expect(body.trending[0].id).toBe('pod-1');
    expect(body.trending[0].status).toBe('READY');
    expect(body.trending[0].visibility).toBe('PUBLIC');
    expect(body.news).toEqual(mockNews);
  });

  it('calls generateNewsQuestions with ForYou topics for dedup', async () => {
    await GET(createRequest());
    expect(mockGenerateNews).toHaveBeenCalledWith(
      'user-123',
      6,
      ['AI and Music'],
      '1w',
      undefined
    );
  });

  it('returns only forYou when section=forYou', async () => {
    const res = await GET(createRequest({ section: 'forYou' }));
    const body = await res.json();

    expect(body.forYou).toEqual(mockForYou);
    expect(body.trending).toBeUndefined();
    expect(body.news).toBeUndefined();
    expect(mockGetTrending).not.toHaveBeenCalled();
    expect(mockGenerateNews).not.toHaveBeenCalled();
  });

  it('returns only news when section=news', async () => {
    const res = await GET(createRequest({ section: 'news' }));
    const body = await res.json();

    expect(body.news).toEqual(mockNews);
    expect(body.forYou).toBeUndefined();
    expect(body.trending).toBeUndefined();
    expect(mockGetTrending).not.toHaveBeenCalled();
    expect(mockGenerateForYou).not.toHaveBeenCalled();
  });

  it('gracefully degrades when trending fails', async () => {
    mockGetTrending.mockRejectedValue(new Error('DB down'));
    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.trending).toEqual([]);
    expect(body.forYou).toEqual(mockForYou);
    expect(body.news).toEqual(mockNews);
  });
});
