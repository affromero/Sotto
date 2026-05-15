import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { PollTwitterTrendsPayload } from '@/lib/queue';

// ---- Mocks ----

const mockPrismaTwitterAutoTweetCount = vi.fn();
const mockPrismaTwitterAutoTweetCreate = vi.fn();
const mockPrismaUserFindUnique = vi.fn();
const mockPrismaPodcastCreate = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    twitterAutoTweet: {
      count: (...args: unknown[]) => mockPrismaTwitterAutoTweetCount(...args),
      create: (...args: unknown[]) => mockPrismaTwitterAutoTweetCreate(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
    },
    podcast: {
      create: (...args: unknown[]) => mockPrismaPodcastCreate(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockSearchPopularTweets = vi.fn();

vi.mock('@/lib/twitter', () => ({
  searchPopularTweets: (...args: unknown[]) => mockSearchPopularTweets(...args),
}));

const mockGetTwitterConfig = vi.fn();

vi.mock('@/lib/twitter-config', () => ({
  getTwitterConfig: (...args: unknown[]) => mockGetTwitterConfig(...args),
}));

const mockParseTweetIntent = vi.fn();

vi.mock('@/lib/tweet-parser', () => ({
  parseTweetIntent: (...args: unknown[]) => mockParseTweetIntent(...args),
}));

const mockSelectVoicePair = vi.fn();

vi.mock('@/lib/elevenlabs', () => ({
  selectVoicePair: (...args: unknown[]) => mockSelectVoicePair(...args),
}));

const mockAddJob = vi.fn();

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  contentExtractionQueue: 'content-extraction-queue',
  JobType: {
    EXTRACT_CONTENT: 'EXTRACT_CONTENT',
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/slugify', () => ({
  generatePodcastSlug: vi.fn().mockResolvedValue('test-slug'),
}));

// ---- Import under test ----

import { processTrendPoll } from '@/workers/twitter-trend-poll.worker';

// ---- Helpers ----

function createMockJob(): Job<PollTwitterTrendsPayload> {
  return {
    data: {},
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<PollTwitterTrendsPayload>;
}

function makeTweet(
  id: string,
  text: string,
  likes = 100,
  retweets = 10,
  replies = 5,
  opts?: { referenced_tweets?: Array<{ type: 'retweeted' | 'quoted' | 'replied_to'; id: string }> }
) {
  return {
    id,
    text,
    author_id: `author-${id}`,
    created_at: '2025-01-01T00:00:00.000Z',
    public_metrics: {
      like_count: likes,
      retweet_count: retweets,
      reply_count: replies,
      quote_count: 0,
    },
    ...opts,
  };
}

function makeSearchResult(tweets: ReturnType<typeof makeTweet>[]) {
  const authorMap = new Map(
    tweets.map((t) => [t.author_id, { username: `user-${t.id}`, name: `User ${t.id}` }])
  );
  return { tweets, authorMap };
}

const DEFAULT_CONFIG = {
  autoTweetEnabled: false,
  minPlays: 50,
  trendPollingEnabled: true,
  trendPollIntervalMs: 7200000,
  maxTrendPodcastsPerDay: 3,
  trendSearchQueries: ['AI', 'science'],
  tweetTemplate: 'test',
};

// ---- Tests ----

describe('processTrendPoll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTwitterConfig.mockResolvedValue(DEFAULT_CONFIG);
    mockPrismaTwitterAutoTweetCount.mockResolvedValue(0);
    mockPrismaUserFindUnique.mockResolvedValue({ id: 'sotto-user-id' });
    mockSelectVoicePair.mockReturnValue({
      host: { id: 'host-v1' },
      expert: { id: 'expert-v1' },
    });
    mockParseTweetIntent.mockResolvedValue({
      title: 'Test Podcast',
      topic: 'Test topic',
      depth: 'intermediate',
      audienceLevel: 'general',
      tone: 'conversational',
      focusAreas: [],
      sourceUrl: null,
    });
    mockPrismaPodcastCreate.mockResolvedValue({ id: 'podcast-001' });
    mockPrismaTwitterAutoTweetCreate.mockResolvedValue({ id: 'at-1' });
  });

  it('skips when trend polling is disabled', async () => {
    mockGetTwitterConfig.mockResolvedValue({ ...DEFAULT_CONFIG, trendPollingEnabled: false });

    await processTrendPoll(createMockJob());

    expect(mockSearchPopularTweets).not.toHaveBeenCalled();
  });

  it('skips when daily limit is reached', async () => {
    mockPrismaTwitterAutoTweetCount.mockResolvedValue(3);

    await processTrendPoll(createMockJob());

    expect(mockSearchPopularTweets).not.toHaveBeenCalled();
  });

  it('skips when no tweets are found', async () => {
    mockSearchPopularTweets.mockResolvedValue(makeSearchResult([]));

    await processTrendPoll(createMockJob());

    expect(mockPrismaPodcastCreate).not.toHaveBeenCalled();
  });

  it('bails when @sotto user is not found', async () => {
    mockSearchPopularTweets.mockResolvedValue(makeSearchResult([makeTweet('t1', 'AI is amazing')]));
    mockPrismaUserFindUnique.mockResolvedValue(null);

    await processTrendPoll(createMockJob());

    expect(mockPrismaPodcastCreate).not.toHaveBeenCalled();
  });

  it('creates podcast and auto-tweet record for top trending tweet', async () => {
    mockSearchPopularTweets.mockResolvedValue(makeSearchResult([makeTweet('t1', 'AI is changing everything')]));

    await processTrendPoll(createMockJob());

    expect(mockPrismaPodcastCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'sotto-user-id',
        source: 'TWITTER',
        sourceTweetId: 't1',
        status: 'EXTRACTING',
        visibility: 'PUBLIC',
      }),
    });
    expect(mockPrismaTwitterAutoTweetCreate).toHaveBeenCalledWith({
      data: { podcastId: 'podcast-001', trigger: 'trend', status: 'pending' },
    });
    expect(mockAddJob).toHaveBeenCalledWith(
      'content-extraction-queue',
      'EXTRACT_CONTENT',
      expect.objectContaining({ podcastId: 'podcast-001', userId: 'sotto-user-id' })
    );
  });

  it('respects remaining daily budget', async () => {
    mockPrismaTwitterAutoTweetCount.mockResolvedValue(2); // only 1 left
    mockSearchPopularTweets.mockResolvedValue(makeSearchResult([
      makeTweet('t1', 'AI is revolutionizing quantum physics research', 200),
      makeTweet('t2', 'AI breakthroughs in marine biology are exciting', 150),
    ]));

    await processTrendPoll(createMockJob());

    expect(mockPrismaPodcastCreate).toHaveBeenCalledTimes(1);
  });

  it('deduplicates similar tweets by keyword overlap', async () => {
    // Two tweets with very similar content should be deduplicated
    mockSearchPopularTweets.mockResolvedValue(makeSearchResult([
      makeTweet('t1', 'AI transforming healthcare industry rapidly', 200),
      makeTweet('t2', 'AI transforming healthcare industry today', 150),
      makeTweet('t3', 'AI in quantum computing breaks new records', 120),
    ]));

    await processTrendPoll(createMockJob());

    // Should create 2 podcasts (t1 and t3), skipping t2 as duplicate of t1
    expect(mockPrismaPodcastCreate).toHaveBeenCalledTimes(2);
  });

  it('sorts by engagement score (likes + 2*retweets + replies)', async () => {
    mockSearchPopularTweets
      .mockResolvedValueOnce(makeSearchResult([makeTweet('low', 'AI research update this morning', 110, 5, 5)]))
      .mockResolvedValueOnce(makeSearchResult([makeTweet('high', 'Science breakthrough in fusion energy', 500, 100, 50)]));

    await processTrendPoll(createMockJob());

    // The first podcast created should be the high-engagement one
    const firstCreate = mockPrismaPodcastCreate.mock.calls[0][0];
    expect(firstCreate.data.sourceTweetId).toBe('high');
  });

  it('filters out retweets, zero-like tweets, and author-name-only matches', async () => {
    mockSearchPopularTweets.mockResolvedValue(makeSearchResult([
      // Good: original tweet with AI keyword and high engagement
      makeTweet('good', 'AI is changing everything we know', 200, 50, 20),
      // Bad: retweet (RT @ prefix + referenced_tweets)
      makeTweet('rt', 'RT @someone: AI is cool', 0, 3000, 0, { referenced_tweets: [{ type: 'retweeted', id: 'orig' }] }),
      // Bad: zero likes
      makeTweet('nolikes', 'AI thoughts from me today', 0, 5, 0),
      // Bad: keyword only in author name, not tweet text
      makeTweet('irrelevant', 'Arsenal vs Chelsea match tonight', 150, 50, 30),
      // Bad: below min engagement (score < 100)
      makeTweet('loweng', 'AI is neat I guess', 10, 1, 1),
    ]));

    await processTrendPoll(createMockJob());

    expect(mockPrismaPodcastCreate).toHaveBeenCalledTimes(1);
    expect(mockPrismaPodcastCreate.mock.calls[0][0].data.sourceTweetId).toBe('good');
  });

  it('searches all configured queries', async () => {
    mockSearchPopularTweets.mockResolvedValue(makeSearchResult([]));

    await processTrendPoll(createMockJob());

    expect(mockSearchPopularTweets).toHaveBeenCalledTimes(2);
    expect(mockSearchPopularTweets).toHaveBeenCalledWith('AI', 10);
    expect(mockSearchPopularTweets).toHaveBeenCalledWith('science', 10);
  });

  it('continues processing when one search query fails', async () => {
    mockSearchPopularTweets
      .mockRejectedValueOnce(new Error('Rate limited'))
      .mockResolvedValueOnce(makeSearchResult([makeTweet('t1', 'Science breakthrough topic about new discovery')]));

    await processTrendPoll(createMockJob());

    expect(mockPrismaPodcastCreate).toHaveBeenCalledTimes(1);
  });
});
