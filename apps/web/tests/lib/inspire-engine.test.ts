import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPersonalizedTopics,
  getTrendingTopics,
  getCurrentEvents,
  drillDown,
} from '@/lib/inspire-engine';
import { prisma } from '@/lib/prisma';
import { cache } from '@/lib/redis';
import { getTrending } from '@/lib/recommendation-engine';
import { logger } from '@/lib/logger';
import { resolveAiProvider } from '@/lib/providers/ai';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userInterest: {
      findMany: vi.fn(),
    },
    tag: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/redis', () => ({
  cache: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('@/lib/recommendation-engine', () => ({
  getTrending: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/providers/ai', () => ({
  resolveAiProvider: vi.fn(),
}));

const { mockMessagesCreate, mockExecuteClaudeCode, mockChatCompletionsCreate } = vi.hoisted(
  () => ({
    mockMessagesCreate: vi.fn(),
    mockExecuteClaudeCode: vi.fn(),
    mockChatCompletionsCreate: vi.fn(),
  })
);

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockMessagesCreate };
  },
}));

vi.mock('@/lib/claude-code-client', () => ({
  executeClaudeCode: mockExecuteClaudeCode,
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockChatCompletionsCreate } };
  },
}));

describe('getPersonalizedTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns generic topics when user has no interests', async () => {
    vi.mocked(prisma.userInterest.findMany).mockResolvedValue([]);
    vi.mocked(cache.get).mockResolvedValue(null);

    const result = await getPersonalizedTopics('user-123');

    expect(result).toHaveLength(4);
    expect(result[0]).toHaveProperty('title');
    expect(result[0]).toHaveProperty('category');
    expect(result[0]).toHaveProperty('hook');
    expect(result[0].title).toBe('How AI is Changing Creative Work');
    expect(result[0].category).toBe('Technology');
  });

  it('returns cached topics when available', async () => {
    const cachedTopics = [{ title: 'Cached Topic', category: 'Science', hook: 'From cache' }];

    vi.mocked(prisma.userInterest.findMany).mockResolvedValue([
      {
        userId: 'user-123',
        tagId: 'tag-1',
        weight: 1.0,
        tag: { name: 'Physics', slug: 'physics' },
      } as any,
    ]);
    vi.mocked(cache.get).mockResolvedValue(cachedTopics);

    const result = await getPersonalizedTopics('user-123');

    expect(result).toEqual(cachedTopics);
    expect(cache.get).toHaveBeenCalledWith('inspire:foryou:user-123');
  });

  it('returns fallback topics when no AI provider is available', async () => {
    vi.mocked(prisma.userInterest.findMany).mockResolvedValue([
      {
        userId: 'user-123',
        tagId: 'tag-1',
        weight: 1.0,
        tag: { name: 'Quantum Physics', slug: 'quantum-physics' },
      } as any,
      {
        userId: 'user-123',
        tagId: 'tag-2',
        weight: 0.8,
        tag: { name: 'Machine Learning', slug: 'machine-learning' },
      } as any,
    ]);
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(resolveAiProvider).mockRejectedValue(
      new Error('No AI provider available. Configure an API key in settings.')
    );

    const result = await getPersonalizedTopics('user-123');

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Deep dive into Quantum Physics');
    expect(result[0].category).toBe('Quantum Physics');
    expect(result[0].hook).toBe('Explore the latest developments in quantum physics');
    expect(result[1].title).toBe('Deep dive into Machine Learning');
    expect(result[1].category).toBe('Machine Learning');
  });

  it('respects weight ordering from user interests', async () => {
    vi.mocked(prisma.userInterest.findMany).mockResolvedValue([
      {
        userId: 'user-123',
        tagId: 'tag-1',
        weight: 0.9,
        tag: { name: 'Topic A', slug: 'topic-a' },
      } as any,
      {
        userId: 'user-123',
        tagId: 'tag-2',
        weight: 0.7,
        tag: { name: 'Topic B', slug: 'topic-b' },
      } as any,
    ]);
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(resolveAiProvider).mockRejectedValue(new Error('No AI provider'));

    const result = await getPersonalizedTopics('user-123');

    // Higher-weighted topic should appear first in fallback results
    expect(result[0].category).toBe('Topic A');
    expect(result[1].category).toBe('Topic B');
  });

  it('uses Anthropic with web search when BYOK key resolves to anthropic', async () => {
    vi.mocked(prisma.userInterest.findMany).mockResolvedValue([
      {
        userId: 'user-123',
        tagId: 'tag-1',
        weight: 1.0,
        tag: { name: 'AI', slug: 'ai' },
      } as any,
    ]);
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(resolveAiProvider).mockResolvedValue({
      provider: 'anthropic',
      source: 'byok',
      apiKey: 'sk-ant-byok-key',
    });

    const topics = [{ title: 'AI News', category: 'AI', hook: 'Breaking AI developments' }];
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(topics) }],
    });

    const result = await getPersonalizedTopics('user-123');

    expect(result).toEqual(topics);
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      })
    );
    expect(cache.set).toHaveBeenCalledWith('inspire:foryou:user-123', topics, 3600);
  });

  it('uses claude-code with opus model in dev mode', async () => {
    vi.mocked(prisma.userInterest.findMany).mockResolvedValue([
      {
        userId: 'user-123',
        tagId: 'tag-1',
        weight: 1.0,
        tag: { name: 'Science', slug: 'science' },
      } as any,
    ]);
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(resolveAiProvider).mockResolvedValue({
      provider: 'anthropic',
      source: 'claude-code',
    });

    const topics = [
      { title: 'Quantum Breakthrough', category: 'Science', hook: 'New discovery' },
    ];
    mockExecuteClaudeCode.mockResolvedValue({ content: JSON.stringify(topics) });

    const result = await getPersonalizedTopics('user-123');

    expect(result).toEqual(topics);
    expect(mockExecuteClaudeCode).toHaveBeenCalledWith('', expect.any(String), { model: 'opus' });
  });

  it('uses OpenAI without web search when resolved to openai', async () => {
    vi.mocked(prisma.userInterest.findMany).mockResolvedValue([
      {
        userId: 'user-123',
        tagId: 'tag-1',
        weight: 1.0,
        tag: { name: 'Tech', slug: 'tech' },
      } as any,
    ]);
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(resolveAiProvider).mockResolvedValue({
      provider: 'openai',
      source: 'byok',
      apiKey: 'sk-openai-key',
    });

    const topics = [{ title: 'Tech Topic', category: 'Tech', hook: 'Interesting tech' }];
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(topics) } }],
    });

    const result = await getPersonalizedTopics('user-123');

    expect(result).toEqual(topics);
    expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini' })
    );
    // OpenAI should not have web search tools
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});

describe('getTrendingTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached trending topics when available', async () => {
    const cachedTopics = [
      { title: 'Trending Topic', category: 'Technology', hook: '1000 listens this week' },
    ];

    vi.mocked(cache.get).mockResolvedValue(cachedTopics);

    const result = await getTrendingTopics();

    expect(result).toEqual(cachedTopics);
    expect(cache.get).toHaveBeenCalledWith('inspire:trending');
    expect(getTrending).not.toHaveBeenCalled();
  });

  it('returns empty array when getTrending throws', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(getTrending).mockRejectedValue(new Error('Database error'));

    const result = await getTrendingTopics();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('Failed to get trending topics', {
      error: 'Database error',
    });
  });

  it('formats trending podcasts into topic suggestions', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(getTrending).mockResolvedValue([
      {
        id: 'p1',
        title: 'Quantum Computing Explained',
        playCount: 500,
        tags: [{ name: 'Science' }],
      } as any,
      {
        id: 'p2',
        title: 'AI Ethics',
        playCount: 400,
        tags: [{ name: 'Technology' }],
      } as any,
    ]);

    const result = await getTrendingTopics();

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Quantum Computing Explained');
    expect(result[0].category).toBe('Science');
    expect(result[0].hook).toBe('500 listens this week');
    expect(result[1].title).toBe('AI Ethics');
    expect(result[1].category).toBe('Technology');
    expect(result[1].hook).toBe('400 listens this week');
  });

  it('uses Trending as fallback category when no tags exist', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(getTrending).mockResolvedValue([
      {
        id: 'p1',
        title: 'No Tags Podcast',
        playCount: 300,
        tags: [],
      } as any,
    ]);

    const result = await getTrendingTopics();

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('Trending');
  });

  it('limits results to first 4 podcasts', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(getTrending).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: `p${i}`,
        title: `Podcast ${i}`,
        playCount: 100 - i,
        tags: [{ name: 'Category' }],
      })) as any
    );

    const result = await getTrendingTopics();

    expect(result).toHaveLength(4);
  });

  it('caches trending topics when successfully retrieved', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(getTrending).mockResolvedValue([
      {
        id: 'p1',
        title: 'Test',
        playCount: 100,
        tags: [{ name: 'Tech' }],
      } as any,
    ]);

    await getTrendingTopics();

    expect(cache.set).toHaveBeenCalledWith('inspire:trending', expect.any(Array), 3600);
  });

  it('does not cache when no trending topics found', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(getTrending).mockResolvedValue([]);

    const result = await getTrendingTopics();

    expect(result).toEqual([]);
    expect(cache.set).not.toHaveBeenCalled();
  });
});

describe('getCurrentEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns generic suggestions when no AI provider is available', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(resolveAiProvider).mockRejectedValue(new Error('No AI provider'));

    const result = await getCurrentEvents('user-123');

    expect(result).toHaveLength(3);
    expect(result[0]).toHaveProperty('title');
    expect(result[0]).toHaveProperty('category');
    expect(result[0]).toHaveProperty('hook');
    expect(result[0].title).toBe('Latest in Space Exploration');
    expect(result[0].category).toBe('Science');
  });

  it('returns cached events when available', async () => {
    const cachedEvents = [{ title: 'Cached Event', category: 'News', hook: 'Breaking news' }];

    vi.mocked(cache.get).mockResolvedValue(cachedEvents);

    const result = await getCurrentEvents('user-123', ['Technology']);

    expect(result).toEqual(cachedEvents);
    expect(cache.get).toHaveBeenCalledWith('inspire:news:Technology');
  });

  it('generates cache key from sorted interests', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(resolveAiProvider).mockRejectedValue(new Error('No AI provider'));

    await getCurrentEvents('user-123', ['Science', 'Technology', 'Art']);

    expect(cache.get).toHaveBeenCalledWith('inspire:news:Art,Science,Technology');
  });

  it('uses general cache key when no interests provided', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(resolveAiProvider).mockRejectedValue(new Error('No AI provider'));

    await getCurrentEvents('user-123');

    expect(cache.get).toHaveBeenCalledWith('inspire:news:general');
  });

  it('returns generic suggestions for empty interests array', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(resolveAiProvider).mockRejectedValue(new Error('No AI provider'));

    const result = await getCurrentEvents('user-123', []);

    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('Latest in Space Exploration');
  });

  it('uses web search when resolved to anthropic', async () => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(resolveAiProvider).mockResolvedValue({
      provider: 'anthropic',
      source: 'platform',
      apiKey: 'sk-ant-platform-key',
    });

    const topics = [{ title: 'News Topic', category: 'Tech', hook: 'Breaking' }];
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(topics) }],
    });

    const result = await getCurrentEvents('user-123', ['Technology']);

    expect(result).toEqual(topics);
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      })
    );
  });
});

describe('drillDown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns fallback subtopics when no AI provider is available', async () => {
    vi.mocked(resolveAiProvider).mockRejectedValue(new Error('No AI provider'));

    const result = await drillDown('user-123', 'Technology');

    expect(result).toHaveLength(4);
    expect(result[0].title).toBe("Technology: Beginner's Guide");
    expect(result[0].category).toBe('Technology');
    expect(result[0].hook).toBe('Start from the fundamentals');
    expect(result[1].title).toBe('Technology: Latest Breakthroughs');
    expect(result[2].title).toBe('Technology: Controversies');
    expect(result[3].title).toBe('Technology: Future Predictions');
  });

  it('includes category in all fallback subtopics', async () => {
    vi.mocked(resolveAiProvider).mockRejectedValue(new Error('No AI provider'));

    const result = await drillDown('user-123', 'Quantum Physics');

    expect(result).toHaveLength(4);
    result.forEach((topic) => {
      expect(topic.category).toBe('Quantum Physics');
      expect(topic.title).toContain('Quantum Physics');
    });
  });

  it('generates fallback subtopics without parentTitle', async () => {
    vi.mocked(resolveAiProvider).mockRejectedValue(new Error('No AI provider'));

    const result = await drillDown('user-123', 'Biology');

    expect(result).toHaveLength(4);
    expect(result[0]).toHaveProperty('title');
    expect(result[0]).toHaveProperty('category');
    expect(result[0]).toHaveProperty('hook');
  });

  it('generates fallback subtopics with parentTitle', async () => {
    vi.mocked(resolveAiProvider).mockRejectedValue(new Error('No AI provider'));

    const result = await drillDown('user-123', 'Machine Learning', 'Deep Learning Basics');

    expect(result).toHaveLength(4);
    expect(result[0].category).toBe('Machine Learning');
  });

  it('returns fallback with special characters in category', async () => {
    vi.mocked(resolveAiProvider).mockRejectedValue(new Error('No AI provider'));

    const result = await drillDown('user-123', 'C++ & Low-Level Programming');

    expect(result).toHaveLength(4);
    expect(result[0].title).toBe("C++ & Low-Level Programming: Beginner's Guide");
    expect(result[0].category).toBe('C++ & Low-Level Programming');
  });

  it('returns fallback with very long category name', async () => {
    vi.mocked(resolveAiProvider).mockRejectedValue(new Error('No AI provider'));
    const longCategory = 'a'.repeat(200);
    const result = await drillDown('user-123', longCategory);

    expect(result).toHaveLength(4);
    result.forEach((topic) => {
      expect(topic.category).toBe(longCategory);
    });
  });

  it('does not use web search when drilling down', async () => {
    vi.mocked(resolveAiProvider).mockResolvedValue({
      provider: 'anthropic',
      source: 'platform',
      apiKey: 'sk-ant-platform-key',
    });

    const topics = [{ title: 'Sub Topic', category: 'Tech', hook: 'Deep dive' }];
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(topics) }],
    });

    const result = await drillDown('user-123', 'Tech');

    expect(result).toEqual(topics);
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ tools: expect.anything() })
    );
  });
});
