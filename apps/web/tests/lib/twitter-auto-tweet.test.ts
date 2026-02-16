import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockPrismaPodcastFindUnique = vi.fn();
const mockPrismaTwitterAutoTweetFindFirst = vi.fn();
const mockPrismaTwitterAutoTweetCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPrismaPodcastFindUnique(...args),
    },
    twitterAutoTweet: {
      findFirst: (...args: unknown[]) => mockPrismaTwitterAutoTweetFindFirst(...args),
      create: (...args: unknown[]) => mockPrismaTwitterAutoTweetCreate(...args),
    },
  },
}));

const mockGetTwitterConfig = vi.fn();

vi.mock('@/lib/twitter-config', () => ({
  getTwitterConfig: (...args: unknown[]) => mockGetTwitterConfig(...args),
}));

const mockAddJob = vi.fn();

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  twitterAutoTweetQueue: 'twitter-auto-tweet-queue',
  JobType: {
    AUTO_TWEET: 'AUTO_TWEET',
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test ----

import { checkAutoTweetThreshold, manualTweet } from '@/lib/twitter-auto-tweet';

// ---- Helpers ----

const DEFAULT_CONFIG = {
  autoTweetEnabled: true,
  minLikes: 10,
  minPlays: 50,
  minForks: 3,
  trendPollingEnabled: false,
  trendPollIntervalMs: 7200000,
  maxTrendPodcastsPerDay: 3,
  trendSearchQueries: [],
  tweetTemplate: 'test',
};

// ---- Tests ----

describe('checkAutoTweetThreshold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTwitterConfig.mockResolvedValue(DEFAULT_CONFIG);
    mockPrismaTwitterAutoTweetFindFirst.mockResolvedValue(null);
  });

  it('skips when auto-tweet is disabled', async () => {
    mockGetTwitterConfig.mockResolvedValue({ ...DEFAULT_CONFIG, autoTweetEnabled: false });

    await checkAutoTweetThreshold('pod-1');

    expect(mockPrismaPodcastFindUnique).not.toHaveBeenCalled();
  });

  it('skips when podcast is not found', async () => {
    mockPrismaPodcastFindUnique.mockResolvedValue(null);

    await checkAutoTweetThreshold('pod-nonexistent');

    expect(mockPrismaTwitterAutoTweetCreate).not.toHaveBeenCalled();
  });

  it('skips when podcast is not PUBLIC', async () => {
    mockPrismaPodcastFindUnique.mockResolvedValue({
      visibility: 'PRIVATE',
      playCount: 999,
      likeCount: 999,
      forkCount: 999,
    });

    await checkAutoTweetThreshold('pod-private');

    expect(mockPrismaTwitterAutoTweetCreate).not.toHaveBeenCalled();
  });

  it('skips when already auto-tweeted by threshold', async () => {
    mockPrismaPodcastFindUnique.mockResolvedValue({
      visibility: 'PUBLIC',
      playCount: 100,
      likeCount: 20,
      forkCount: 5,
    });
    mockPrismaTwitterAutoTweetFindFirst.mockResolvedValue({ id: 'existing-tweet' });

    await checkAutoTweetThreshold('pod-already');

    expect(mockPrismaTwitterAutoTweetCreate).not.toHaveBeenCalled();
  });

  it('skips when thresholds are not met', async () => {
    mockPrismaPodcastFindUnique.mockResolvedValue({
      visibility: 'PUBLIC',
      playCount: 5,
      likeCount: 2,
      forkCount: 0,
    });

    await checkAutoTweetThreshold('pod-low');

    expect(mockPrismaTwitterAutoTweetCreate).not.toHaveBeenCalled();
  });

  it('creates auto-tweet record and enqueues job when likes threshold met', async () => {
    mockPrismaPodcastFindUnique.mockResolvedValue({
      visibility: 'PUBLIC',
      playCount: 5,
      likeCount: 10,
      forkCount: 0,
    });
    mockPrismaTwitterAutoTweetCreate.mockResolvedValue({ id: 'new-tweet' });

    await checkAutoTweetThreshold('pod-liked');

    expect(mockPrismaTwitterAutoTweetCreate).toHaveBeenCalledWith({
      data: { podcastId: 'pod-liked', trigger: 'threshold', status: 'pending' },
    });
    expect(mockAddJob).toHaveBeenCalledWith(
      'twitter-auto-tweet-queue',
      'AUTO_TWEET',
      { podcastId: 'pod-liked', trigger: 'threshold' }
    );
  });

  it('triggers on plays threshold alone (OR logic)', async () => {
    mockPrismaPodcastFindUnique.mockResolvedValue({
      visibility: 'PUBLIC',
      playCount: 50,
      likeCount: 0,
      forkCount: 0,
    });
    mockPrismaTwitterAutoTweetCreate.mockResolvedValue({ id: 'at-1' });

    await checkAutoTweetThreshold('pod-plays');

    expect(mockPrismaTwitterAutoTweetCreate).toHaveBeenCalled();
    expect(mockAddJob).toHaveBeenCalled();
  });

  it('triggers on forks threshold alone (OR logic)', async () => {
    mockPrismaPodcastFindUnique.mockResolvedValue({
      visibility: 'PUBLIC',
      playCount: 0,
      likeCount: 0,
      forkCount: 3,
    });
    mockPrismaTwitterAutoTweetCreate.mockResolvedValue({ id: 'at-2' });

    await checkAutoTweetThreshold('pod-forks');

    expect(mockPrismaTwitterAutoTweetCreate).toHaveBeenCalled();
  });
});

describe('manualTweet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a manual auto-tweet record and returns its ID', async () => {
    mockPrismaTwitterAutoTweetCreate.mockResolvedValue({ id: 'manual-tweet-1' });

    const result = await manualTweet('pod-manual');

    expect(result).toBe('manual-tweet-1');
    expect(mockPrismaTwitterAutoTweetCreate).toHaveBeenCalledWith({
      data: { podcastId: 'pod-manual', trigger: 'manual', status: 'pending' },
    });
  });

  it('enqueues an AUTO_TWEET job with manual trigger', async () => {
    mockPrismaTwitterAutoTweetCreate.mockResolvedValue({ id: 'manual-tweet-2' });

    await manualTweet('pod-xyz');

    expect(mockAddJob).toHaveBeenCalledWith(
      'twitter-auto-tweet-queue',
      'AUTO_TWEET',
      { podcastId: 'pod-xyz', trigger: 'manual' }
    );
  });
});
