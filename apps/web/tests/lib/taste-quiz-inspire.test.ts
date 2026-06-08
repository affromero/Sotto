import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockTagFindMany = vi.fn();
const mockUserInterestFindMany = vi.fn();
const mockTasteQuizAnswerFindMany = vi.fn();
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

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: (...args: unknown[]) => mockCreateAIProvider(...args),
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  getProviderForModel: (id: string) => {
    if (id.startsWith('claude')) return 'anthropic';
    if (id.startsWith('gpt')) return 'openai';
    if (id === 'sonnet' || id === 'opus') return 'claude-code';
    return null;
  },
  getAllAiProviderMeta: vi.fn(() => []),
  getAiProviderMeta: vi.fn((id: string) => {
    if (id === 'anthropic') return { defaultModel: 'claude-haiku-4-5-20251001', models: [] };
    if (id === 'openai') return { defaultModel: 'gpt-5-mini', models: [] };
    if (id === 'claude-code') return { defaultModel: 'opus', models: [] };
    return { defaultModel: '', models: [] };
  }),
  getAiProviderIdsWithPricing: vi.fn(() => []),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/redis', () => ({
  inspireFailures: { push: vi.fn().mockResolvedValue(undefined) },
}));

import { generateForYouQuestions, generateCuriosityQuestions } from '@/lib/taste-quiz';

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
  mockUserInterestFindMany.mockResolvedValue([]);
  mockUserFindUnique.mockResolvedValue({ plan: 'FREE' });
  mockGetAiKey.mockImplementation(async (_userId: string, provider?: string) => {
    if (provider === 'openai') return { provider: 'openai', apiKey: 'openai-key' };
    if (provider === 'anthropic') return { provider: 'anthropic', apiKey: 'anthropic-key' };
    return { provider: 'anthropic', apiKey: 'anthropic-key' };
  });
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

  it('returns empty array when an explicit hosted model has no matching key', async () => {
    mockGetAiKey.mockImplementation(async (_userId: string, provider?: string) => {
      if (provider === 'openai') return null;
      return { provider: 'anthropic', apiKey: 'anthropic-key' };
    });

    const result = await generateForYouQuestions('user-1', 1, undefined, undefined, 'gpt-5-mini');

    expect(result).toEqual([]);
    expect(mockGetAiKey).toHaveBeenCalledWith('user-1', 'openai');
  });

  it('returns empty array when an explicit model is unknown', async () => {
    const result = await generateForYouQuestions('user-1', 1, undefined, undefined, 'llama-3.1-8b-instant');

    expect(result).toEqual([]);
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
