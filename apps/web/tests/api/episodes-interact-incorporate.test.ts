import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

const mockPrismaInteractionFindUnique = vi.fn();
const mockPrismaInteractionUpdate = vi.fn();
const mockPrismaEpisodeUpdate = vi.fn();
const mockPrismaSegmentFindMany = vi.fn();
const mockPrismaUserFindUniqueOrThrow = vi.fn();

vi.mock('@/lib/prisma', () => {
  const prisma = {
    interaction: {
      findUnique: (...args: unknown[]) => mockPrismaInteractionFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaInteractionUpdate(...args),
    },
    episode: {
      update: (...args: unknown[]) => mockPrismaEpisodeUpdate(...args),
    },
    segment: {
      findMany: (...args: unknown[]) => mockPrismaSegmentFindMany(...args),
    },
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaUserFindUniqueOrThrow(...args),
    },
  };
  return { prisma };
});

const mockAddJob = vi.fn();

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { REGENERATE_SEGMENT: 'regenerate_segment' },
  segmentRegenerationQueue: { name: 'segment-regeneration' },
}));

const { mockCreateAIProvider, mockGenerateResponse } = vi.hoisted(() => {
  const generateResponse = vi.fn().mockResolvedValue({
    content: 'Generated incorporation segment.',
    inputTokens: 100,
    outputTokens: 40,
    model: 'claude-haiku-4-5-20251001',
  });

  return {
    mockCreateAIProvider: vi.fn((_provider: string) => ({ generateResponse })),
    mockGenerateResponse: generateResponse,
  };
});

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: (provider: string) => mockCreateAIProvider(provider),
}));

const { mockGetAiKey } = vi.hoisted(() => ({
  mockGetAiKey: vi.fn().mockResolvedValue({ apiKey: 'anthropic-key', provider: 'anthropic' }),
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));

const { mockResolveAiModelAndProvider } = vi.hoisted(() => ({
  mockResolveAiModelAndProvider: vi.fn().mockResolvedValue({
    model: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
  }),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  resolveAiModelAndProvider: (...args: unknown[]) => mockResolveAiModelAndProvider(...args),
  providerRequiresAiKey: (provider: string) =>
    provider !== 'claude-code' && provider !== 'codex' && provider !== 'local',
}));

const mockLogUsage = vi.fn();

vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

const mockCheckRateLimit = vi.fn();

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

import { POST } from '@/app/api/v1/episodes/[episodeId]/interact/[interactionId]/incorporate/route';

function createRequest(): NextRequest {
  return new NextRequest(
    new URL(
      'http://localhost:3000/api/v1/episodes/episode-001/interact/interaction-001/incorporate'
    ),
    {
      method: 'POST',
    }
  );
}

function createParams(episodeId = 'episode-001', interactionId = 'interaction-001') {
  return { params: Promise.resolve({ episodeId, interactionId }) };
}

function createInteraction(aiModel: string | null = null) {
  return {
    id: 'interaction-001',
    episodeId: 'episode-001',
    status: 'ANSWERED',
    timestamp: 20,
    question: 'What does this mean?',
    answer: 'It means the episode can be updated.',
    episode: {
      id: 'episode-001',
      userId: 'user-001',
      status: 'READY',
      source: 'WEB',
      language: 'en',
      aiModel,
    },
  };
}

describe('POST /api/v1/episodes/[episodeId]/interact/[interactionId]/incorporate', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 19, resetAt: 0 });
    mockPrismaInteractionFindUnique.mockResolvedValue(createInteraction());
    mockPrismaInteractionUpdate.mockResolvedValue({});
    mockPrismaEpisodeUpdate.mockResolvedValue({});
    mockPrismaSegmentFindMany.mockResolvedValue([
      { order: 1, startTime: 0, duration: 15, speaker: 'HOST', text: 'Opening context.' },
      { order: 2, startTime: 15, duration: 20, speaker: 'EXPERT', text: 'Relevant context.' },
      { order: 3, startTime: 35, duration: 15, speaker: 'HOST', text: 'Follow-up context.' },
    ]);
    mockPrismaUserFindUniqueOrThrow.mockResolvedValue({});
    mockGetAiKey.mockResolvedValue({ apiKey: 'anthropic-key', provider: 'anthropic' });
    mockResolveAiModelAndProvider.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
    });
    mockCreateAIProvider.mockReturnValue({ generateResponse: mockGenerateResponse });
    mockGenerateResponse.mockResolvedValue({
      content: 'Generated incorporation segment.',
      inputTokens: 100,
      outputTokens: 40,
      model: 'claude-haiku-4-5-20251001',
    });
    mockLogUsage.mockResolvedValue(undefined);
    mockAddJob.mockResolvedValue({ id: 'regen-job-001' });
  });

  it('uses the configured BYOK provider when the episode has no model', async () => {
    const aiKey = { apiKey: 'anthropic-key', provider: 'anthropic' };
    mockGetAiKey.mockResolvedValue(aiKey);

    const response = await POST(createRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      status: 'incorporating',
      generatedText: 'Generated incorporation segment.',
    });
    expect(mockGetAiKey).toHaveBeenCalledTimes(1);
    expect(mockGetAiKey).toHaveBeenCalledWith('user-001');
    expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
      episodeAiModel: null,
      aiKey,
    });
    expect(mockCreateAIProvider).toHaveBeenCalledWith('anthropic');
    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        apiKeyOverride: 'anthropic-key',
        model: 'claude-haiku-4-5-20251001',
      })
    );
    expect(mockAddJob).toHaveBeenCalledWith(
      { name: 'segment-regeneration' },
      'regenerate_segment',
      expect.objectContaining({
        episodeId: 'episode-001',
        interactionId: 'interaction-001',
        insertAfterOrder: 2,
        newText: 'Generated incorporation segment.',
        speaker: 'EXPERT',
      }),
      { jobId: 'segment-regeneration-interaction-001' }
    );
  });

  it('uses the explicit episode model owner and matching provider key', async () => {
    mockPrismaInteractionFindUnique.mockResolvedValue(createInteraction('gpt-5-mini'));
    mockResolveAiModelAndProvider.mockResolvedValue({ model: 'gpt-5-mini', provider: 'openai' });
    mockGetAiKey.mockResolvedValue({ apiKey: 'openai-key', provider: 'openai' });

    const response = await POST(createRequest(), createParams());

    expect(response.status).toBe(202);
    expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
      episodeAiModel: 'gpt-5-mini',
      aiKey: null,
    });
    expect(mockGetAiKey).toHaveBeenCalledTimes(1);
    expect(mockGetAiKey).toHaveBeenCalledWith('user-001', 'openai');
    expect(mockCreateAIProvider).toHaveBeenCalledWith('openai');
    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        apiKeyOverride: 'openai-key',
        model: 'gpt-5-mini',
      })
    );
  });

  it('returns 403 before status mutations when no model and no BYOK key exist', async () => {
    mockGetAiKey.mockResolvedValue(null);

    const response = await POST(createRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      error: 'AI model is required for incorporation when no AI key is configured.',
      code: 'ai_key_required',
    });
    expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
    expect(mockPrismaInteractionUpdate).not.toHaveBeenCalled();
    expect(mockPrismaEpisodeUpdate).not.toHaveBeenCalled();
    expect(mockCreateAIProvider).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('returns 403 before status mutations when an explicit hosted model lacks its provider key', async () => {
    mockPrismaInteractionFindUnique.mockResolvedValue(createInteraction('gpt-5-mini'));
    mockResolveAiModelAndProvider.mockResolvedValue({ model: 'gpt-5-mini', provider: 'openai' });
    mockGetAiKey.mockResolvedValue(null);

    const response = await POST(createRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      error: 'AI key for provider "openai" is required for incorporation.',
      code: 'ai_key_required',
    });
    expect(mockGetAiKey).toHaveBeenCalledWith('user-001', 'openai');
    expect(mockPrismaInteractionUpdate).not.toHaveBeenCalled();
    expect(mockPrismaEpisodeUpdate).not.toHaveBeenCalled();
    expect(mockCreateAIProvider).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('allows local claude-code models without provider keys', async () => {
    mockPrismaInteractionFindUnique.mockResolvedValue(createInteraction('claude-code:sonnet'));
    mockResolveAiModelAndProvider.mockResolvedValue({
      model: 'claude-code:sonnet',
      provider: 'claude-code',
    });
    mockGetAiKey.mockResolvedValue(null);

    const response = await POST(createRequest(), createParams());

    expect(response.status).toBe(202);
    expect(mockGetAiKey).not.toHaveBeenCalled();
    expect(mockCreateAIProvider).toHaveBeenCalledWith('claude-code');
    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        apiKeyOverride: undefined,
        model: 'claude-code:sonnet',
      })
    );
  });
});
