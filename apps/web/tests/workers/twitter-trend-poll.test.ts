import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { PollTwitterTrendsPayload } from '@/lib/queue';

// ---- Mocks ----

const mockPrismaTwitterAutoTweetCount = vi.fn();
const mockPrismaTwitterAutoTweetCreate = vi.fn();
const mockPrismaUserFindUnique = vi.fn();
const mockPrismaPodcastCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
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
  },
}));

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

// ---- Import under test ----

import { processTrendPoll } from '@/workers/twitter-trend-poll.worker';

// ---- Helpers ----

function createMockJob(): Job<PollTwitterTrendsPayload> {
  return {
    data: {},
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<PollTwitterTrendsPayload>;
}

function makeTweet(id: string, text: string, likes = 100, retweets = 10, replies = 5) {
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
  };
}

const DEFAULT_CONFIG = {
  autoTweetEnabled: false,
  minLikes: 10,
  minPlays: 50,
  minForks: 3,
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
    mockSearchPopularTweets.mockResolvedValue([]);

    await processTrendPoll(createMockJob());

    expect(mockPrismaPodcastCreate).not.toHaveBeenCalled();
  });

  it('bails when @sotto user is not found', async () => {
    mockSearchPopularTweets.mockResolvedValue([makeTweet('t1', 'AI is amazing')]);
    mockPrismaUserFindUnique.mockResolvedValue(null);

    await processTrendPoll(createMockJob());

    expect(mockPrismaPodcastCreate).not.toHaveBeenCalled();
  });

  it('creates podcast and auto-tweet record for top trending tweet', async () => {
    mockSearchPopularTweets.mockResolvedValue([makeTweet('t1', 'AI is changing everything')]);

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
    mockSearchPopularTweets.mockResolvedValue([
      makeTweet('t1', 'First totally unique topic about quantum physics', 200),
      makeTweet('t2', 'Second completely different topic about marine biology', 150),
    ]);

    await processTrendPoll(createMockJob());

    expect(mockPrismaPodcastCreate).toHaveBeenCalledTimes(1);
  });

  it('deduplicates similar tweets by keyword overlap', async () => {
    // Two tweets with very similar content should be deduplicated
    mockSearchPopularTweets.mockResolvedValue([
      makeTweet('t1', 'Artificial intelligence transforming healthcare industry rapidly', 200),
      makeTweet('t2', 'Artificial intelligence transforming healthcare industry today', 150),
      makeTweet('t3', 'Quantum computing breaks new records in speed and accuracy', 100),
    ]);

    await processTrendPoll(createMockJob());

    // Should create 2 podcasts (t1 and t3), skipping t2 as duplicate of t1
    expect(mockPrismaPodcastCreate).toHaveBeenCalledTimes(2);
  });

  it('sorts by engagement score (likes + 2*retweets + replies)', async () => {
    mockSearchPopularTweets
      .mockResolvedValueOnce([makeTweet('low', 'Low engagement topic about weather', 10, 1, 1)])
      .mockResolvedValueOnce([makeTweet('high', 'High engagement topic about space exploration', 500, 100, 50)]);

    await processTrendPoll(createMockJob());

    // The first podcast created should be the high-engagement one
    const firstCreate = mockPrismaPodcastCreate.mock.calls[0][0];
    expect(firstCreate.data.sourceTweetId).toBe('high');
  });

  it('searches all configured queries', async () => {
    mockSearchPopularTweets.mockResolvedValue([]);

    await processTrendPoll(createMockJob());

    expect(mockSearchPopularTweets).toHaveBeenCalledTimes(2);
    expect(mockSearchPopularTweets).toHaveBeenCalledWith('AI', 10);
    expect(mockSearchPopularTweets).toHaveBeenCalledWith('science', 10);
  });

  it('continues processing when one search query fails', async () => {
    mockSearchPopularTweets
      .mockRejectedValueOnce(new Error('Rate limited'))
      .mockResolvedValueOnce([makeTweet('t1', 'Science breakthrough topic about new discovery')]);

    await processTrendPoll(createMockJob());

    expect(mockPrismaPodcastCreate).toHaveBeenCalledTimes(1);
  });
});
