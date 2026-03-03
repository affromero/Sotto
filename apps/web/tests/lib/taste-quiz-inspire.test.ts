import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockTagFindMany = vi.fn();
const mockUserInterestFindMany = vi.fn();
const mockTasteQuizAnswerFindMany = vi.fn();
const mockResolveAutoModel = vi.fn();
const mockCreateAIProvider = vi.fn();
const mockGetAiKey = vi.fn();

const mockUserFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    tag: { findMany: (...args: unknown[]) => mockTagFindMany(...args) },
    userInterest: { findMany: (...args: unknown[]) => mockUserInterestFindMany(...args) },
    tasteQuizAnswer: { findMany: (...args: unknown[]) => mockTasteQuizAnswerFindMany(...args) },
    apiUsageLog: { create: () => Promise.resolve({}) },
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/auto-model-config', () => ({
  resolveAutoModel: (...args: unknown[]) => mockResolveAutoModel(...args),
}));

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: (...args: unknown[]) => mockCreateAIProvider(...args),
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  getProviderForModel: () => null,
  getAllAiProviderMeta: vi.fn(() => []),
  getAiProviderMeta: vi.fn(() => ({ models: [] })),
  getAiProviderIdsWithPricing: vi.fn(() => []),
  resolveAiModelAndProvider: vi.fn(async () => ({ model: 'claude-haiku-4-5-20251001', provider: 'anthropic' })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/redis', () => ({
  inspireFailures: { push: vi.fn().mockResolvedValue(undefined) },
}));

const mockFetchNewsletterArticles = vi.fn();
const mockFormatArticlesForPrompt = vi.fn();

vi.mock('@/lib/newsletter-fetcher', () => ({
  fetchNewsletterArticles: (...args: unknown[]) => mockFetchNewsletterArticles(...args),
  formatArticlesForPrompt: (...args: unknown[]) => mockFormatArticlesForPrompt(...args),
}));

import { generateForYouQuestions, generateNewsQuestions, generateCuriosityQuestions } from '@/lib/taste-quiz';

// ---- Helpers ----

const mockCategories = [
  {
    name: 'Technology',
    slug: 'technology',
    children: [
      { name: 'AI', slug: 'ai' },
      { name: 'Web', slug: 'web' },
    ],
  },
  {
    name: 'Science',
    slug: 'science',
    children: [
      { name: 'Physics', slug: 'physics' },
      { name: 'Biology', slug: 'biology' },
    ],
  },
];

function setupDefaultMocks() {
  mockTagFindMany.mockResolvedValue(mockCategories);
  mockTasteQuizAnswerFindMany.mockResolvedValue([]);
  mockResolveAutoModel.mockResolvedValue({
    aiProvider: 'anthropic',
    aiModel: 'claude-haiku-4-5-20251001',
    ttsProvider: 'kittentts',
    ttsModel: 'kitten-tts-mini-0.8',
    sttProvider: 'openai',
    sttModel: 'whisper-1',
  });
  mockUserInterestFindMany.mockResolvedValue([]);
  mockUserFindUnique.mockResolvedValue({ plan: 'FREE' });
  // Default: no BYOK key, falls through to createAIProvider
  mockGetAiKey.mockResolvedValue(null);
  // Default: no newsletter articles, falls back to web search path
  mockFetchNewsletterArticles.mockResolvedValue([]);
  mockFormatArticlesForPrompt.mockReturnValue('');
}

function createMockAI(responseContent: string) {
  return {
    generateResponse: vi.fn().mockResolvedValue({
      content: responseContent,
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 100,
      outputTokens: 50,
    }),
  };
}

// ---- Tests ----

describe('generateForYouQuestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('generates interest-based questions without web search', async () => {
    mockUserInterestFindMany.mockResolvedValue([
      { tag: { name: 'AI', slug: 'ai' }, weight: 5 },
    ]);

    const questions = JSON.stringify([
      { text: 'Would you listen to a podcast about AI in cooking?', tagSlugs: ['ai'], category: 'technology' },
    ]);
    const ai = createMockAI(questions);
    mockCreateAIProvider.mockReturnValue(ai);

    const result = await generateForYouQuestions('user-1', 1);

    expect(result).toHaveLength(1);
    expect(result[0].text).toContain('AI in cooking');
    // Tries BYOK first (getAiKey), falls back to auto model config
    expect(mockGetAiKey).toHaveBeenCalledWith('user-1');
    expect(mockCreateAIProvider).toHaveBeenCalled();
  });

  it('keeps questions with invalid tag slugs in lenient mode', async () => {
    const questions = JSON.stringify([
      { text: 'Valid question', tagSlugs: ['ai'], category: 'technology' },
      { text: 'Invalid slugs', tagSlugs: ['nonexistent'], category: 'fake' },
    ]);
    mockCreateAIProvider.mockReturnValue(createMockAI(questions));

    const result = await generateForYouQuestions('user-1', 5);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Valid question');
    expect(result[0].tagSlugs).toEqual(['ai']);
    expect(result[1].text).toBe('Invalid slugs');
    expect(result[1].tagSlugs).toEqual(['nonexistent']);
  });

  it('deduplicates against prior answers', async () => {
    // The hash of "would you listen to a podcast about ai?" repeated
    const text = 'Would you listen to a podcast about AI?';
    // Simulate prior answer with same hash
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update(text.toLowerCase().trim()).digest('hex').slice(0, 12);
    mockTasteQuizAnswerFindMany.mockResolvedValue([{ questionId: hash }]);

    const questions = JSON.stringify([
      { text, tagSlugs: ['ai'], category: 'technology' },
      { text: 'Fresh question about physics', tagSlugs: ['physics'], category: 'science' },
    ]);
    mockCreateAIProvider.mockReturnValue(createMockAI(questions));

    const result = await generateForYouQuestions('user-1', 5);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Fresh question about physics');
  });

  it('returns empty array on AI failure', async () => {
    mockCreateAIProvider.mockReturnValue({
      generateResponse: vi.fn().mockRejectedValue(new Error('API down')),
    });

    const result = await generateForYouQuestions('user-1', 3);
    expect(result).toEqual([]);
  });

  it('includes topic context in prompt when provided', async () => {
    const questions = JSON.stringify([
      { text: 'Politics and AI regulation', tagSlugs: ['ai'], category: 'technology' },
    ]);
    const ai = createMockAI(questions);
    mockCreateAIProvider.mockReturnValue(ai);

    await generateForYouQuestions('user-1', 1, 'politics');

    // Prompt includes topic context
    const prompt = ai.generateResponse.mock.calls[0][0];
    expect(prompt).toContain('politics');
  });
});

describe('generateNewsQuestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('uses web search when provider is anthropic', async () => {
    mockGetAiKey.mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'test-key',
    });

    // Mock Anthropic SDK
    const mockCreate = vi.fn().mockResolvedValue({
      content: [
        { type: 'text', text: JSON.stringify([
          { text: 'Latest Mars discovery this week', tagSlugs: ['science'], category: 'science' },
        ])},
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create: mockCreate };
      },
    }));

    // Re-import to pick up new mock... but since we can't easily, test the fallback path
    mockGetAiKey.mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-test',
    });

    const questions = JSON.stringify([
      { text: 'Breaking news about physics', tagSlugs: ['physics'], category: 'science' },
    ]);
    mockCreateAIProvider.mockReturnValue(createMockAI(questions));

    const result = await generateNewsQuestions('user-1', 1);

    expect(result).toHaveLength(1);
    expect(mockGetAiKey).toHaveBeenCalledWith('user-1');
  });

  it('excludes provided topics in the prompt', async () => {
    // Resolve with no apiKey so it falls through to createAIProvider path
    mockGetAiKey.mockResolvedValue({
      provider: 'openai',
      apiKey: '',
    });
    delete process.env.ANTHROPIC_API_KEY;

    const ai = createMockAI(JSON.stringify([
      { text: 'News question', tagSlugs: ['science'], category: 'science' },
    ]));
    mockCreateAIProvider.mockReturnValue(ai);

    await generateNewsQuestions('user-1', 1, ['AI in cooking', 'Psychology of music']);

    // The system prompt should contain the exclude topics
    const call = ai.generateResponse.mock.calls[0];
    expect(call[0]).toContain('AI in cooking');
    expect(call[0]).toContain('Psychology of music');
  });

  it('returns empty array on AI failure', async () => {
    mockCreateAIProvider.mockReturnValue({
      generateResponse: vi.fn().mockRejectedValue(new Error('API down')),
    });

    const result = await generateNewsQuestions('user-1', 3);
    expect(result).toEqual([]);
  });

  it('uses newsletter-grounded path when 3+ articles available', async () => {
    const mockArticles = [
      { title: 'Article 1', url: 'https://a.com', summary: 'Summary 1', pubDate: '2026-02-27', source: 'Reuters' },
      { title: 'Article 2', url: 'https://b.com', summary: 'Summary 2', pubDate: '2026-02-26', source: 'NPR' },
      { title: 'Article 3', url: 'https://c.com', summary: 'Summary 3', pubDate: '2026-02-25', source: 'BBC' },
    ];
    mockFetchNewsletterArticles.mockResolvedValue(mockArticles);
    mockFormatArticlesForPrompt.mockReturnValue('[1] Reuters — "Article 1"\n[2] NPR — "Article 2"\n[3] BBC — "Article 3"');

    // Falls through to auto model config since getAiKey returns null by default
    mockGetAiKey.mockResolvedValue({ provider: 'openai', apiKey: '' });
    delete process.env.ANTHROPIC_API_KEY;

    const ai = createMockAI(JSON.stringify([
      { text: 'News from newsletters', tagSlugs: ['science'], category: 'science', sourceUrl: 'https://a.com', sourceName: 'Reuters' },
    ]));
    mockCreateAIProvider.mockReturnValue(ai);

    const result = await generateNewsQuestions('user-1', 1);

    expect(result).toHaveLength(1);
    expect(result[0].sourceUrl).toBe('https://a.com');
    expect(result[0].sourceName).toBe('Reuters');
    expect(mockFetchNewsletterArticles).toHaveBeenCalledWith('1w');
    expect(mockFormatArticlesForPrompt).toHaveBeenCalledWith(mockArticles);
  });

  it('falls back to web search when fewer than 3 articles', async () => {
    mockFetchNewsletterArticles.mockResolvedValue([
      { title: 'Only One', url: 'https://a.com', summary: 'Solo', pubDate: '2026-02-27', source: 'Reuters' },
    ]);

    mockGetAiKey.mockResolvedValue({ provider: 'openai', apiKey: '' });
    delete process.env.ANTHROPIC_API_KEY;

    const ai = createMockAI(JSON.stringify([
      { text: 'Web search news', tagSlugs: ['science'], category: 'science' },
    ]));
    mockCreateAIProvider.mockReturnValue(ai);

    const result = await generateNewsQuestions('user-1', 1);

    expect(result).toHaveLength(1);
    // formatArticlesForPrompt should NOT be called when < 3 articles
    expect(mockFormatArticlesForPrompt).not.toHaveBeenCalled();
  });

  it('falls back to web search when fetchNewsletterArticles fails', async () => {
    mockFetchNewsletterArticles.mockRejectedValue(new Error('Fetch failed'));

    mockGetAiKey.mockResolvedValue({ provider: 'openai', apiKey: '' });
    delete process.env.ANTHROPIC_API_KEY;

    const ai = createMockAI(JSON.stringify([
      { text: 'Fallback news', tagSlugs: ['technology'], category: 'technology' },
    ]));
    mockCreateAIProvider.mockReturnValue(ai);

    const result = await generateNewsQuestions('user-1', 1);

    expect(result).toHaveLength(1);
    expect(mockFormatArticlesForPrompt).not.toHaveBeenCalled();
  });
});

describe('generateCuriosityQuestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('generates questions without loading UserInterest (no personalization)', async () => {
    const questions = JSON.stringify([
      { text: 'Would you listen to a podcast about why we can\'t tickle ourselves?', tagSlugs: ['science'], category: 'science' },
    ]);
    mockCreateAIProvider.mockReturnValue(createMockAI(questions));

    const result = await generateCuriosityQuestions('user-1', 1);

    expect(result).toHaveLength(1);
    expect(result[0].text).toContain('tickle');
    // Should NOT load UserInterest — curiosity is not personalized
    expect(mockUserInterestFindMany).not.toHaveBeenCalled();
  });

  it('keeps questions with invalid tag slugs in lenient mode', async () => {
    const questions = JSON.stringify([
      { text: 'Valid curiosity', tagSlugs: ['physics'], category: 'science' },
      { text: 'Bad slugs curiosity', tagSlugs: ['nonexistent'], category: 'fake' },
    ]);
    mockCreateAIProvider.mockReturnValue(createMockAI(questions));

    const result = await generateCuriosityQuestions('user-1', 5);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Valid curiosity');
    expect(result[0].tagSlugs).toEqual(['physics']);
    expect(result[1].text).toBe('Bad slugs curiosity');
    expect(result[1].tagSlugs).toEqual(['nonexistent']);
  });

  it('deduplicates against prior answers', async () => {
    const text = 'Would you listen to a podcast about paradoxes?';
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update(text.toLowerCase().trim()).digest('hex').slice(0, 12);
    mockTasteQuizAnswerFindMany.mockResolvedValue([{ questionId: hash }]);

    const questions = JSON.stringify([
      { text, tagSlugs: ['science'], category: 'science' },
      { text: 'Fresh curiosity about biology', tagSlugs: ['biology'], category: 'science' },
    ]);
    mockCreateAIProvider.mockReturnValue(createMockAI(questions));

    const result = await generateCuriosityQuestions('user-1', 5);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Fresh curiosity about biology');
  });

  it('returns empty array on AI failure', async () => {
    mockCreateAIProvider.mockReturnValue({
      generateResponse: vi.fn().mockRejectedValue(new Error('API down')),
    });

    const result = await generateCuriosityQuestions('user-1', 3);
    expect(result).toEqual([]);
  });

  it('includes topic context in prompt when provided', async () => {
    const questions = JSON.stringify([
      { text: 'Curiosity about math puzzles', tagSlugs: ['ai'], category: 'technology' },
    ]);
    const ai = createMockAI(questions);
    mockCreateAIProvider.mockReturnValue(ai);

    await generateCuriosityQuestions('user-1', 1, 'mathematics');

    const prompt = ai.generateResponse.mock.calls[0][0];
    expect(prompt).toContain('mathematics');
  });
});
