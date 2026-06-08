import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { GenerateQuizPayload } from '@/lib/queue';

const mockPodcastQuizFindUnique = vi.fn();
const mockPodcastQuizCreate = vi.fn();
const mockPodcastQuizDelete = vi.fn();
const mockPodcastQuizUpdate = vi.fn();
const mockScriptFindUnique = vi.fn();
const mockPodcastFindUniqueOrThrow = vi.fn();
const mockVocabularyEntryFindMany = vi.fn();
const mockQuizQuestionCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/prisma', () => {
  const db = {
    podcastQuiz: {
      findUnique: (...args: unknown[]) => mockPodcastQuizFindUnique(...args),
      create: (...args: unknown[]) => mockPodcastQuizCreate(...args),
      delete: (...args: unknown[]) => mockPodcastQuizDelete(...args),
      update: (...args: unknown[]) => mockPodcastQuizUpdate(...args),
    },
    script: {
      findUnique: (...args: unknown[]) => mockScriptFindUnique(...args),
    },
    podcast: {
      findUniqueOrThrow: (...args: unknown[]) => mockPodcastFindUniqueOrThrow(...args),
    },
    vocabularyEntry: {
      findMany: (...args: unknown[]) => mockVocabularyEntryFindMany(...args),
    },
    quizQuestion: {
      create: (...args: unknown[]) => mockQuizQuestionCreate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  };
  return { prismaUnfiltered: db, prisma: db };
});

const mockGenerateResponse = vi.fn();
const mockCreateAIProvider = vi.fn();

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: (...args: unknown[]) => mockCreateAIProvider(...args),
}));

const mockResolveAiModelAndProvider = vi.fn();

vi.mock('@/lib/providers/ai-registry', () => ({
  resolveAiModelAndProvider: (...args: unknown[]) => mockResolveAiModelAndProvider(...args),
}));

const mockGetAiKey = vi.fn();

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));

vi.mock('@/lib/prompt-loader', () => ({
  loadAndRender: vi.fn().mockReturnValue('rendered quiz prompt'),
}));

const mockLogUsage = vi.fn();

vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { processQuizGeneration } from '@/workers/quiz-generation.worker';

function createJob(data: GenerateQuizPayload = { podcastId: 'podcast-1' }): Job<GenerateQuizPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<GenerateQuizPayload>;
}

const validTurns = [
  { speaker: 'HOST', text: 'Intro' },
  { speaker: 'EXPERT', text: 'Point one' },
  { speaker: 'HOST', text: 'Question' },
  { speaker: 'EXPERT', text: 'Answer' },
  { speaker: 'HOST', text: 'Wrap' },
];

const quizQuestions = [
  {
    question: 'What was discussed?',
    options: ['A topic', 'A recipe', 'A route', 'A song'],
    correctIndex: 0,
    explanation: 'The script discusses a topic.',
    turnIndex: 1,
  },
];

describe('processQuizGeneration AI routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPodcastQuizFindUnique.mockResolvedValue(null);
    mockPodcastQuizCreate.mockResolvedValue({ id: 'quiz-1' });
    mockPodcastQuizDelete.mockResolvedValue({});
    mockPodcastQuizUpdate.mockResolvedValue({});
    mockScriptFindUnique.mockResolvedValue({ turns: validTurns, context: 'Context' });
    mockPodcastFindUniqueOrThrow.mockResolvedValue({
      userId: 'user-1',
      aiModel: 'gpt-5-mini',
      user: { plan: 'FREE' },
    });
    mockVocabularyEntryFindMany.mockResolvedValue([]);
    mockQuizQuestionCreate.mockImplementation((args) => args);
    mockTransaction.mockResolvedValue([]);
    mockGetAiKey.mockResolvedValue({ apiKey: 'provider-key', provider: 'openai' });
    mockResolveAiModelAndProvider.mockResolvedValue({ model: 'gpt-5-mini', provider: 'openai' });
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(quizQuestions),
      inputTokens: 10,
      outputTokens: 20,
      model: 'gpt-5-mini',
    });
    mockCreateAIProvider.mockReturnValue({ generateResponse: mockGenerateResponse });
  });

  it('uses the podcast model owner and matching provider key', async () => {
    await processQuizGeneration(createJob());

    expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
      podcastAiModel: 'gpt-5-mini',
      aiKey: null,
      plan: 'FREE',
    });
    expect(mockGetAiKey).toHaveBeenCalledTimes(1);
    expect(mockGetAiKey).toHaveBeenCalledWith('user-1', 'openai');
    expect(mockCreateAIProvider).toHaveBeenCalledWith('openai');
    expect(mockGenerateResponse).toHaveBeenCalledWith(
      'You are a quiz generation assistant. Return only valid JSON.',
      [{ role: 'user', content: 'rendered quiz prompt' }],
      { model: 'gpt-5-mini', apiKeyOverride: 'provider-key' },
    );
    expect(mockPodcastQuizUpdate).toHaveBeenCalledWith({
      where: { id: 'quiz-1' },
      data: { status: 'READY', model: 'gpt-5-mini', provider: 'openai' },
    });
  });

  it('fails the quiz when an explicit model has no matching provider key', async () => {
    mockGetAiKey.mockResolvedValue(null);

    await processQuizGeneration(createJob());

    expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
      podcastAiModel: 'gpt-5-mini',
      aiKey: null,
      plan: 'FREE',
    });
    expect(mockGetAiKey).toHaveBeenCalledWith('user-1', 'openai');
    expect(mockCreateAIProvider).not.toHaveBeenCalled();
    expect(mockPodcastQuizUpdate).toHaveBeenCalledWith({
      where: { id: 'quiz-1' },
      data: { status: 'FAILED' },
    });
  });

  it('uses the configured BYOK provider when the podcast has no model', async () => {
    const aiKey = { apiKey: 'anthropic-key', provider: 'anthropic' };
    mockPodcastFindUniqueOrThrow.mockResolvedValue({
      userId: 'user-1',
      aiModel: null,
      user: { plan: 'FREE' },
    });
    mockGetAiKey.mockResolvedValue(aiKey);
    mockResolveAiModelAndProvider.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
    });

    await processQuizGeneration(createJob());

    expect(mockGetAiKey).toHaveBeenCalledTimes(1);
    expect(mockGetAiKey).toHaveBeenCalledWith('user-1');
    expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
      podcastAiModel: null,
      aiKey,
      plan: 'FREE',
    });
    expect(mockCreateAIProvider).toHaveBeenCalledWith('anthropic');
    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      { model: 'claude-haiku-4-5-20251001', apiKeyOverride: 'anthropic-key' },
    );
  });

  it('fails the quiz when no explicit model or AI key is configured', async () => {
    mockPodcastFindUniqueOrThrow.mockResolvedValue({
      userId: 'user-1',
      aiModel: null,
      user: { plan: 'FREE' },
    });
    mockGetAiKey.mockResolvedValue(null);

    await processQuizGeneration(createJob());

    expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
    expect(mockCreateAIProvider).not.toHaveBeenCalled();
    expect(mockPodcastQuizUpdate).toHaveBeenCalledWith({
      where: { id: 'quiz-1' },
      data: { status: 'FAILED' },
    });
  });

  it('routes explicit Claude Code models without fetching a BYOK key', async () => {
    mockPodcastFindUniqueOrThrow.mockResolvedValue({
      userId: 'user-1',
      aiModel: 'claude-code:opus',
      user: { plan: 'PRO' },
    });
    mockResolveAiModelAndProvider.mockResolvedValue({
      model: 'claude-code:opus',
      provider: 'claude-code',
    });

    await processQuizGeneration(createJob());

    expect(mockGetAiKey).not.toHaveBeenCalled();
    expect(mockCreateAIProvider).toHaveBeenCalledWith('claude-code');
    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      { model: 'claude-code:opus', apiKeyOverride: undefined },
    );
  });
});
