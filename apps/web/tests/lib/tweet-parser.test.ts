import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockGenerateResponse = vi.fn();

vi.mock('@/lib/llm', () => ({
  generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
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
import { parseTweetIntent, parseThreadIntent, resolveModelFromTweet } from '@/lib/tweet-parser';
import type { TweetParseResult, ThreadData, ThreadTweet } from '@/types/twitter';

// ---- Tests ----

describe('parseTweetIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic parsing', () => {
    it('parses a simple topic tweet into TweetParseResult', async () => {
      const mockResult: TweetParseResult = {
        topic: 'Quantum Computing Basics',
        title: 'Introduction to Quantum Computing',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'professional',
        focusAreas: ['qubits', 'superposition'],
        audience: 'general',
        durationTarget: 10,
        sourceUrl: undefined,
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResult),
        inputTokens: 100,
        outputTokens: 150,
      });

      const result = await parseTweetIntent(
        '@sottofm explain quantum computing basics'
      );

      expect(result).toEqual(mockResult);
    });

    it('includes parent tweet text when provided', async () => {
      const mockResult: TweetParseResult = {
        topic: 'AI Ethics in Healthcare',
        title: 'Ethical Considerations for AI in Medicine',
        depth: 'deep_dive',
        audienceLevel: 'expert',
        tone: 'professional',
        focusAreas: ['bias', 'privacy'],
        audience: 'general',
        durationTarget: 15,
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResult),
        inputTokens: 120,
        outputTokens: 180,
      });

      const tweetText = '@sottofm can you elaborate on this?';
      const parentTweetText = 'AI is changing healthcare rapidly';

      const result = await parseTweetIntent(tweetText, parentTweetText);

      expect(result).toEqual(mockResult);
    });
  });

  describe('JSON code fence handling', () => {
    it('handles Claude returning JSON wrapped in code fences', async () => {
      const mockResult: TweetParseResult = {
        topic: 'Blockchain Technology',
        title: 'Blockchain 101',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        tone: 'casual',
        focusAreas: ['cryptocurrency', 'smart contracts'],
        audience: 'general',
        durationTarget: 5,
      };

      mockGenerateResponse.mockResolvedValue({
        content: '```json\n' + JSON.stringify(mockResult) + '\n```',
        inputTokens: 80,
        outputTokens: 120,
      });

      const result = await parseTweetIntent('@sottofm blockchain basics');

      expect(result).toEqual(mockResult);
    });

    it('handles code fences without json language marker', async () => {
      const mockResult: TweetParseResult = {
        topic: 'Machine Learning',
        title: 'ML Fundamentals',
        depth: 'standard',
        audienceLevel: 'intermediate',
        tone: 'professional',
        focusAreas: ['neural networks'],
        audience: 'general',
        durationTarget: 10,
      };

      mockGenerateResponse.mockResolvedValue({
        content: '```\n' + JSON.stringify(mockResult) + '\n```',
        inputTokens: 90,
        outputTokens: 130,
      });

      const result = await parseTweetIntent('@sottofm machine learning intro');

      expect(result).toEqual(mockResult);
    });

    it('handles JSON with whitespace inside code fences', async () => {
      const mockResult: TweetParseResult = {
        topic: 'Space Exploration',
        title: 'Journey to Mars',
        depth: 'deep_dive',
        audienceLevel: 'expert',
        tone: 'professional',
        focusAreas: ['propulsion', 'life support'],
        audience: 'general',
        durationTarget: 15,
      };

      mockGenerateResponse.mockResolvedValue({
        content: '```json\n  ' + JSON.stringify(mockResult) + '  \n```',
        inputTokens: 95,
        outputTokens: 140,
      });

      const result = await parseTweetIntent('@sottofm mars mission details');

      expect(result).toEqual(mockResult);
    });
  });

  describe('error handling', () => {
    it('throws on invalid JSON from Claude', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: 'This is not valid JSON { broken',
        inputTokens: 50,
        outputTokens: 10,
      });

      await expect(
        parseTweetIntent('@sottofm some topic')
      ).rejects.toThrow('Failed to parse tweet intent — Claude returned invalid JSON');
    });

    it('throws when topic is missing from parsed result', async () => {
      const invalidResult = {
        title: 'Some Title',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'casual',
        focusAreas: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(invalidResult),
        inputTokens: 60,
        outputTokens: 80,
      });

      await expect(
        parseTweetIntent('@sottofm some topic')
      ).rejects.toThrow('Failed to extract topic and title from tweet');
    });

    it('throws when title is missing from parsed result', async () => {
      const invalidResult = {
        topic: 'Some Topic',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'casual',
        focusAreas: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(invalidResult),
        inputTokens: 60,
        outputTokens: 80,
      });

      await expect(
        parseTweetIntent('@sottofm some topic')
      ).rejects.toThrow('Failed to extract topic and title from tweet');
    });

    it('throws when both topic and title are missing', async () => {
      const invalidResult = {
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'casual',
        focusAreas: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(invalidResult),
        inputTokens: 60,
        outputTokens: 80,
      });

      await expect(
        parseTweetIntent('@sottofm some topic')
      ).rejects.toThrow('Failed to extract topic and title from tweet');
    });
  });

  describe('complete parsing scenarios', () => {
    it('parses a tweet with sourceUrl', async () => {
      const mockResult: TweetParseResult = {
        topic: 'Renewable Energy',
        title: 'The Future of Solar Power',
        depth: 'standard',
        audienceLevel: 'intermediate',
        tone: 'professional',
        focusAreas: ['solar panels', 'efficiency'],
        audience: 'general',
        durationTarget: 10,
        sourceUrl: 'https://example.com/solar-power',
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResult),
        inputTokens: 110,
        outputTokens: 160,
      });

      const result = await parseTweetIntent(
        '@sottofm https://example.com/solar-power discuss this article'
      );

      expect(result.sourceUrl).toBe('https://example.com/solar-power');
    });

    it('parses a casual tweet with emojis', async () => {
      const mockResult: TweetParseResult = {
        topic: 'Cooking Basics',
        title: 'Easy Cooking Tips for Beginners',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        tone: 'casual',
        focusAreas: ['knife skills', 'seasoning'],
        audience: 'general',
        durationTarget: 5,
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResult),
        inputTokens: 85,
        outputTokens: 125,
      });

      const result = await parseTweetIntent(
        '@sottofm teach me cooking basics 🍳👨‍🍳'
      );

      expect(result.tone).toBe('casual');
    });

    it('parses a deep dive expert request', async () => {
      const mockResult: TweetParseResult = {
        topic: 'Quantum Field Theory',
        title: 'Advanced Concepts in QFT',
        depth: 'deep_dive',
        audienceLevel: 'expert',
        tone: 'professional',
        focusAreas: ['renormalization', 'gauge theory', 'symmetry breaking'],
        audience: 'mature',
        durationTarget: 15,
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResult),
        inputTokens: 130,
        outputTokens: 200,
      });

      const result = await parseTweetIntent(
        '@sottofm deep dive into quantum field theory renormalization and gauge symmetry breaking'
      );

      expect(result.depth).toBe('deep_dive');
      expect(result.audienceLevel).toBe('expert');
      expect(result.focusAreas).toContain('renormalization');
    });
  });
});

// ---- parseThreadIntent ----

function createMockThread(overrides?: Partial<ThreadData>): ThreadData {
  return {
    rootTweet: {
      id: 'root-1',
      text: 'AI will replace all jobs in 5 years',
      authorId: 'author-1',
      authorUsername: 'alice',
      authorName: 'Alice',
      urls: [],
      createdAt: '2026-02-10T10:00:00Z',
    },
    replies: [
      {
        id: 'reply-1',
        text: 'That is a massive overstatement, AI augments not replaces',
        authorId: 'author-2',
        authorUsername: 'bob',
        authorName: 'Bob',
        urls: ['https://example.com/ai-jobs'],
        createdAt: '2026-02-10T10:05:00Z',
        inReplyToTweetId: 'root-1',
      },
      {
        id: 'reply-2',
        text: 'I agree with @alice, my job is already mostly automated',
        authorId: 'author-3',
        authorUsername: 'carol',
        authorName: 'Carol',
        urls: [],
        createdAt: '2026-02-10T10:10:00Z',
        inReplyToTweetId: 'reply-1',
      },
      {
        id: 'reply-3',
        text: '@sottofm make a podcast about this debate',
        authorId: 'author-4',
        authorUsername: 'dave',
        authorName: 'Dave',
        urls: [],
        createdAt: '2026-02-10T10:15:00Z',
        inReplyToTweetId: 'reply-2',
      },
    ],
    participantCount: 4,
    tweetCount: 4,
    isSelfAuthored: false,
    ...overrides,
  };
}

function createMockMentionTweet(overrides?: Partial<ThreadTweet>): ThreadTweet {
  return {
    id: 'reply-3',
    text: '@sottofm make a podcast about this debate',
    authorId: 'author-4',
    authorUsername: 'dave',
    authorName: 'Dave',
    urls: [],
    createdAt: '2026-02-10T10:15:00Z',
    ...overrides,
  };
}

describe('parseThreadIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a debate thread with viewpoints', async () => {
    const mockResult: TweetParseResult = {
      topic: 'AI Job Displacement',
      title: 'Will AI Replace All Jobs? The Great Debate',
      depth: 'deep_dive',
      audienceLevel: 'intermediate',
      tone: 'socratic',
      focusAreas: ['automation', 'augmentation', 'labor market'],
      audience: 'general',
      durationTarget: 15,
      sourceUrl: 'https://example.com/ai-jobs',
      sourceUrls: ['https://example.com/ai-jobs'],
      isDebate: true,
      viewpoints: [
        '@alice argues AI will replace all jobs within 5 years',
        '@bob counters that AI augments rather than replaces',
      ],
    };

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(mockResult),
      inputTokens: 300,
      outputTokens: 400,
    });

    const thread = createMockThread();
    const mention = createMockMentionTweet();

    const result = await parseThreadIntent(mention, thread);

    expect(result.isDebate).toBe(true);
    expect(result.viewpoints).toHaveLength(2);
    expect(result.sourceUrls).toContain('https://example.com/ai-jobs');
  });

  it('parses an informational thread without debate', async () => {
    const mockResult: TweetParseResult = {
      topic: 'React Server Components',
      title: 'Understanding React Server Components',
      depth: 'standard',
      audienceLevel: 'intermediate',
      tone: 'professional',
      focusAreas: ['streaming', 'data fetching'],
      audience: 'general',
      durationTarget: 15,
      isDebate: false,
      viewpoints: [],
    };

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(mockResult),
      inputTokens: 200,
      outputTokens: 300,
    });

    const thread = createMockThread({
      replies: [
        {
          id: 'r1',
          text: 'Good explanation of RSC',
          authorId: 'a2',
          authorUsername: 'bob',
          authorName: 'Bob',
          urls: [],
          createdAt: '2026-02-10T10:05:00Z',
          inReplyToTweetId: 'root-1',
        },
        {
          id: 'r2',
          text: 'Thanks for sharing',
          authorId: 'a3',
          authorUsername: 'carol',
          authorName: 'Carol',
          urls: [],
          createdAt: '2026-02-10T10:10:00Z',
          inReplyToTweetId: 'root-1',
        },
        {
          id: 'r3',
          text: '@sottofm make this a podcast',
          authorId: 'a4',
          authorUsername: 'dave',
          authorName: 'Dave',
          urls: [],
          createdAt: '2026-02-10T10:15:00Z',
        },
      ],
    });
    const mention = createMockMentionTweet();

    const result = await parseThreadIntent(mention, thread);

    expect(result.isDebate).toBe(false);
  });

  it('uses maxTokens 1024 for thread parsing', async () => {
    const mockResult: TweetParseResult = {
      topic: 'Test',
      title: 'Test Thread',
      depth: 'standard',
      audienceLevel: 'beginner',
      tone: 'casual',
      focusAreas: [],
    };

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(mockResult),
      inputTokens: 100,
      outputTokens: 150,
    });

    const thread = createMockThread();
    const mention = createMockMentionTweet();

    await parseThreadIntent(mention, thread);

    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ maxTokens: 1024 })
    );
  });

  it('throws on invalid JSON from Claude', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: 'Not valid JSON',
      inputTokens: 50,
      outputTokens: 10,
    });

    const thread = createMockThread();
    const mention = createMockMentionTweet();

    await expect(parseThreadIntent(mention, thread)).rejects.toThrow(
      'Failed to parse thread intent — Claude returned invalid JSON'
    );
  });

  it('throws when topic is missing', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({ title: 'Has Title', depth: 'standard', audienceLevel: 'beginner', tone: 'casual', focusAreas: [] }),
      inputTokens: 50,
      outputTokens: 50,
    });

    const thread = createMockThread();
    const mention = createMockMentionTweet();

    await expect(parseThreadIntent(mention, thread)).rejects.toThrow(
      'Failed to extract topic and title from thread'
    );
  });

  it('includes thread context in user message sent to Claude', async () => {
    const mockResult: TweetParseResult = {
      topic: 'Test',
      title: 'Test',
      depth: 'standard',
      audienceLevel: 'beginner',
      tone: 'casual',
      focusAreas: [],
    };

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(mockResult),
      inputTokens: 100,
      outputTokens: 100,
    });

    const thread = createMockThread();
    const mention = createMockMentionTweet();

    await parseThreadIntent(mention, thread);

    const userMessage = mockGenerateResponse.mock.calls[0][1][0].content as string;
    expect(userMessage).toContain('@alice');
    expect(userMessage).toContain('AI will replace all jobs');
    expect(userMessage).toContain('@bob');
    expect(userMessage).toContain('4 tweets');
    expect(userMessage).toContain('4 participants');
  });

  it('passes apiKeyOverride to generateResponse', async () => {
    const mockResult: TweetParseResult = {
      topic: 'Test',
      title: 'Test',
      depth: 'standard',
      audienceLevel: 'beginner',
      tone: 'casual',
      focusAreas: [],
    };

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(mockResult),
      inputTokens: 100,
      outputTokens: 100,
    });

    const thread = createMockThread();
    const mention = createMockMentionTweet();

    await parseThreadIntent(mention, thread, 'user-api-key-123');

    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ apiKeyOverride: 'user-api-key-123' })
    );
  });
});

// ---- resolveModelFromTweet ----

describe('resolveModelFromTweet', () => {
  const baseParsed: TweetParseResult = {
    topic: 'Test',
    title: 'Test',
    depth: 'standard',
    audienceLevel: 'beginner',
    tone: 'casual',
    focusAreas: [],
  };

  it('returns nulls when no model is requested', () => {
    const result = resolveModelFromTweet(baseParsed);
    expect(result.aiModel).toBeNull();
    expect(result.ttsProvider).toBeNull();
  });

  it('resolves "opus" to claude-opus-4-6', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedAiModel: 'opus' });
    expect(result.aiModel).toBe('claude-opus-4-6');
  });

  it('resolves "sonnet" to claude-sonnet-4-6', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedAiModel: 'sonnet' });
    expect(result.aiModel).toBe('claude-sonnet-4-6');
  });

  it('resolves "haiku" to claude-haiku-4-5-20251001', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedAiModel: 'haiku' });
    expect(result.aiModel).toBe('claude-haiku-4-5-20251001');
  });

  it('resolves "gpt-5" to gpt-5', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedAiModel: 'gpt-5' });
    expect(result.aiModel).toBe('gpt-5');
  });

  it('resolves "elevenlabs" to elevenlabs TTS provider', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedTtsProvider: 'elevenlabs' });
    expect(result.ttsProvider).toBe('elevenlabs');
  });

  it('resolves "11labs" to elevenlabs', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedTtsProvider: '11labs' });
    expect(result.ttsProvider).toBe('elevenlabs');
  });

  it('resolves "openai voice" to openai TTS', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedTtsProvider: 'openai voice' });
    expect(result.ttsProvider).toBe('openai');
  });

  it('resolves "hume" to hume TTS', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedTtsProvider: 'hume' });
    expect(result.ttsProvider).toBe('hume');
  });

  it('returns null for unrecognized model names', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedAiModel: 'banana-model-9000' });
    expect(result.aiModel).toBeNull();
  });

  it('returns null for unrecognized TTS providers', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedTtsProvider: 'unknown-tts' });
    expect(result.ttsProvider).toBeNull();
  });

  it('resolves both AI and TTS simultaneously', () => {
    const result = resolveModelFromTweet({
      ...baseParsed,
      requestedAiModel: 'opus',
      requestedTtsProvider: 'elevenlabs',
    });
    expect(result.aiModel).toBe('claude-opus-4-6');
    expect(result.ttsProvider).toBe('elevenlabs');
  });
});
