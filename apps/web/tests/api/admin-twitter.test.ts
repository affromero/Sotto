import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockGetTwitterConfig = vi.fn();
const mockSetTwitterConfig = vi.fn();
const mockAddJob = vi.fn();
const mockTweetMentionCount = vi.fn();
const mockTweetMentionGroupBy = vi.fn();
const mockTwitterAutoTweetCount = vi.fn();
const mockTwitterAutoTweetGroupBy = vi.fn();
const mockTwitterAutoTweetFindMany = vi.fn();
const mockPodcastCount = vi.fn();
const mockPodcastFindMany = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockPodcastCreate = vi.fn();
const mockTwitterAutoTweetCreate = vi.fn();
const mockManualTweet = vi.fn();
const mockSearchPopularTweets = vi.fn();
const mockParseTweetIntent = vi.fn();
const mockSelectVoicePair = vi.fn();
const mockTwitterConfigUpdateSafeParse = vi.fn();
const mockThreadToPodcastSafeParse = vi.fn();
const mockManualTweetSchemaSafeParse = vi.fn();
const mockTrendGenerateSafeParse = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    tweetMention: {
      count: (...args: unknown[]) => mockTweetMentionCount(...args),
      groupBy: (...args: unknown[]) => mockTweetMentionGroupBy(...args),
    },
    twitterAutoTweet: {
      count: (...args: unknown[]) => mockTwitterAutoTweetCount(...args),
      groupBy: (...args: unknown[]) => mockTwitterAutoTweetGroupBy(...args),
      findMany: (...args: unknown[]) => mockTwitterAutoTweetFindMany(...args),
      create: (...args: unknown[]) => mockTwitterAutoTweetCreate(...args),
    },
    podcast: {
      count: (...args: unknown[]) => mockPodcastCount(...args),
      findMany: (...args: unknown[]) => mockPodcastFindMany(...args),
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      create: (...args: unknown[]) => mockPodcastCreate(...args),
    },
  },
}));

vi.mock('@/lib/twitter-config', () => ({
  getTwitterConfig: (...args: unknown[]) => mockGetTwitterConfig(...args),
  setTwitterConfig: (...args: unknown[]) => mockSetTwitterConfig(...args),
}));

vi.mock('@/lib/validations', () => ({
  twitterConfigUpdateSchema: {
    safeParse: (...args: unknown[]) => mockTwitterConfigUpdateSafeParse(...args),
  },
  threadToPodcastSchema: {
    safeParse: (...args: unknown[]) => mockThreadToPodcastSafeParse(...args),
  },
  manualTweetSchema: {
    safeParse: (...args: unknown[]) => mockManualTweetSchemaSafeParse(...args),
  },
  trendGenerateSchema: {
    safeParse: (...args: unknown[]) => mockTrendGenerateSafeParse(...args),
  },
}));

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { ADMIN_THREAD_TO_PODCAST: 'ADMIN_THREAD_TO_PODCAST', EXTRACT_CONTENT: 'EXTRACT_CONTENT' },
  adminThreadToPodcastQueue: 'admin-thread-to-podcast-queue',
  contentExtractionQueue: 'content-extraction-queue',
}));

vi.mock('@/lib/twitter-auto-tweet', () => ({
  manualTweet: (...args: unknown[]) => mockManualTweet(...args),
}));

vi.mock('@/lib/twitter', () => ({
  searchPopularTweets: (...args: unknown[]) => mockSearchPopularTweets(...args),
}));

vi.mock('@/lib/tweet-parser', () => ({
  parseTweetIntent: (...args: unknown[]) => mockParseTweetIntent(...args),
}));

vi.mock('@/lib/elevenlabs', () => ({
  selectVoicePair: (...args: unknown[]) => mockSelectVoicePair(...args),
}));

vi.mock('date-fns', () => ({
  subDays: vi.fn((date: Date, days: number) => new Date(date.getTime() - days * 86400000)),
  startOfDay: vi.fn((date: Date) => date),
}));

import { GET as getConfig, PATCH as patchConfig } from '@/app/api/admin/twitter/config/route';
import { POST as postThreadToPodcast } from '@/app/api/admin/twitter/thread-to-podcast/route';
import { GET as getAutoTweet, POST as postAutoTweet } from '@/app/api/admin/twitter/auto-tweet/route';
import { GET as getAnalytics } from '@/app/api/admin/twitter/analytics/route';
import { GET as getTrends, POST as postTrends } from '@/app/api/admin/twitter/trends/route';

function mockAdmin() {
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } });
  mockUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
}

function mockNonAdmin() {
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
  mockUserFindUnique.mockResolvedValue({ role: 'USER' });
}

function createRequest(url: string, body?: Record<string, unknown>): NextRequest {
  const reqUrl = new URL(`http://localhost:3000${url}`);
  if (body) {
    return new NextRequest(reqUrl, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new NextRequest(reqUrl);
}

// --- Twitter Config ---

describe('GET /api/admin/twitter/config', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    const response = await getConfig();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it('returns 403 when not admin', async () => {
    mockNonAdmin();
    const response = await getConfig();
    expect(response.status).toBe(403);
  });

  it('returns config when admin', async () => {
    mockAdmin();
    const config = { enabled: true, pollInterval: 60 };
    mockGetTwitterConfig.mockResolvedValue(config);

    const response = await getConfig();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(config);
  });
});

describe('PATCH /api/admin/twitter/config', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    const request = createRequest('/api/admin/twitter/config', { enabled: false });
    const response = await patchConfig(request);
    expect(response.status).toBe(403);
  });

  it('returns 400 for invalid body', async () => {
    mockAdmin();
    mockTwitterConfigUpdateSafeParse.mockReturnValue({
      success: false,
      error: { flatten: () => ({ fieldErrors: { enabled: ['Invalid'] } }) },
    });

    const request = createRequest('/api/admin/twitter/config', { bad: 'data' });
    const response = await patchConfig(request);
    expect(response.status).toBe(400);
  });

  it('updates config successfully', async () => {
    mockAdmin();
    mockTwitterConfigUpdateSafeParse.mockReturnValue({
      success: true,
      data: { enabled: false },
    });
    mockSetTwitterConfig.mockResolvedValue(undefined);
    const updated = { enabled: false, pollInterval: 60 };
    mockGetTwitterConfig.mockResolvedValue(updated);

    const request = createRequest('/api/admin/twitter/config', { enabled: false });
    const response = await patchConfig(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(updated);
  });
});

// --- Thread to Podcast ---

describe('POST /api/admin/twitter/thread-to-podcast', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    const request = createRequest('/api/admin/twitter/thread-to-podcast', { tweetUrl: 'https://x.com/test/123' });
    const response = await postThreadToPodcast(request);
    expect(response.status).toBe(403);
  });

  it('returns 403 when not admin', async () => {
    mockNonAdmin();
    const request = createRequest('/api/admin/twitter/thread-to-podcast', { tweetUrl: 'https://x.com/test/123' });
    const response = await postThreadToPodcast(request);
    expect(response.status).toBe(403);
  });

  it('returns 400 for invalid body', async () => {
    mockAdmin();
    mockThreadToPodcastSafeParse.mockReturnValue({
      success: false,
      error: { flatten: () => ({ fieldErrors: {} }) },
    });

    const request = createRequest('/api/admin/twitter/thread-to-podcast', {});
    const response = await postThreadToPodcast(request);
    expect(response.status).toBe(400);
  });

  it('queues job successfully', async () => {
    mockAdmin();
    mockThreadToPodcastSafeParse.mockReturnValue({
      success: true,
      data: { tweetUrl: 'https://x.com/test/status/123' },
    });
    mockAddJob.mockResolvedValue({ id: 'job-1' });

    const request = createRequest('/api/admin/twitter/thread-to-podcast', { tweetUrl: 'https://x.com/test/status/123' });
    const response = await postThreadToPodcast(request);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ jobId: 'job-1' });
  });
});

// --- Auto Tweet ---

describe('GET /api/admin/twitter/auto-tweet', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    const request = createRequest('/api/admin/twitter/auto-tweet');
    const response = await getAutoTweet(request);
    expect(response.status).toBe(403);
  });

  it('returns auto-tweets list when admin', async () => {
    mockAdmin();
    const autoTweets = [{ id: 'at-1', status: 'posted' }];
    mockTwitterAutoTweetFindMany.mockResolvedValue(autoTweets);
    mockTwitterAutoTweetCount.mockResolvedValue(1);

    const request = createRequest('/api/admin/twitter/auto-tweet');
    const response = await getAutoTweet(request);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.autoTweets).toEqual(autoTweets);
    expect(body.total).toBe(1);
  });
});

describe('POST /api/admin/twitter/auto-tweet', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    const request = createRequest('/api/admin/twitter/auto-tweet', { podcastId: 'pod-1' });
    const response = await postAutoTweet(request);
    expect(response.status).toBe(403);
  });

  it('returns 400 for invalid body', async () => {
    mockAdmin();
    mockManualTweetSchemaSafeParse.mockReturnValue({
      success: false,
      error: { flatten: () => ({ fieldErrors: {} }) },
    });

    const request = createRequest('/api/admin/twitter/auto-tweet', {});
    const response = await postAutoTweet(request);
    expect(response.status).toBe(400);
  });

  it('returns 404 when podcast not found', async () => {
    mockAdmin();
    mockManualTweetSchemaSafeParse.mockReturnValue({
      success: true,
      data: { podcastId: 'pod-1' },
    });
    mockPodcastFindUnique.mockResolvedValue(null);

    const request = createRequest('/api/admin/twitter/auto-tweet', { podcastId: 'pod-1' });
    const response = await postAutoTweet(request);
    expect(response.status).toBe(404);
  });

  it('returns 400 when podcast is not READY', async () => {
    mockAdmin();
    mockManualTweetSchemaSafeParse.mockReturnValue({
      success: true,
      data: { podcastId: 'pod-1' },
    });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', status: 'PENDING', visibility: 'PUBLIC' });

    const request = createRequest('/api/admin/twitter/auto-tweet', { podcastId: 'pod-1' });
    const response = await postAutoTweet(request);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('READY');
  });

  it('tweets successfully when podcast is READY', async () => {
    mockAdmin();
    mockManualTweetSchemaSafeParse.mockReturnValue({
      success: true,
      data: { podcastId: 'pod-1' },
    });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1', status: 'READY', visibility: 'PUBLIC' });
    mockManualTweet.mockResolvedValue('tweet-id-123');

    const request = createRequest('/api/admin/twitter/auto-tweet', { podcastId: 'pod-1' });
    const response = await postAutoTweet(request);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'tweet-id-123' });
  });
});

// --- Analytics ---

describe('GET /api/admin/twitter/analytics', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    const response = await getAnalytics();
    expect(response.status).toBe(403);
  });

  it('returns 403 when not admin', async () => {
    mockNonAdmin();
    const response = await getAnalytics();
    expect(response.status).toBe(403);
  });

  it('returns analytics data when admin', async () => {
    mockAdmin();
    mockTweetMentionCount
      .mockResolvedValueOnce(50)   // total
      .mockResolvedValueOnce(10);  // recent
    mockTweetMentionGroupBy.mockResolvedValue([
      { status: 'PROCESSED', _count: { id: 40 } },
      { status: 'PENDING', _count: { id: 10 } },
    ]);
    mockTwitterAutoTweetCount.mockResolvedValue(20);
    mockTwitterAutoTweetGroupBy.mockResolvedValue([
      { status: 'posted', _count: { id: 15 } },
    ]);
    mockTwitterAutoTweetFindMany.mockResolvedValue([]);
    mockPodcastCount
      .mockResolvedValueOnce(30)  // totalFromTwitter
      .mockResolvedValueOnce(25); // successful
    mockPodcastFindMany.mockResolvedValue([]);

    const response = await getAnalytics();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mentions.total).toBe(50);
    expect(body.autoTweets.total).toBe(20);
    expect(body.podcasts.totalFromTwitter).toBe(30);
    expect(body.podcasts.successRate).toBe(83);
  });
});

// --- Trends ---

describe('GET /api/admin/twitter/trends', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    const response = await getTrends();
    expect(response.status).toBe(403);
  });

  it('returns trends when admin', async () => {
    mockAdmin();
    mockGetTwitterConfig.mockResolvedValue({ trendSearchQueries: ['AI podcasts'] });
    mockSearchPopularTweets.mockResolvedValue([
      { id: 't1', text: 'Great podcast', public_metrics: { like_count: 100, retweet_count: 50, reply_count: 10 } },
    ]);

    const response = await getTrends();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.trends).toHaveLength(1);
    expect(body.trends[0].query).toBe('AI podcasts');
  });
});

describe('POST /api/admin/twitter/trends', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    const request = createRequest('/api/admin/twitter/trends', { tweetText: 'test' });
    const response = await postTrends(request);
    expect(response.status).toBe(403);
  });

  it('returns 400 for invalid body', async () => {
    mockAdmin();
    mockTrendGenerateSafeParse.mockReturnValue({
      success: false,
      error: { flatten: () => ({ fieldErrors: {} }) },
    });

    const request = createRequest('/api/admin/twitter/trends', {});
    const response = await postTrends(request);
    expect(response.status).toBe(400);
  });

  it('returns 404 when @sotto account not found', async () => {
    mockAdmin();
    mockTrendGenerateSafeParse.mockReturnValue({
      success: true,
      data: { tweetText: 'AI trends', tweetId: 't1' },
    });
    // First call returns ADMIN role, second returns null for sotto user
    mockUserFindUnique
      .mockResolvedValueOnce({ role: 'ADMIN' })
      .mockResolvedValueOnce(null);

    const request = createRequest('/api/admin/twitter/trends', { tweetText: 'AI trends' });
    const response = await postTrends(request);
    expect(response.status).toBe(404);
  });

  it('creates podcast from trend successfully', async () => {
    mockAdmin();
    mockTrendGenerateSafeParse.mockReturnValue({
      success: true,
      data: { tweetText: 'AI trends', tweetId: 't1' },
    });
    mockUserFindUnique
      .mockResolvedValueOnce({ role: 'ADMIN' })
      .mockResolvedValueOnce({ id: 'sotto-id' });
    mockParseTweetIntent.mockResolvedValue({
      title: 'AI Trends',
      topic: 'AI',
      depth: 'intermediate',
      audienceLevel: 'general',
      tone: 'conversational',
      focusAreas: ['AI'],
      sourceUrl: null,
    });
    mockSelectVoicePair.mockReturnValue({
      host: { id: 'voice-1' },
      expert: { id: 'voice-2' },
    });
    mockPodcastCreate.mockResolvedValue({ id: 'pod-1' });
    mockTwitterAutoTweetCreate.mockResolvedValue({ id: 'at-1' });
    mockAddJob.mockResolvedValue({ id: 'job-1' });

    const request = createRequest('/api/admin/twitter/trends', { tweetText: 'AI trends', tweetId: 't1' });
    const response = await postTrends(request);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ podcastId: 'pod-1' });
  });
});
