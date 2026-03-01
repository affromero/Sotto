import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockPrismaPodcastFindUniqueOrThrow = vi.fn();
const mockPrismaTweetMentionUpdate = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaPodcastFindUniqueOrThrow(...args),
    },
    tweetMention: {
      update: (...args: unknown[]) => mockPrismaTweetMentionUpdate(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockReplyToTweet = vi.fn();

vi.mock('@/lib/twitter', () => ({
  replyToTweet: (...args: unknown[]) => mockReplyToTweet(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---- Import under test ----
import { processTwitterReply } from '@/workers/twitter-reply.worker';
import type { ReplyTwitterPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function createMockJob(data: ReplyTwitterPayload): Job<ReplyTwitterPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<ReplyTwitterPayload>;
}

// ---- Tests ----

describe('processTwitterReply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReplyToTweet.mockResolvedValue('reply-tweet-id-123');
  });

  describe('successful podcast replies', () => {
    it('posts reply with podcast title, duration, and link', async () => {
      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-001',
        tweetMentionId: 'mention-001',
        originalTweetId: 'tweet-123',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: 'Introduction to Quantum Computing',
        duration: 600,
        status: 'READY',
        slug: null,
        user: { handle: null },
      });

      const job = createMockJob(payload);
      await processTwitterReply(job);

      expect(mockReplyToTweet).toHaveBeenCalledWith(
        'tweet-123',
        expect.stringContaining('Your podcast is ready!')
      );
      expect(mockReplyToTweet).toHaveBeenCalledWith(
        'tweet-123',
        expect.stringContaining('Introduction to Quantum Computing')
      );
      expect(mockReplyToTweet).toHaveBeenCalledWith(
        'tweet-123',
        expect.stringContaining('(10 min)')
      );
      expect(mockReplyToTweet).toHaveBeenCalledWith(
        'tweet-123',
        expect.stringContaining('/podcast/podcast-001')
      );
    });

    it('updates TweetMention status to REPLIED on success', async () => {
      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-001',
        tweetMentionId: 'mention-001',
        originalTweetId: 'tweet-123',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: 'Test Podcast',
        duration: 300,
        status: 'READY',
        slug: null,
        user: { handle: null },
      });

      const job = createMockJob(payload);
      await processTwitterReply(job);

      expect(mockPrismaTweetMentionUpdate).toHaveBeenCalledWith({
        where: { id: 'mention-001' },
        data: { status: 'REPLIED', replyTweetId: 'reply-tweet-id-123' },
      });
    });

    it('includes reply tweet ID in update', async () => {
      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-002',
        tweetMentionId: 'mention-002',
        originalTweetId: 'tweet-456',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: 'Machine Learning Basics',
        duration: 480,
        status: 'READY',
        slug: null,
        user: { handle: null },
      });
      mockReplyToTweet.mockResolvedValue('new-reply-id');

      const job = createMockJob(payload);
      await processTwitterReply(job);

      expect(mockPrismaTweetMentionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ replyTweetId: 'new-reply-id' }),
        })
      );
    });
  });

  describe('title truncation', () => {
    it('truncates long titles to stay under 280 chars', async () => {
      const longTitle =
        'This is an extremely long podcast title that goes on and on and exceeds the normal character limits for tweets and needs to be truncated to fit within the 280 character limit imposed by Twitter while still including the podcast URL and duration information';

      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-003',
        tweetMentionId: 'mention-003',
        originalTweetId: 'tweet-789',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: longTitle,
        duration: 720,
        status: 'READY',
        slug: null,
        user: { handle: null },
      });

      const job = createMockJob(payload);
      await processTwitterReply(job);

      const replyCall = mockReplyToTweet.mock.calls[0];
      const replyText = replyCall[1] as string;

      expect(replyText.length).toBeLessThanOrEqual(280);
      expect(replyText).toContain('...');
    });

    it('does not truncate short titles', async () => {
      const shortTitle = 'Quick Overview';

      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-004',
        tweetMentionId: 'mention-004',
        originalTweetId: 'tweet-101',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: shortTitle,
        duration: 180,
        status: 'READY',
        slug: null,
        user: { handle: null },
      });

      const job = createMockJob(payload);
      await processTwitterReply(job);

      const replyCall = mockReplyToTweet.mock.calls[0];
      const replyText = replyCall[1] as string;

      expect(replyText).toContain(shortTitle);
      expect(replyText).not.toContain('...');
    });
  });

  describe('duration formatting', () => {
    it('formats duration in minutes', async () => {
      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-005',
        tweetMentionId: 'mention-005',
        originalTweetId: 'tweet-202',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: 'Test Podcast',
        duration: 540,
        status: 'READY',
        slug: null,
        user: { handle: null },
      });

      const job = createMockJob(payload);
      await processTwitterReply(job);

      expect(mockReplyToTweet).toHaveBeenCalledWith(
        'tweet-202',
        expect.stringContaining('(9 min)')
      );
    });

    it('rounds duration to nearest minute', async () => {
      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-006',
        tweetMentionId: 'mention-006',
        originalTweetId: 'tweet-303',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: 'Test Podcast',
        duration: 635,
        status: 'READY',
        slug: null,
        user: { handle: null },
      });

      const job = createMockJob(payload);
      await processTwitterReply(job);

      expect(mockReplyToTweet).toHaveBeenCalledWith(
        'tweet-303',
        expect.stringContaining('(11 min)')
      );
    });

    it('omits duration when zero', async () => {
      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-007',
        tweetMentionId: 'mention-007',
        originalTweetId: 'tweet-404',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: 'Test Podcast',
        duration: 0,
        status: 'READY',
        slug: null,
        user: { handle: null },
      });

      const job = createMockJob(payload);
      await processTwitterReply(job);

      const replyCall = mockReplyToTweet.mock.calls[0];
      const replyText = replyCall[1] as string;

      expect(replyText).not.toContain('min)');
    });

    it('omits duration when null', async () => {
      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-008',
        tweetMentionId: 'mention-008',
        originalTweetId: 'tweet-505',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: 'Test Podcast',
        duration: null,
        status: 'READY',
        slug: null,
        user: { handle: null },
      });

      const job = createMockJob(payload);
      await processTwitterReply(job);

      const replyCall = mockReplyToTweet.mock.calls[0];
      const replyText = replyCall[1] as string;

      expect(replyText).not.toContain('min)');
    });
  });

  describe('failed podcast handling', () => {
    it('handles FAILED podcast status with failure message', async () => {
      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-009',
        tweetMentionId: 'mention-009',
        originalTweetId: 'tweet-606',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: 'Failed Podcast',
        duration: null,
        status: 'FAILED',
        slug: null,
        user: { handle: null },
      });

      const job = createMockJob(payload);
      await processTwitterReply(job);

      expect(mockReplyToTweet).toHaveBeenCalledWith(
        'tweet-606',
        expect.stringContaining("Sorry, we couldn't generate your podcast")
      );
      expect(mockPrismaTweetMentionUpdate).toHaveBeenCalledWith({
        where: { id: 'mention-009' },
        data: { status: 'FAILED', replyTweetId: 'reply-tweet-id-123' },
      });
    });

    it('updates mention status to FAILED for failed podcast', async () => {
      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-010',
        tweetMentionId: 'mention-010',
        originalTweetId: 'tweet-707',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: 'Failed Podcast',
        duration: null,
        status: 'FAILED',
        slug: null,
        user: { handle: null },
      });

      const job = createMockJob(payload);
      await processTwitterReply(job);

      expect(mockPrismaTweetMentionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        })
      );
    });

    it('includes app URL in failure message', async () => {
      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-011',
        tweetMentionId: 'mention-011',
        originalTweetId: 'tweet-808',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: 'Failed Podcast',
        duration: null,
        status: 'FAILED',
        slug: null,
        user: { handle: null },
      });

      const job = createMockJob(payload);
      await processTwitterReply(job);

      const replyCall = mockReplyToTweet.mock.calls[0];
      const replyText = replyCall[1] as string;

      expect(replyText).toMatch(/https?:\/\/\S+/i);
    });
  });

  describe('mid-generation guard', () => {
    it('skips reply when podcast is mid-generation from retry', async () => {
      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-retry',
        tweetMentionId: 'mention-retry',
        originalTweetId: 'tweet-retry',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: 'Retrying Podcast',
        duration: null,
        status: 'EXTRACTING',
        slug: null,
        user: { handle: null },
      });

      const job = createMockJob(payload);
      await processTwitterReply(job);

      expect(mockReplyToTweet).not.toHaveBeenCalled();
      expect(mockPrismaTweetMentionUpdate).not.toHaveBeenCalled();
    });
  });

  describe('job progress updates', () => {
    it('reports monotonically increasing progress ending at 100', async () => {
      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-012',
        tweetMentionId: 'mention-012',
        originalTweetId: 'tweet-909',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: 'Progress Test',
        duration: 300,
        status: 'READY',
        slug: null,
        user: { handle: null },
      });

      const job = createMockJob(payload);
      await processTwitterReply(job);

      const calls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]);
      }
      expect(calls[calls.length - 1]).toBe(100);
    });
  });

  describe('complete reply format', () => {
    it('formats complete success reply correctly', async () => {
      const payload: ReplyTwitterPayload = {
        podcastId: 'podcast-final',
        tweetMentionId: 'mention-final',
        originalTweetId: 'tweet-final',
      };

      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        title: 'The History of the Internet',
        duration: 600,
        status: 'READY',
        slug: null,
        user: { handle: null },
      });

      const job = createMockJob(payload);
      await processTwitterReply(job);

      const replyText = mockReplyToTweet.mock.calls[0][1] as string;
      expect(replyText).toContain('Your podcast is ready!');
      expect(replyText).toContain('"The History of the Internet"');
      expect(replyText).toContain('(10 min)');
      expect(replyText).toContain('\n\nListen:');
      expect(replyText).toContain('/podcast/podcast-final');
    });
  });
});
