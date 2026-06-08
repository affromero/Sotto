import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockPrismaPodcastFindUnique = vi.fn();
const mockPrismaTwitterAutoTweetFindFirst = vi.fn();
const mockPrismaTwitterAutoTweetCreate = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPrismaPodcastFindUnique(...args),
    },
    twitterAutoTweet: {
      findFirst: (...args: unknown[]) => mockPrismaTwitterAutoTweetFindFirst(...args),
      create: (...args: unknown[]) => mockPrismaTwitterAutoTweetCreate(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

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
  minPlays: 50,
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
    });

    await checkAutoTweetThreshold('pod-private');

    expect(mockPrismaTwitterAutoTweetCreate).not.toHaveBeenCalled();
  });

  it('skips when already auto-tweeted by threshold', async () => {
    mockPrismaPodcastFindUnique.mockResolvedValue({
      visibility: 'PUBLIC',
      playCount: 100,
    });
    mockPrismaTwitterAutoTweetFindFirst.mockResolvedValue({ id: 'existing-tweet' });

    await checkAutoTweetThreshold('pod-already');

    expect(mockPrismaTwitterAutoTweetCreate).not.toHaveBeenCalled();
  });

  it('skips when thresholds are not met', async () => {
    mockPrismaPodcastFindUnique.mockResolvedValue({
      visibility: 'PUBLIC',
      playCount: 5,
    });

    await checkAutoTweetThreshold('pod-low');

    expect(mockPrismaTwitterAutoTweetCreate).not.toHaveBeenCalled();
  });

  it('creates auto-tweet record and enqueues job when play threshold is met', async () => {
    mockPrismaPodcastFindUnique.mockResolvedValue({
      visibility: 'PUBLIC',
      playCount: 50,
    });
    mockPrismaTwitterAutoTweetCreate.mockResolvedValue({ id: 'new-tweet' });

    await checkAutoTweetThreshold('pod-played');

    expect(mockPrismaTwitterAutoTweetCreate).toHaveBeenCalledWith({
      data: { podcastId: 'pod-played', trigger: 'threshold', status: 'pending' },
    });
    expect(mockAddJob).toHaveBeenCalledWith('twitter-auto-tweet-queue', 'AUTO_TWEET', {
      podcastId: 'pod-played',
      trigger: 'threshold',
    });
  });

  it('triggers only on the play threshold', async () => {
    mockPrismaPodcastFindUnique.mockResolvedValue({
      visibility: 'PUBLIC',
      playCount: 50,
    });
    mockPrismaTwitterAutoTweetCreate.mockResolvedValue({ id: 'at-1' });

    await checkAutoTweetThreshold('pod-plays');

    expect(mockPrismaTwitterAutoTweetCreate).toHaveBeenCalled();
    expect(mockAddJob).toHaveBeenCalled();
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

    expect(mockAddJob).toHaveBeenCalledWith('twitter-auto-tweet-queue', 'AUTO_TWEET', {
      podcastId: 'pod-xyz',
      trigger: 'manual',
    });
  });
});
