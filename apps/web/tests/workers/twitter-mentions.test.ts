import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisExists = vi.fn();

vi.mock('@/lib/redis', () => ({
  getRedisClient: vi.fn(() => ({
    get: mockRedisGet,
    set: mockRedisSet,
    exists: mockRedisExists,
  })),
}));

const mockPrismaTweetMentionFindUnique = vi.fn();
const mockPrismaTweetMentionCreate = vi.fn();
const mockPrismaTweetMentionUpdate = vi.fn();
const mockPrismaAccountFindFirst = vi.fn();
const mockPrismaUserFindUniqueOrThrow = vi.fn();
const mockPrismaPodcastCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tweetMention: {
      findUnique: (...args: unknown[]) => mockPrismaTweetMentionFindUnique(...args),
      create: (...args: unknown[]) => mockPrismaTweetMentionCreate(...args),
      update: (...args: unknown[]) => mockPrismaTweetMentionUpdate(...args),
    },
    account: {
      findFirst: (...args: unknown[]) => mockPrismaAccountFindFirst(...args),
    },
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaUserFindUniqueOrThrow(...args),
    },
    podcast: {
      create: (...args: unknown[]) => mockPrismaPodcastCreate(...args),
    },
  },
}));

const mockGetMentions = vi.fn();
const mockGetTweet = vi.fn();
const mockReplyToTweet = vi.fn();

vi.mock('@/lib/twitter', () => ({
  getMentions: (...args: unknown[]) => mockGetMentions(...args),
  getTweet: (...args: unknown[]) => mockGetTweet(...args),
  replyToTweet: (...args: unknown[]) => mockReplyToTweet(...args),
}));

const mockParseTweetIntent = vi.fn();

vi.mock('@/lib/tweet-parser', () => ({
  parseTweetIntent: (...args: unknown[]) => mockParseTweetIntent(...args),
}));

const mockCanResolveAi = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/providers/ai', () => ({
  canResolveAi: (...args: unknown[]) => mockCanResolveAi(...args),
}));

const mockGetAiKey = vi.fn().mockResolvedValue(null);

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
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
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---- Import under test ----
import { processTwitterMentions } from '@/workers/twitter-mentions.worker';
import type { PollTwitterMentionsPayload } from '@/lib/queue';
import type { Job } from 'bullmq';
import type { TwitterTweet, TweetParseResult } from '@/types/twitter';

// ---- Helpers ----

function createMockJob(data: PollTwitterMentionsPayload): Job<PollTwitterMentionsPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<PollTwitterMentionsPayload>;
}

function createMockTweet(overrides?: Partial<TwitterTweet>): TwitterTweet {
  return {
    id: '1234567890',
    text: '@sottofm explain quantum physics',
    author_id: 'twitter-user-123',
    created_at: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

// ---- Tests ----

describe('processTwitterMentions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisExists.mockResolvedValue(0);
    mockGetMentions.mockResolvedValue([]);
    mockPrismaTweetMentionFindUnique.mockResolvedValue(null);
  });

  describe('mention polling', () => {
    it('skips processing when no new mentions', async () => {
      mockGetMentions.mockResolvedValue([]);
      const job = createMockJob({});

      await processTwitterMentions(job);

      expect(mockGetMentions).toHaveBeenCalledWith(undefined);
      expect(mockPrismaTweetMentionFindUnique).not.toHaveBeenCalled();
    });

    it('processes new mentions', async () => {
      const tweet = createMockTweet();
      mockGetMentions.mockResolvedValue([tweet]);
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: true,
        preferredHostVoiceId: null,
        preferredExpertVoiceId: null,
      });
      mockCanResolveAi.mockResolvedValue(true);
      mockParseTweetIntent.mockResolvedValue({
        topic: 'Quantum Physics',
        title: 'Understanding Quantum Mechanics',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'professional',
        focusAreas: [],
      });
      mockSelectVoicePair.mockReturnValue({
        host: { id: 'voice-host-1' },
        expert: { id: 'voice-expert-1' },
      });
      mockPrismaTweetMentionCreate.mockResolvedValue({ id: 'mention-001' });
      mockPrismaPodcastCreate.mockResolvedValue({
        id: 'podcast-001',
        discovery: { id: 'discovery-001' },
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockPrismaTweetMentionFindUnique).toHaveBeenCalledWith({
        where: { tweetId: tweet.id },
      });
    });

    it('updates Redis cursor after processing', async () => {
      const tweet1 = createMockTweet({ id: '100', created_at: '2026-01-15T10:00:00Z' });
      const tweet2 = createMockTweet({ id: '200', created_at: '2026-01-15T11:00:00Z' });
      mockGetMentions.mockResolvedValue([tweet1, tweet2]);
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: true,
        preferredHostVoiceId: null,
        preferredExpertVoiceId: null,
      });
      mockCanResolveAi.mockResolvedValue(true);
      mockParseTweetIntent.mockResolvedValue({
        topic: 'Test',
        title: 'Test',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'professional',
        focusAreas: [],
      });
      mockSelectVoicePair.mockReturnValue({
        host: { id: 'voice-host-1' },
        expert: { id: 'voice-expert-1' },
      });
      mockPrismaTweetMentionCreate.mockResolvedValue({ id: 'mention-001' });
      mockPrismaPodcastCreate.mockResolvedValue({
        id: 'podcast-001',
        discovery: { id: 'discovery-001' },
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockRedisSet).toHaveBeenCalledWith('twitter:last_processed_tweet_id', '200');
    });
  });

  describe('linked user with enabled Twitter', () => {
    it('creates podcast for linked user with enabled Twitter', async () => {
      const tweet = createMockTweet();
      mockGetMentions.mockResolvedValue([tweet]);
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: true,
        preferredHostVoiceId: null,
        preferredExpertVoiceId: null,
      });
      mockCanResolveAi.mockResolvedValue(true);
      const mockParseResult: TweetParseResult = {
        topic: 'Quantum Physics',
        title: 'Understanding Quantum Mechanics',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'professional',
        focusAreas: ['superposition', 'entanglement'],
        sourceUrl: 'https://example.com/quantum',
      };
      mockParseTweetIntent.mockResolvedValue(mockParseResult);
      mockSelectVoicePair.mockReturnValue({
        host: { id: 'voice-host-1' },
        expert: { id: 'voice-expert-1' },
      });
      mockPrismaTweetMentionCreate.mockResolvedValue({ id: 'mention-001' });
      mockPrismaPodcastCreate.mockResolvedValue({
        id: 'podcast-001',
        discovery: { id: 'discovery-001' },
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockPrismaPodcastCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-001',
          title: mockParseResult.title,
          topic: mockParseResult.topic,
          status: 'EXTRACTING',
          source: 'TWITTER',
          sourceTweetId: tweet.id,
          hostVoiceId: 'voice-host-1',
          expertVoiceId: 'voice-expert-1',
          visibility: 'PUBLIC',
          discovery: {
            create: {
              userId: 'user-001',
              topic: mockParseResult.topic,
              depth: mockParseResult.depth,
              audienceLevel: mockParseResult.audienceLevel,
              tone: mockParseResult.tone,
              focusAreas: mockParseResult.focusAreas,
              durationTarget: 10,
              sourceUrl: mockParseResult.sourceUrl,
            },
          },
        },
        include: { discovery: true },
      });

      expect(mockAddJob).toHaveBeenCalled();
    });
  });

  describe('user restrictions', () => {
    it('ignores mention when user has twitterEnabled=false', async () => {
      const tweet = createMockTweet();
      mockGetMentions.mockResolvedValue([tweet]);
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: false,
        preferredHostVoiceId: null,
        preferredExpertVoiceId: null,
      });
      mockPrismaTweetMentionCreate.mockResolvedValue({ id: 'mention-001' });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockPrismaTweetMentionCreate).toHaveBeenCalledWith({
        data: {
          tweetId: tweet.id,
          authorId: tweet.author_id,
          text: tweet.text,
          status: 'IGNORED',
          userId: 'user-001',
          errorMessage: 'Twitter integration disabled by user',
        },
      });
      expect(mockParseTweetIntent).not.toHaveBeenCalled();
      expect(mockPrismaPodcastCreate).not.toHaveBeenCalled();
    });

    it('ignores mention when no AI provider is configured', async () => {
      const tweet = createMockTweet();
      mockGetMentions.mockResolvedValue([tweet]);
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: true,
        preferredHostVoiceId: null,
        preferredExpertVoiceId: null,
      });
      mockCanResolveAi.mockResolvedValue(false);
      mockPrismaTweetMentionCreate.mockResolvedValue({ id: 'mention-001' });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockPrismaTweetMentionCreate).toHaveBeenCalledWith({
        data: {
          tweetId: tweet.id,
          authorId: tweet.author_id,
          text: tweet.text,
          status: 'IGNORED',
          userId: 'user-001',
          errorMessage: 'No AI provider configured (missing BYOK key)',
        },
      });
      expect(mockParseTweetIntent).not.toHaveBeenCalled();
      expect(mockPrismaPodcastCreate).not.toHaveBeenCalled();
    });
  });

  describe('deduplication', () => {
    it('deduplicates already-processed tweets', async () => {
      const tweet = createMockTweet();
      mockGetMentions.mockResolvedValue([tweet]);
      mockPrismaTweetMentionFindUnique.mockResolvedValue({
        id: 'existing-mention',
        tweetId: tweet.id,
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockPrismaTweetMentionFindUnique).toHaveBeenCalledWith({
        where: { tweetId: tweet.id },
      });
      expect(mockPrismaTweetMentionCreate).not.toHaveBeenCalled();
    });
  });

  describe('unlinked users', () => {
    it('sends CTA reply to unlinked users (first time only)', async () => {
      const tweet = createMockTweet();
      mockGetMentions.mockResolvedValue([tweet]);
      mockPrismaAccountFindFirst.mockResolvedValue(null);
      mockRedisExists.mockResolvedValue(0);
      mockReplyToTweet.mockResolvedValue('reply-tweet-id');

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockReplyToTweet).toHaveBeenCalledWith(
        tweet.id,
        expect.stringContaining('Sign up at')
      );
      expect(mockRedisSet).toHaveBeenCalledWith(`twitter:cta_sent:${tweet.author_id}`, '1');
    });

    it('does not send CTA to unlinked user if already sent', async () => {
      const tweet = createMockTweet();
      mockGetMentions.mockResolvedValue([tweet]);
      mockPrismaAccountFindFirst.mockResolvedValue(null);
      mockRedisExists.mockResolvedValue(1);

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockReplyToTweet).not.toHaveBeenCalled();
    });
  });

  describe('parent tweet handling', () => {
    it('fetches parent tweet when mention is a reply', async () => {
      const parentTweet = createMockTweet({ id: 'parent-123', text: 'Original tweet about AI' });
      const tweet = createMockTweet({
        id: 'reply-456',
        text: '@sottofm explain this',
        referenced_tweets: [{ type: 'replied_to', id: 'parent-123' }],
      });
      mockGetMentions.mockResolvedValue([tweet]);
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: true,
        preferredHostVoiceId: null,
        preferredExpertVoiceId: null,
      });
      mockCanResolveAi.mockResolvedValue(true);
      mockGetTweet.mockResolvedValue(parentTweet);
      mockParseTweetIntent.mockResolvedValue({
        topic: 'AI',
        title: 'Understanding AI',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'professional',
        focusAreas: [],
      });
      mockSelectVoicePair.mockReturnValue({
        host: { id: 'voice-host-1' },
        expert: { id: 'voice-expert-1' },
      });
      mockPrismaTweetMentionCreate.mockResolvedValue({ id: 'mention-001' });
      mockPrismaPodcastCreate.mockResolvedValue({
        id: 'podcast-001',
        discovery: { id: 'discovery-001' },
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockGetTweet).toHaveBeenCalledWith('parent-123');
      expect(mockParseTweetIntent).toHaveBeenCalledWith(tweet.text, parentTweet.text, undefined);
    });
  });

  describe('voice preferences', () => {
    it('uses user preferred voices when set', async () => {
      const tweet = createMockTweet();
      mockGetMentions.mockResolvedValue([tweet]);
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: true,
        preferredHostVoiceId: 'user-host-voice',
        preferredExpertVoiceId: 'user-expert-voice',
      });
      mockCanResolveAi.mockResolvedValue(true);
      mockParseTweetIntent.mockResolvedValue({
        topic: 'Test',
        title: 'Test',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'professional',
        focusAreas: [],
      });
      mockSelectVoicePair.mockReturnValue({
        host: { id: 'default-host' },
        expert: { id: 'default-expert' },
      });
      mockPrismaTweetMentionCreate.mockResolvedValue({ id: 'mention-001' });
      mockPrismaPodcastCreate.mockResolvedValue({
        id: 'podcast-001',
        discovery: { id: 'discovery-001' },
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockPrismaPodcastCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hostVoiceId: 'user-host-voice',
            expertVoiceId: 'user-expert-voice',
          }),
        })
      );
    });
  });
});
