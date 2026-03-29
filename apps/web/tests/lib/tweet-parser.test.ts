import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockGenerateResponse = vi.fn();

const mockProvider = {
  generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
  streamResponse: vi.fn(),
};

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: vi.fn(() => mockProvider),
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: vi.fn(async () => null),
}));

vi.mock('@/lib/auto-model-config', () => ({
  resolveAutoModel: vi.fn(async () => ({
    aiProvider: 'anthropic',
    aiModel: 'claude-haiku-4-5-20251001',
    ttsProvider: 'kittentts',
    ttsModel: 'kitten-tts-mini-0.8',
    sttProvider: 'openai',
    sttModel: 'whisper-1',
  })),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderMeta: vi.fn((id: string) => {
    if (id === 'anthropic') return { defaultModel: 'claude-haiku-4-5-20251001', models: [{ id: 'claude-haiku-4-5-20251001', tier: 'fast' }, { id: 'claude-sonnet-4-6', tier: 'balanced' }, { id: 'claude-opus-4-6', tier: 'best' }] };
    if (id === 'openai') return { defaultModel: 'gpt-5', models: [{ id: 'gpt-5-mini', tier: 'fast' }, { id: 'gpt-5', tier: 'balanced' }] };
    return { defaultModel: '', models: [] };
  }),
  getAllAiProviderMeta: vi.fn(() => [
    { id: 'anthropic', models: [{ id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' }, { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' }, { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' }] },
    { id: 'openai', models: [{ id: 'gpt-5-mini', displayName: 'GPT-5 Mini' }, { id: 'gpt-5', displayName: 'GPT-5' }] },
  ]),
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/providers/fal-endpoints', () => ({
  FAL_IMAGE_MODEL_IDS: new Set(['fal-flux-2-pro', 'fal-flux-1-pro', 'fal-recraft-v3', 'fal-ideogram-v2']),
  FAL_VIDEO_MODEL_IDS: new Set(['fal-veo3-1080p', 'fal-veo3-fast-1080p', 'fal-kling3-1080p', 'fal-wan2.5-480p']),
}));

vi.mock('@/lib/providers/avatar-registry', () => ({
  getAllAvatarModelIds: vi.fn(() => new Set([
    'heygen-avatar-standard', 'heygen-photo-avatar-iii', 'heygen-public-avatar-iii',
    'heygen-digital-twin-iii', 'heygen-avatar-iv', 'heygen-digital-twin-iv',
    'heygen-photo-avatar-iv', 'heygen-public-avatar-iv',
    'fal-heygen-avatar4-i2v', 'fal-heygen-avatar4-twin',
  ])),
}));

// ---- Import under test ----
import { parseTweetIntent, parseThreadIntent, resolveModelFromTweet } from '@/lib/tweet-parser';
import type { TweetParseResult, ThreadData, ThreadTweet } from '@/types/twitter';

// ---- Tests ----

describe('parseTweetIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes PLATFORM model to generateResponse', async () => {
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
      inputTokens: 50,
      outputTokens: 50,
      model: 'claude-haiku-4-5-20251001',
    });

    await parseTweetIntent('@sottofm test topic');

    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' })
    );
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
        model: 'test-model',
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
        model: 'test-model',
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
        model: 'test-model',
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
        model: 'test-model',
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
        model: 'test-model',
      });

      const result = await parseTweetIntent('@sottofm mars mission details');

      expect(result).toEqual(mockResult);
    });
  });

  describe('error handling', () => {
    it('throws on invalid JSON from LLM', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: 'This is not valid JSON { broken',
        inputTokens: 50,
        outputTokens: 10,
        model: 'test-model',
      });

      await expect(
        parseTweetIntent('@sottofm some topic')
      ).rejects.toThrow('Failed to parse tweet intent — LLM returned invalid JSON');
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
        model: 'test-model',
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
        model: 'test-model',
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
        model: 'test-model',
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
        model: 'test-model',
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
        model: 'test-model',
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
        model: 'test-model',
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
      model: 'test-model',
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
      model: 'test-model',
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

  it('passes PLATFORM model to generateResponse', async () => {
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
      model: 'claude-haiku-4-5-20251001',
    });

    const thread = createMockThread();
    const mention = createMockMentionTweet();

    await parseThreadIntent(mention, thread);

    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' })
    );
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
      model: 'test-model',
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

  it('throws on invalid JSON from LLM', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: 'Not valid JSON',
      inputTokens: 50,
      outputTokens: 10,
      model: 'test-model',
    });

    const thread = createMockThread();
    const mention = createMockMentionTweet();

    await expect(parseThreadIntent(mention, thread)).rejects.toThrow(
      'Failed to parse thread intent — LLM returned invalid JSON'
    );
  });

  it('throws when topic is missing', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({ title: 'Has Title', depth: 'standard', audienceLevel: 'beginner', tone: 'casual', focusAreas: [] }),
      inputTokens: 50,
      outputTokens: 50,
      model: 'test-model',
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
      model: 'test-model',
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
      model: 'test-model',
    });

    const thread = createMockThread();
    const mention = createMockMentionTweet();

    await parseThreadIntent(mention, thread, { apiKeyOverride: 'user-api-key-123' });

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

  it('returns nulls and wantsVideo=false when no model is requested', () => {
    const result = resolveModelFromTweet(baseParsed);
    expect(result.aiModel).toBeNull();
    expect(result.ttsProvider).toBeNull();
    expect(result.ttsModel).toBeNull();
    expect(result.imageModel).toBeNull();
    expect(result.videoModel).toBeNull();
    expect(result.avatarModel).toBeNull();
    expect(result.wantsVideo).toBe(false);
    expect(result.wantsAvatar).toBe(false);
    expect(result.costPreference).toBeNull();
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

  // ---- Image model resolution ----

  it('resolves "flux" to fal-flux-2-pro', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedImageModel: 'flux' });
    expect(result.imageModel).toBe('fal-flux-2-pro');
    expect(result.wantsVideo).toBe(true);
  });

  it('resolves "recraft" to fal-recraft-v3', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedImageModel: 'recraft' });
    expect(result.imageModel).toBe('fal-recraft-v3');
  });

  it('resolves "ideogram" to fal-ideogram-v2', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedImageModel: 'ideogram' });
    expect(result.imageModel).toBe('fal-ideogram-v2');
  });

  it('returns null for unrecognized image model', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedImageModel: 'dalle-9000' });
    expect(result.imageModel).toBeNull();
  });

  // ---- Video model resolution ----

  it('resolves "veo" to fal-veo3-1080p', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedVideoModel: 'veo' });
    expect(result.videoModel).toBe('fal-veo3-1080p');
    expect(result.wantsVideo).toBe(true);
  });

  it('resolves "kling" to fal-kling3-1080p', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedVideoModel: 'kling' });
    expect(result.videoModel).toBe('fal-kling3-1080p');
  });

  it('resolves "wan" to fal-wan2.5-480p', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedVideoModel: 'wan' });
    expect(result.videoModel).toBe('fal-wan2.5-480p');
  });

  it('resolves "veo fast" to fal-veo3-fast-1080p', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedVideoModel: 'veo fast' });
    expect(result.videoModel).toBe('fal-veo3-fast-1080p');
  });

  it('returns null for unrecognized video model', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedVideoModel: 'unknown-video' });
    expect(result.videoModel).toBeNull();
  });

  // ---- "auto" handling ----

  it('sets wantsVideo=true but leaves models null for "auto" requests', () => {
    const result = resolveModelFromTweet({
      ...baseParsed,
      requestedImageModel: 'auto',
      requestedVideoModel: 'auto',
    });
    expect(result.wantsVideo).toBe(true);
    expect(result.imageModel).toBeNull();
    expect(result.videoModel).toBeNull();
  });

  // ---- costPreference passthrough ----

  it('passes through costPreference from parsed result', () => {
    const result = resolveModelFromTweet({ ...baseParsed, costPreference: 'cheapest' });
    expect(result.costPreference).toBe('cheapest');
  });

  // ---- TTS model resolution ----

  it('resolves "v3" to eleven_v3', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedTtsModel: 'v3' });
    expect(result.ttsModel).toBe('eleven_v3');
  });

  it('resolves "elevenlabs v3" to eleven_v3', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedTtsModel: 'elevenlabs v3' });
    expect(result.ttsModel).toBe('eleven_v3');
  });

  it('resolves "sonic 3" to sonic-3', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedTtsModel: 'sonic 3' });
    expect(result.ttsModel).toBe('sonic-3');
  });

  it('resolves "tts-1-hd" to tts-1-hd', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedTtsModel: 'tts-1-hd' });
    expect(result.ttsModel).toBe('tts-1-hd');
  });

  it('resolves "octave" to octave-v2', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedTtsModel: 'octave' });
    expect(result.ttsModel).toBe('octave-v2');
  });

  it('resolves "eleven flash" to eleven_flash_v2_5', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedTtsModel: 'eleven flash' });
    expect(result.ttsModel).toBe('eleven_flash_v2_5');
  });

  it('resolves "minimax hd" to speech-02-hd', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedTtsModel: 'minimax hd' });
    expect(result.ttsModel).toBe('speech-02-hd');
  });

  it('returns null for unrecognized TTS model', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedTtsModel: 'banana-voice-9000' });
    expect(result.ttsModel).toBeNull();
  });

  // ---- Avatar model resolution ----

  it('resolves "heygen" to heygen-avatar-standard', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedAvatarModel: 'heygen' });
    expect(result.avatarModel).toBe('heygen-avatar-standard');
    expect(result.wantsAvatar).toBe(true);
  });

  it('resolves "avatar iv" to heygen-avatar-iv', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedAvatarModel: 'avatar iv' });
    expect(result.avatarModel).toBe('heygen-avatar-iv');
  });

  it('resolves "digital twin" to heygen-digital-twin-iii', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedAvatarModel: 'digital twin' });
    expect(result.avatarModel).toBe('heygen-digital-twin-iii');
  });

  it('resolves "fal avatar" to fal-heygen-avatar4-i2v', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedAvatarModel: 'fal avatar' });
    expect(result.avatarModel).toBe('fal-heygen-avatar4-i2v');
  });

  it('resolves direct registry model ID', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedAvatarModel: 'heygen-photo-avatar-iii' });
    expect(result.avatarModel).toBe('heygen-photo-avatar-iii');
  });

  it('returns null for unrecognized avatar model', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedAvatarModel: 'banana-puppet-9000' });
    expect(result.avatarModel).toBeNull();
  });

  // ---- wantsAvatar implies wantsVideo ----

  it('wantsAvatar forces wantsVideo=true even without image/video models', () => {
    const result = resolveModelFromTweet({ ...baseParsed, requestedAvatarModel: 'heygen' });
    expect(result.wantsAvatar).toBe(true);
    expect(result.wantsVideo).toBe(true);
    expect(result.imageModel).toBeNull();
    expect(result.videoModel).toBeNull();
  });

  // ---- Combined resolution ----

  it('resolves all model types simultaneously', () => {
    const result = resolveModelFromTweet({
      ...baseParsed,
      requestedAiModel: 'haiku',
      requestedTtsProvider: 'cartesia',
      requestedTtsModel: 'sonic 3',
      requestedImageModel: 'flux',
      requestedVideoModel: 'wan',
      requestedAvatarModel: 'heygen',
      costPreference: 'cheapest',
    });
    expect(result.aiModel).toBe('claude-haiku-4-5-20251001');
    expect(result.ttsProvider).toBe('cartesia');
    expect(result.ttsModel).toBe('sonic-3');
    expect(result.imageModel).toBe('fal-flux-2-pro');
    expect(result.videoModel).toBe('fal-wan2.5-480p');
    expect(result.avatarModel).toBe('heygen-avatar-standard');
    expect(result.wantsVideo).toBe(true);
    expect(result.wantsAvatar).toBe(true);
    expect(result.costPreference).toBe('cheapest');
  });
});
