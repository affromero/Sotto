import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { AdminThreadToPodcastPayload } from '@/lib/queue';

// ---- Mocks ----

const mockPrismaUserFindUnique = vi.fn();
const mockPrismaPodcastCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  get prismaUnfiltered() { return this.prisma; },
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
    },
    podcast: {
      create: (...args: unknown[]) => mockPrismaPodcastCreate(...args),
    },
  },
}));

const mockGetTweet = vi.fn();
const mockGetThread = vi.fn();

vi.mock('@/lib/twitter', () => ({
  getTweet: (...args: unknown[]) => mockGetTweet(...args),
  getThread: (...args: unknown[]) => mockGetThread(...args),
}));

const mockParseTweetIntent = vi.fn();
const mockParseThreadIntent = vi.fn();

vi.mock('@/lib/tweet-parser', () => ({
  parseTweetIntent: (...args: unknown[]) => mockParseTweetIntent(...args),
  parseThreadIntent: (...args: unknown[]) => mockParseThreadIntent(...args),
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

import { processAdminThreadToPodcast } from '@/workers/admin-thread-to-podcast.worker';

// ---- Helpers ----

function createMockJob(data: AdminThreadToPodcastPayload): Job<AdminThreadToPodcastPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<AdminThreadToPodcastPayload>;
}

const DEFAULT_PARSED = {
  title: 'Thread Podcast',
  topic: 'Discussion topic',
  depth: 'intermediate',
  audienceLevel: 'general',
  tone: 'conversational',
  isDebate: false,
  focusAreas: [],
  sourceUrl: null,
  viewpoints: [],
};

// ---- Tests ----

describe('processAdminThreadToPodcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaUserFindUnique.mockResolvedValue({ id: 'sotto-user-id' });
    mockSelectVoicePair.mockReturnValue({
      host: { id: 'host-v1' },
      expert: { id: 'expert-v1' },
    });
    mockParseTweetIntent.mockResolvedValue(DEFAULT_PARSED);
    mockParseThreadIntent.mockResolvedValue(DEFAULT_PARSED);
    mockPrismaPodcastCreate.mockResolvedValue({ id: 'podcast-001' });
  });

  describe('URL parsing', () => {
    it('parses x.com tweet URLs', async () => {
      mockGetTweet.mockResolvedValue({
        id: '12345',
        text: 'Test tweet',
        author_id: 'author-1',
        conversation_id: '12345',
      });
      mockGetThread.mockResolvedValue(null);

      const job = createMockJob({
        tweetUrl: 'https://x.com/user/status/12345',
        adminUserId: 'admin-1',
      });
      await processAdminThreadToPodcast(job);

      expect(mockGetTweet).toHaveBeenCalledWith('12345');
    });

    it('parses twitter.com tweet URLs', async () => {
      mockGetTweet.mockResolvedValue({
        id: '67890',
        text: 'Test tweet',
        author_id: 'author-1',
        conversation_id: '67890',
      });
      mockGetThread.mockResolvedValue(null);

      const job = createMockJob({
        tweetUrl: 'https://twitter.com/user/status/67890',
        adminUserId: 'admin-1',
      });
      await processAdminThreadToPodcast(job);

      expect(mockGetTweet).toHaveBeenCalledWith('67890');
    });

    it('rejects invalid URLs', async () => {
      const job = createMockJob({
        tweetUrl: 'https://example.com/not-a-tweet',
        adminUserId: 'admin-1',
      });

      await expect(processAdminThreadToPodcast(job)).rejects.toThrow('Invalid tweet URL');
    });
  });

  describe('single tweet processing', () => {
    it('creates podcast from a single tweet (no thread)', async () => {
      mockGetTweet.mockResolvedValue({
        id: '111',
        text: 'Single tweet about AI',
        author_id: 'author-1',
        conversation_id: '111',
      });
      mockGetThread.mockResolvedValue({ rootTweet: {}, replies: [] });

      const job = createMockJob({
        tweetUrl: 'https://x.com/user/status/111',
        adminUserId: 'admin-1',
      });
      await processAdminThreadToPodcast(job);

      expect(mockParseTweetIntent).toHaveBeenCalledWith('Single tweet about AI');
      expect(mockParseThreadIntent).not.toHaveBeenCalled();
      expect(mockPrismaPodcastCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'sotto-user-id',
          source: 'TWITTER',
          sourceTweetId: '111',
          status: 'EXTRACTING',
          visibility: 'PUBLIC',
        }),
      });
    });
  });

  describe('thread processing', () => {
    it('uses parseThreadIntent when thread has 2+ replies', async () => {
      mockGetTweet.mockResolvedValue({
        id: '222',
        text: 'Thread starter',
        author_id: 'author-1',
        conversation_id: '222',
        created_at: '2025-01-01T00:00:00Z',
      });
      mockGetThread.mockResolvedValue({
        rootTweet: { text: 'Thread starter', authorUsername: 'user1' },
        replies: [
          { text: 'Reply 1', authorUsername: 'user2' },
          { text: 'Reply 2', authorUsername: 'user3' },
        ],
      });

      const job = createMockJob({
        tweetUrl: 'https://x.com/user/status/222',
        adminUserId: 'admin-1',
      });
      await processAdminThreadToPodcast(job);

      expect(mockParseThreadIntent).toHaveBeenCalled();
      expect(mockParseTweetIntent).not.toHaveBeenCalled();
    });

    it('sets longer duration for thread podcasts (15 vs 10 minutes)', async () => {
      mockGetTweet.mockResolvedValue({
        id: '333',
        text: 'Thread starter',
        author_id: 'author-1',
        conversation_id: '333',
        created_at: '2025-01-01T00:00:00Z',
      });
      mockGetThread.mockResolvedValue({
        rootTweet: { text: 'Thread starter', authorUsername: 'user1' },
        replies: [
          { text: 'Reply 1', authorUsername: 'user2' },
          { text: 'Reply 2', authorUsername: 'user3' },
        ],
      });

      const job = createMockJob({
        tweetUrl: 'https://x.com/user/status/333',
        adminUserId: 'admin-1',
      });
      await processAdminThreadToPodcast(job);

      expect(mockPrismaPodcastCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          discovery: {
            create: expect.objectContaining({
              durationTarget: 15,
            }),
          },
        }),
      });
    });
  });

  describe('error handling', () => {
    it('throws when tweet is not found', async () => {
      mockGetTweet.mockResolvedValue(null);

      const job = createMockJob({
        tweetUrl: 'https://x.com/user/status/999',
        adminUserId: 'admin-1',
      });

      await expect(processAdminThreadToPodcast(job)).rejects.toThrow('Tweet not found');
    });

    it('throws when @sotto user is missing', async () => {
      mockGetTweet.mockResolvedValue({
        id: '444',
        text: 'Test',
        author_id: 'a1',
        conversation_id: '444',
      });
      mockGetThread.mockResolvedValue(null);
      mockPrismaUserFindUnique.mockResolvedValue(null);

      const job = createMockJob({
        tweetUrl: 'https://x.com/user/status/444',
        adminUserId: 'admin-1',
      });

      await expect(processAdminThreadToPodcast(job)).rejects.toThrow('@sotto system account not found');
    });
  });

  describe('pipeline kick-off', () => {
    it('enqueues content extraction job after podcast creation', async () => {
      mockGetTweet.mockResolvedValue({
        id: '555',
        text: 'Test tweet for pipeline',
        author_id: 'author-1',
        conversation_id: '555',
      });
      mockGetThread.mockResolvedValue(null);

      const job = createMockJob({
        tweetUrl: 'https://x.com/user/status/555',
        adminUserId: 'admin-1',
      });
      await processAdminThreadToPodcast(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        'content-extraction-queue',
        'EXTRACT_CONTENT',
        expect.objectContaining({
          podcastId: 'podcast-001',
          userId: 'sotto-user-id',
        })
      );
    });

    it('updates job progress through all stages', async () => {
      mockGetTweet.mockResolvedValue({
        id: '666',
        text: 'Progress test',
        author_id: 'a1',
        conversation_id: '666',
      });
      mockGetThread.mockResolvedValue(null);

      const job = createMockJob({
        tweetUrl: 'https://x.com/user/status/666',
        adminUserId: 'admin-1',
      });
      await processAdminThreadToPodcast(job);

      const progressCalls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls;
      const values = progressCalls.map((c: number[]) => c[0]);
      // Verify monotonically increasing and ends at 100
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThan(values[i - 1]);
      }
      expect(values[values.length - 1]).toBe(100);
    });
  });
});
