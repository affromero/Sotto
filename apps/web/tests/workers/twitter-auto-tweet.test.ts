import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { AutoTweetPayload } from '@/lib/queue';

// ---- Mocks ----

const mockPrismaTwitterAutoTweetFindFirst = vi.fn();
const mockPrismaTwitterAutoTweetUpdate = vi.fn();
const mockPrismaPodcastFindUniqueOrThrow = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    twitterAutoTweet: {
      findFirst: (...args: unknown[]) => mockPrismaTwitterAutoTweetFindFirst(...args),
      update: (...args: unknown[]) => mockPrismaTwitterAutoTweetUpdate(...args),
    },
    podcast: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaPodcastFindUniqueOrThrow(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockPostTweet = vi.fn();

vi.mock('@/lib/twitter', () => ({
  postTweet: (...args: unknown[]) => mockPostTweet(...args),
}));

const mockGetTwitterConfig = vi.fn();

vi.mock('@/lib/twitter-config', () => ({
  getTwitterConfig: (...args: unknown[]) => mockGetTwitterConfig(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test ----

import { processAutoTweet } from '@/workers/twitter-auto-tweet.worker';

// ---- Helpers ----

function createMockJob(data: AutoTweetPayload): Job<AutoTweetPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<AutoTweetPayload>;
}

// ---- Tests ----

describe('processAutoTweet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTwitterConfig.mockResolvedValue({
      tweetTemplate: 'New on Sotto: {{title}}\n\n{{topic}}\n\nListen: {{url}}',
    });
  });

  it('skips when no pending auto-tweet record exists', async () => {
    mockPrismaTwitterAutoTweetFindFirst.mockResolvedValue(null);

    const job = createMockJob({ podcastId: 'pod-1', trigger: 'threshold' });
    await processAutoTweet(job);

    expect(mockPostTweet).not.toHaveBeenCalled();
  });

  it('posts a tweet with interpolated template and updates record on success', async () => {
    mockPrismaTwitterAutoTweetFindFirst.mockResolvedValue({
      id: 'at-1',
      podcastId: 'pod-1',
      trigger: 'threshold',
      status: 'pending',
    });
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
      title: 'AI Ethics Debate',
      topic: 'Exploring ethical implications of AI',
      slug: null,
      user: { handle: null },
    });
    mockPostTweet.mockResolvedValue('tweet-id-123');
    mockPrismaTwitterAutoTweetUpdate.mockResolvedValue({});

    const job = createMockJob({ podcastId: 'pod-1', trigger: 'threshold' });
    await processAutoTweet(job);

    expect(mockPostTweet).toHaveBeenCalledWith(
      expect.stringContaining('AI Ethics Debate')
    );
    expect(mockPostTweet).toHaveBeenCalledWith(
      expect.stringContaining('/podcast/pod-1')
    );
    expect(mockPrismaTwitterAutoTweetUpdate).toHaveBeenCalledWith({
      where: { id: 'at-1' },
      data: expect.objectContaining({
        tweetId: 'tweet-id-123',
        status: 'posted',
      }),
    });
  });

  it('truncates topic to 100 characters', async () => {
    const longTopic = 'A'.repeat(150);
    mockPrismaTwitterAutoTweetFindFirst.mockResolvedValue({
      id: 'at-2',
      status: 'pending',
    });
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
      title: 'Test',
      topic: longTopic,
      slug: null,
      user: { handle: null },
    });
    mockPostTweet.mockResolvedValue('tweet-id-456');
    mockPrismaTwitterAutoTweetUpdate.mockResolvedValue({});

    const job = createMockJob({ podcastId: 'pod-2', trigger: 'manual' });
    await processAutoTweet(job);

    const tweetText = mockPostTweet.mock.calls[0][0];
    // The topic in the tweet should be truncated to 97 chars + '...'
    expect(tweetText).toContain('A'.repeat(97) + '...');
  });

  it('marks record as failed on tweet posting error', async () => {
    mockPrismaTwitterAutoTweetFindFirst.mockResolvedValue({
      id: 'at-3',
      status: 'pending',
    });
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
      title: 'Test',
      topic: 'Test topic',
      slug: null,
      user: { handle: null },
    });
    mockPostTweet.mockRejectedValue(new Error('Twitter API error'));
    mockPrismaTwitterAutoTweetUpdate.mockResolvedValue({});

    const job = createMockJob({ podcastId: 'pod-3', trigger: 'threshold' });

    await expect(processAutoTweet(job)).rejects.toThrow('Twitter API error');

    expect(mockPrismaTwitterAutoTweetUpdate).toHaveBeenCalledWith({
      where: { id: 'at-3' },
      data: { status: 'failed', errorMessage: 'Twitter API error' },
    });
  });

  it('stores the full tweet text in the record', async () => {
    mockPrismaTwitterAutoTweetFindFirst.mockResolvedValue({
      id: 'at-4',
      status: 'pending',
    });
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
      title: 'My Podcast',
      topic: 'Short topic',
      slug: null,
      user: { handle: null },
    });
    mockPostTweet.mockResolvedValue('tweet-id-789');
    mockPrismaTwitterAutoTweetUpdate.mockResolvedValue({});

    const job = createMockJob({ podcastId: 'pod-4', trigger: 'manual' });
    await processAutoTweet(job);

    const updateCall = mockPrismaTwitterAutoTweetUpdate.mock.calls[0][0];
    expect(updateCall.data.tweetText).toContain('My Podcast');
    expect(updateCall.data.tweetText).toContain('Short topic');
  });
});
