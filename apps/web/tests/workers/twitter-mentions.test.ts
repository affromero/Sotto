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

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
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
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockGetMentions = vi.fn();
const mockGetTweet = vi.fn();
const mockGetThread = vi.fn();
const mockReplyToTweet = vi.fn();
const mockSendDirectMessage = vi.fn().mockResolvedValue(null);

vi.mock('@/lib/twitter', () => ({
  getMentions: (...args: unknown[]) => mockGetMentions(...args),
  getTweet: (...args: unknown[]) => mockGetTweet(...args),
  getThread: (...args: unknown[]) => mockGetThread(...args),
  replyToTweet: (...args: unknown[]) => mockReplyToTweet(...args),
  sendDirectMessage: (...args: unknown[]) => mockSendDirectMessage(...args),
}));

const mockParseTweetIntent = vi.fn();
const mockParseThreadIntent = vi.fn();

const mockResolveModelFromTweet = vi.fn().mockReturnValue({ aiModel: null, ttsProvider: null });

vi.mock('@/lib/tweet-parser', () => ({
  parseTweetIntent: (...args: unknown[]) => mockParseTweetIntent(...args),
  parseThreadIntent: (...args: unknown[]) => mockParseThreadIntent(...args),
  resolveModelFromTweet: (...args: unknown[]) => mockResolveModelFromTweet(...args),
}));

const mockCheckGenerationGate = vi.fn().mockResolvedValue({ allowed: true, reason: 'ok', freeGenerationsUsed: 0, freeGenerationsLimit: 3, isByokUser: true });
const mockTryIncrementFreeGeneration = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/generation-gate', () => ({
  checkGenerationGate: (...args: unknown[]) => mockCheckGenerationGate(...args),
  tryIncrementFreeGeneration: (...args: unknown[]) => mockTryIncrementFreeGeneration(...args),
}));

const mockGetFreeTierConfig = vi.fn().mockResolvedValue({ aiProvider: 'anthropic', aiModel: 'claude-haiku-4-5-20251001', ttsProvider: 'openai', generationLimit: 3, ttsAllocations: [], aiAllocations: [] });

vi.mock('@/lib/free-tier-config', () => ({
  getFreeTierConfig: (...args: unknown[]) => mockGetFreeTierConfig(...args),
}));

const mockResolveAutoModel = vi.fn().mockResolvedValue({
  aiProvider: 'groq',
  aiModel: 'llama-3.1-8b-instant',
  ttsProvider: 'kittentts',
  ttsModel: 'kitten-tts-mini-0.8',
  sttProvider: 'groq',
  sttModel: 'whisper-large-v3-turbo',
});

vi.mock('@/lib/auto-model-config', () => ({
  resolveAutoModel: (...args: unknown[]) => mockResolveAutoModel(...args),
}));

const mockGetAiKey = vi.fn().mockResolvedValue(null);
const mockHasByokKey = vi.fn().mockResolvedValue(false);

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
  hasByokKey: (...args: unknown[]) => mockHasByokKey(...args),
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

vi.mock('@/lib/providers/ai-registry', () => ({
  getModelRequiredPlan: vi.fn().mockReturnValue('FREE'),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockLookupParticipantCredentials = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/credential-lookup', () => ({
  lookupParticipantCredentials: (...args: unknown[]) => mockLookupParticipantCredentials(...args),
}));

const mockFormatThreadAsSourceText = vi.fn().mockReturnValue('## Twitter/X Thread Discussion\n\n### Thread Conversation:\n**Original post by @alice:** Root post');
const mockGetVerifiedParticipants = vi.fn().mockReturnValue([]);
vi.mock('@/lib/twitter-utils', () => ({
  formatThreadAsSourceText: (...args: unknown[]) => mockFormatThreadAsSourceText(...args),
  getVerifiedParticipants: (...args: unknown[]) => mockGetVerifiedParticipants(...args),
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
    mockGetMentions.mockResolvedValue({ tweets: [], mediaByKey: new Map() });
    mockGetThread.mockResolvedValue(null);
    mockPrismaTweetMentionFindUnique.mockResolvedValue(null);
    mockLookupParticipantCredentials.mockResolvedValue([]);
    mockGetVerifiedParticipants.mockReturnValue([]);
  });

  describe('mention polling', () => {
    it('skips processing when no new mentions', async () => {
      mockGetMentions.mockResolvedValue({ tweets: [], mediaByKey: new Map() });
      const job = createMockJob({});

      await processTwitterMentions(job);

      expect(mockGetMentions).toHaveBeenCalledWith(undefined);
      expect(mockPrismaTweetMentionFindUnique).not.toHaveBeenCalled();
    });

    it('processes new mentions', async () => {
      const tweet = createMockTweet();
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: true,
        voicePreferences: [],
        preferredTtsProvider: null,
        preferredTtsModel: null,
        preferredAiProvider: null,
        preferredAiModel: null,
      });
      mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', freeGenerationsUsed: 0, freeGenerationsLimit: 3, isByokUser: true });
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
      mockGetMentions.mockResolvedValue({ tweets: [tweet1, tweet2], mediaByKey: new Map() });
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: true,
        voicePreferences: [],
        preferredTtsProvider: null,
        preferredTtsModel: null,
        preferredAiProvider: null,
        preferredAiModel: null,
      });
      mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', freeGenerationsUsed: 0, freeGenerationsLimit: 3, isByokUser: true });
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
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: true,
        voicePreferences: [],
        preferredTtsProvider: null,
        preferredTtsModel: null,
        preferredAiProvider: null,
        preferredAiModel: null,
      });
      mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', freeGenerationsUsed: 0, freeGenerationsLimit: 3, isByokUser: true });
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
          voices: {
            createMany: {
              data: [
                { speaker: 'HOST', voiceId: 'voice-host-1' },
                { speaker: 'EXPERT', voiceId: 'voice-expert-1' },
              ],
            },
          },
          ttsProvider: undefined,
          ttsModel: undefined,
          aiModel: undefined,
          visibility: 'PUBLIC',
          discovery: {
            create: {
              userId: 'user-001',
              topic: mockParseResult.topic,
              depth: mockParseResult.depth,
              audienceLevel: mockParseResult.audienceLevel,
              audience: 'general',
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
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: false,
        voicePreferences: [],
        preferredTtsProvider: null,
        preferredTtsModel: null,
        preferredAiProvider: null,
        preferredAiModel: null,
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
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: true,
        voicePreferences: [],
        preferredTtsProvider: null,
        preferredTtsModel: null,
        preferredAiProvider: null,
        preferredAiModel: null,
      });
      mockCheckGenerationGate.mockResolvedValue({ allowed: false, reason: 'no_provider', freeGenerationsUsed: 0, freeGenerationsLimit: 3, isByokUser: false });
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
          errorMessage: 'No AI provider configured',
        },
      });
      expect(mockParseTweetIntent).not.toHaveBeenCalled();
      expect(mockPrismaPodcastCreate).not.toHaveBeenCalled();
    });
  });

  describe('deduplication', () => {
    it('deduplicates already-processed tweets', async () => {
      const tweet = createMockTweet();
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
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
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
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
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
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
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: true,
        voicePreferences: [],
        preferredTtsProvider: null,
        preferredTtsModel: null,
        preferredAiProvider: null,
        preferredAiModel: null,
      });
      mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', freeGenerationsUsed: 0, freeGenerationsLimit: 3, isByokUser: true });
      mockGetTweet.mockResolvedValue({ tweet: parentTweet, mediaByKey: new Map() });
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
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: true,
        voicePreferences: [
          { speaker: 'HOST', voiceId: 'user-host-voice' },
          { speaker: 'EXPERT', voiceId: 'user-expert-voice' },
        ],
        preferredTtsProvider: null,
        preferredTtsModel: null,
        preferredAiProvider: null,
        preferredAiModel: null,
      });
      mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', freeGenerationsUsed: 0, freeGenerationsLimit: 3, isByokUser: true });
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
            voices: {
              createMany: {
                data: [
                  { speaker: 'HOST', voiceId: 'user-host-voice' },
                  { speaker: 'EXPERT', voiceId: 'user-expert-voice' },
                ],
              },
            },
          }),
        })
      );
    });
  });

  describe('thread detection and routing', () => {
    function setupLinkedUser() {
      mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-001' });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterEnabled: true,
        voicePreferences: [],
        preferredTtsProvider: null,
        preferredTtsModel: null,
        preferredAiProvider: null,
        preferredAiModel: null,
      });
      mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', freeGenerationsUsed: 0, freeGenerationsLimit: 3, isByokUser: true });
      mockSelectVoicePair.mockReturnValue({
        host: { id: 'voice-host-1' },
        expert: { id: 'voice-expert-1' },
      });
      mockPrismaTweetMentionCreate.mockResolvedValue({ id: 'mention-001' });
      mockPrismaPodcastCreate.mockResolvedValue({
        id: 'podcast-001',
        discovery: { id: 'discovery-001' },
      });
    }

    it('uses single-tweet path when conversation_id equals tweet id (root mention)', async () => {
      const tweet = createMockTweet({
        conversation_id: '1234567890', // same as default tweet id
      });
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      setupLinkedUser();
      mockParseTweetIntent.mockResolvedValue({
        topic: 'Test',
        title: 'Test',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'professional',
        focusAreas: [],
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockGetThread).not.toHaveBeenCalled();
      expect(mockParseTweetIntent).toHaveBeenCalled();
      expect(mockParseThreadIntent).not.toHaveBeenCalled();
    });

    it('uses single-tweet path when conversation_id is missing', async () => {
      const tweet = createMockTweet(); // no conversation_id
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      setupLinkedUser();
      mockParseTweetIntent.mockResolvedValue({
        topic: 'Test',
        title: 'Test',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'professional',
        focusAreas: [],
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockGetThread).not.toHaveBeenCalled();
      expect(mockParseTweetIntent).toHaveBeenCalled();
    });

    it('fetches thread when conversation_id differs from tweet id', async () => {
      const tweet = createMockTweet({
        id: 'reply-in-thread',
        conversation_id: 'thread-root-id',
      });
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      setupLinkedUser();
      mockGetThread.mockResolvedValue({
        rootTweet: {
          id: 'thread-root-id',
          text: 'Root post',
          authorId: 'a1',
          authorUsername: 'alice',
          authorName: 'Alice',
          urls: [],
          createdAt: '2026-02-10T10:00:00Z',
        },
        replies: [
          { id: 'r1', text: 'Reply 1', authorId: 'a2', authorUsername: 'bob', authorName: 'Bob', urls: [], createdAt: '2026-02-10T10:05:00Z' },
          { id: 'r2', text: 'Reply 2', authorId: 'a3', authorUsername: 'carol', authorName: 'Carol', urls: [], createdAt: '2026-02-10T10:10:00Z' },
          { id: 'r3', text: 'Reply 3', authorId: 'a4', authorUsername: 'dave', authorName: 'Dave', urls: [], createdAt: '2026-02-10T10:15:00Z' },
        ],
        participantCount: 4,
        tweetCount: 4,
        isSelfAuthored: false,
      });
      mockParseThreadIntent.mockResolvedValue({
        topic: 'Thread Topic',
        title: 'Thread Discussion',
        depth: 'deep_dive',
        audienceLevel: 'intermediate',
        tone: 'socratic',
        focusAreas: ['topic-a'],
        isDebate: true,
        viewpoints: ['@alice argues X', '@bob argues Y'],
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockGetThread).toHaveBeenCalledWith('thread-root-id');
      expect(mockParseThreadIntent).toHaveBeenCalled();
      expect(mockParseTweetIntent).not.toHaveBeenCalled();
    });

    it('falls back to single-tweet when getThread returns null', async () => {
      const tweet = createMockTweet({
        id: 'reply-in-thread',
        conversation_id: 'thread-root-id',
      });
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      setupLinkedUser();
      mockGetThread.mockResolvedValue(null);
      mockParseTweetIntent.mockResolvedValue({
        topic: 'Test',
        title: 'Test',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'professional',
        focusAreas: [],
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockGetThread).toHaveBeenCalledWith('thread-root-id');
      expect(mockParseTweetIntent).toHaveBeenCalled();
      expect(mockParseThreadIntent).not.toHaveBeenCalled();
    });

    it('falls back to single-tweet when thread has fewer than 3 replies', async () => {
      const tweet = createMockTweet({
        id: 'reply-in-thread',
        conversation_id: 'thread-root-id',
      });
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      setupLinkedUser();
      mockGetThread.mockResolvedValue({
        rootTweet: {
          id: 'thread-root-id',
          text: 'Root',
          authorId: 'a1',
          authorUsername: 'alice',
          authorName: 'Alice',
          urls: [],
          createdAt: '2026-02-10T10:00:00Z',
        },
        replies: [
          { id: 'r1', text: 'Only reply', authorId: 'a2', authorUsername: 'bob', authorName: 'Bob', urls: [], createdAt: '2026-02-10T10:05:00Z' },
        ],
        participantCount: 2,
        tweetCount: 2,
        isSelfAuthored: false,
      });
      mockParseTweetIntent.mockResolvedValue({
        topic: 'Test',
        title: 'Test',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'professional',
        focusAreas: [],
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockParseTweetIntent).toHaveBeenCalled();
      expect(mockParseThreadIntent).not.toHaveBeenCalled();
    });

    it('sets durationTarget to 15 and includes sourceText for thread podcasts', async () => {
      const tweet = createMockTweet({
        id: 'reply-in-thread',
        conversation_id: 'thread-root-id',
      });
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      setupLinkedUser();
      mockGetThread.mockResolvedValue({
        rootTweet: {
          id: 'thread-root-id',
          text: 'Root post about climate',
          authorId: 'a1',
          authorUsername: 'alice',
          authorName: 'Alice',
          urls: [],
          createdAt: '2026-02-10T10:00:00Z',
        },
        replies: [
          { id: 'r1', text: 'Reply 1', authorId: 'a2', authorUsername: 'bob', authorName: 'Bob', urls: [], createdAt: '2026-02-10T10:05:00Z' },
          { id: 'r2', text: 'Reply 2', authorId: 'a3', authorUsername: 'carol', authorName: 'Carol', urls: [], createdAt: '2026-02-10T10:10:00Z' },
          { id: 'r3', text: 'Reply 3', authorId: 'a4', authorUsername: 'dave', authorName: 'Dave', urls: [], createdAt: '2026-02-10T10:15:00Z' },
        ],
        participantCount: 4,
        tweetCount: 4,
        isSelfAuthored: false,
      });
      mockParseThreadIntent.mockResolvedValue({
        topic: 'Climate Change',
        title: 'Climate Debate',
        depth: 'deep_dive',
        audienceLevel: 'intermediate',
        tone: 'professional',
        focusAreas: ['emissions'],
        isDebate: false,
        viewpoints: [],
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      // Check durationTarget = 15 for threads
      expect(mockPrismaPodcastCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            discovery: expect.objectContaining({
              create: expect.objectContaining({
                durationTarget: 15,
              }),
            }),
          }),
        })
      );

      // Check sourceText is passed to addJob
      expect(mockAddJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          sourceText: expect.stringContaining('Twitter/X Thread Discussion'),
        })
      );
    });

    it('sets tone to socratic when parsed.isDebate is true', async () => {
      const tweet = createMockTweet({
        id: 'reply-in-thread',
        conversation_id: 'thread-root-id',
      });
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      setupLinkedUser();
      mockGetThread.mockResolvedValue({
        rootTweet: {
          id: 'thread-root-id',
          text: 'Controversial take',
          authorId: 'a1',
          authorUsername: 'alice',
          authorName: 'Alice',
          urls: [],
          createdAt: '2026-02-10T10:00:00Z',
        },
        replies: [
          { id: 'r1', text: 'Disagree', authorId: 'a2', authorUsername: 'bob', authorName: 'Bob', urls: [], createdAt: '2026-02-10T10:05:00Z' },
          { id: 'r2', text: 'Agree', authorId: 'a3', authorUsername: 'carol', authorName: 'Carol', urls: [], createdAt: '2026-02-10T10:10:00Z' },
          { id: 'r3', text: '@sottofm podcast this', authorId: 'a4', authorUsername: 'dave', authorName: 'Dave', urls: [], createdAt: '2026-02-10T10:15:00Z' },
        ],
        participantCount: 4,
        tweetCount: 4,
        isSelfAuthored: false,
      });
      mockParseThreadIntent.mockResolvedValue({
        topic: 'Debate Topic',
        title: 'The Great Debate',
        depth: 'deep_dive',
        audienceLevel: 'intermediate',
        tone: 'professional', // original tone from Claude
        focusAreas: ['point-a'],
        isDebate: true,
        viewpoints: ['@alice for', '@bob against'],
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      // tone should be overridden to socratic
      expect(mockPrismaPodcastCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            discovery: expect.objectContaining({
              create: expect.objectContaining({
                tone: 'socratic',
              }),
            }),
          }),
        })
      );
    });

    it('root mention with replies fetches thread', async () => {
      const tweet = createMockTweet({
        conversation_id: '1234567890', // same as tweet id = root mention
        public_metrics: { retweet_count: 0, reply_count: 5, like_count: 10, quote_count: 0 },
      });
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      setupLinkedUser();
      mockGetThread.mockResolvedValue({
        rootTweet: { id: '1234567890', text: 'My thread', authorId: 'twitter-user-123', authorUsername: 'me', authorName: 'Me', urls: [], createdAt: '2026-02-10T10:00:00Z' },
        replies: [
          { id: 'r1', text: 'Part 2', authorId: 'twitter-user-123', authorUsername: 'me', authorName: 'Me', urls: [], createdAt: '2026-02-10T10:01:00Z' },
          { id: 'r2', text: 'Part 3', authorId: 'twitter-user-123', authorUsername: 'me', authorName: 'Me', urls: [], createdAt: '2026-02-10T10:02:00Z' },
        ],
        participantCount: 1,
        tweetCount: 3,
        isSelfAuthored: true,
      });
      mockParseThreadIntent.mockResolvedValue({
        topic: 'My Thread Topic',
        title: 'My Thread',
        depth: 'deep_dive',
        audienceLevel: 'intermediate',
        tone: 'professional',
        focusAreas: [],
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockGetThread).toHaveBeenCalledWith('1234567890');
      expect(mockParseThreadIntent).toHaveBeenCalled();
    });

    it('root mention with zero replies skips thread', async () => {
      const tweet = createMockTweet({
        conversation_id: '1234567890',
        public_metrics: { retweet_count: 5, reply_count: 0, like_count: 10, quote_count: 0 },
      });
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      setupLinkedUser();
      mockParseTweetIntent.mockResolvedValue({
        topic: 'Test',
        title: 'Test',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'professional',
        focusAreas: [],
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockGetThread).not.toHaveBeenCalled();
      expect(mockParseTweetIntent).toHaveBeenCalled();
    });

    it('self-authored thread with 1 reply takes thread path', async () => {
      const tweet = createMockTweet({
        id: 'reply-in-thread',
        conversation_id: 'thread-root-id',
      });
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      setupLinkedUser();
      mockGetThread.mockResolvedValue({
        rootTweet: { id: 'thread-root-id', text: 'My thoughts on AI', authorId: 'a1', authorUsername: 'alice', authorName: 'Alice', urls: [], createdAt: '2026-02-10T10:00:00Z' },
        replies: [
          { id: 'r1', text: 'Continued...', authorId: 'a1', authorUsername: 'alice', authorName: 'Alice', urls: [], createdAt: '2026-02-10T10:01:00Z' },
        ],
        participantCount: 1,
        tweetCount: 2,
        isSelfAuthored: true,
      });
      mockParseThreadIntent.mockResolvedValue({
        topic: 'AI Thoughts',
        title: 'My AI Thread',
        depth: 'deep_dive',
        audienceLevel: 'intermediate',
        tone: 'professional',
        focusAreas: [],
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockParseThreadIntent).toHaveBeenCalled();
      expect(mockParseTweetIntent).not.toHaveBeenCalled();
    });

    it('multi-participant thread still needs 3 replies', async () => {
      const tweet = createMockTweet({
        id: 'reply-in-thread',
        conversation_id: 'thread-root-id',
      });
      mockGetMentions.mockResolvedValue({ tweets: [tweet], mediaByKey: new Map() });
      setupLinkedUser();
      mockGetThread.mockResolvedValue({
        rootTweet: { id: 'thread-root-id', text: 'Discussion', authorId: 'a1', authorUsername: 'alice', authorName: 'Alice', urls: [], createdAt: '2026-02-10T10:00:00Z' },
        replies: [
          { id: 'r1', text: 'Reply 1', authorId: 'a2', authorUsername: 'bob', authorName: 'Bob', urls: [], createdAt: '2026-02-10T10:05:00Z' },
          { id: 'r2', text: 'Reply 2', authorId: 'a3', authorUsername: 'carol', authorName: 'Carol', urls: [], createdAt: '2026-02-10T10:10:00Z' },
        ],
        participantCount: 3,
        tweetCount: 3,
        isSelfAuthored: false,
      });
      mockParseTweetIntent.mockResolvedValue({
        topic: 'Test',
        title: 'Test',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'professional',
        focusAreas: [],
      });

      const job = createMockJob({});
      await processTwitterMentions(job);

      expect(mockParseTweetIntent).toHaveBeenCalled();
      expect(mockParseThreadIntent).not.toHaveBeenCalled();
    });
  });
});
