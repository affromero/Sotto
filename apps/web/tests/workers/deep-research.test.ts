import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { DeepResearchPayload } from '@/lib/queue';

const mockPrismaResearchDossierFindUnique = vi.fn();
const mockPrismaResearchDossierCreate = vi.fn();
const mockPrismaDiscoveryFindUniqueOrThrow = vi.fn();
const mockPrismaEpisodeFindUniqueOrThrow = vi.fn();
const mockPrismaEpisodeUpdate = vi.fn();
const mockPrismaUserFindUniqueOrThrow = vi.fn();

vi.mock('@/lib/prisma', () => {
  const prisma = {
    researchDossier: {
      findUnique: (...args: unknown[]) => mockPrismaResearchDossierFindUnique(...args),
      create: (...args: unknown[]) => mockPrismaResearchDossierCreate(...args),
    },
    discovery: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaDiscoveryFindUniqueOrThrow(...args),
    },
    episode: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaEpisodeFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockPrismaEpisodeUpdate(...args),
    },
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaUserFindUniqueOrThrow(...args),
    },
  };
  return { prisma, prismaUnfiltered: prisma };
});

const { mockGetAiKey } = vi.hoisted(() => ({
  mockGetAiKey: vi.fn().mockResolvedValue({ apiKey: 'anthropic-key', provider: 'anthropic' }),
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: mockGetAiKey,
}));

const { mockResolveAiModelAndProvider } = vi.hoisted(() => ({
  mockResolveAiModelAndProvider: vi.fn().mockResolvedValue({
    model: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
  }),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  resolveAiModelAndProvider: mockResolveAiModelAndProvider,
  providerRequiresAiKey: (provider: string) =>
    provider !== 'claude-code' && provider !== 'codex' && provider !== 'local',
}));
vi.mock('@/lib/sidedoor/jobs/core/durable-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sidedoor/jobs/core/durable-queue')>()),
  durableJobProviderExecution: (_job: unknown, userId: string, signal?: AbortSignal) => ({
    userId,
    signal,
    authorize: vi.fn(),
  }),
  transitionDurableQueueJob: async ({
    queue,
    type,
    payload,
    jobId,
    mutate,
  }: {
    queue: { name: string };
    type: string;
    payload: unknown;
    jobId: string;
    mutate: (database: { episode: { update: typeof mockPrismaEpisodeUpdate } }) => Promise<void>;
  }) => {
    await mutate({ episode: { update: mockPrismaEpisodeUpdate } });
    return mockEnqueueDurableJob(queue, type, payload, { jobId });
  },
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedEpisodeAi: async ({
    userId,
    aiModel,
    allowSharing,
  }: {
    userId: string;
    aiModel?: string | null;
    allowSharing?: boolean;
  }) => {
    if (!aiModel) {
      if (allowSharing)
        throw new Error('AI model is required for deep research when no AI key is configured.');
      const aiKey = await mockGetAiKey(userId);
      if (!aiKey)
        throw new Error('AI model is required for deep research when no AI key is configured.');
      return { ...(await mockResolveAiModelAndProvider({ episodeAiModel: null, aiKey })), aiKey };
    }
    const resolved = await mockResolveAiModelAndProvider({ episodeAiModel: aiModel, aiKey: null });
    if (['claude-code', 'codex', 'local'].includes(resolved.provider) || allowSharing)
      return { ...resolved, aiKey: null };
    const aiKey = await mockGetAiKey(userId, resolved.provider);
    if (!aiKey)
      throw new Error(`AI key for provider "${resolved.provider}" is required for deep research.`);
    return { ...resolved, aiKey };
  },
  capturedLearningAiOptions: async (ai: {
    model: string;
    provider: string;
    aiKey?: { apiKey: string } | null;
  }) => ({
    model: ai.model,
    provider: ai.provider,
    apiKeyOverride: ai.aiKey?.apiKey,
  }),
}));

const { mockBuildResearchDossier } = vi.hoisted(() => ({
  mockBuildResearchDossier: vi.fn().mockResolvedValue({
    mode: 'open-web',
    userBrief: { topic: 'Private episodes' },
    sources: [],
    evidence: [],
    gaps: [],
    blockedClaims: [],
    recommendedAngle: null,
    totalInputTokens: 120,
    totalOutputTokens: 60,
    model: 'claude-haiku-4-5-20251001',
  }),
}));

vi.mock('@/lib/research-agent', () => ({
  buildResearchDossier: mockBuildResearchDossier,
}));

const mockEnqueueDurableJob = vi.fn();
vi.mock('@/lib/queue', () => ({
  enqueueDurableJob: (...args: unknown[]) => mockEnqueueDurableJob(...args),
  JobType: { CREATIVE_PLANNING: 'creative_planning' },
  creativePlanningQueue: { name: 'creative-planning' },
}));

vi.mock('@/lib/redis', () => ({
  invalidateEpisodeCache: vi.fn().mockResolvedValue(undefined),
  publishEpisodeStatus: vi.fn().mockResolvedValue(undefined),
}));

const mockLogUsage = vi.fn();
vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

vi.mock('@/lib/pipeline-events', () => ({
  logPipelineStageComplete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processDeepResearch } from '@/workers/deep-research.worker';

function createMockJob(data: DeepResearchPayload): Job<DeepResearchPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<DeepResearchPayload>;
}

const defaultPayload: DeepResearchPayload = {
  episodeId: 'episode-001',
  userId: 'user-001',
  discoveryId: 'discovery-001',
};

describe('processDeepResearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrismaResearchDossierFindUnique.mockResolvedValue(null);
    mockPrismaResearchDossierCreate.mockResolvedValue({ id: 'dossier-001' });
    mockPrismaDiscoveryFindUniqueOrThrow.mockResolvedValue({
      topic: 'Private episodes',
      depth: 'standard',
      tone: 'casual',
      audience: 'general',
      audienceLevel: 'intermediate',
      durationTarget: 10,
      focusAreas: [],
      sourceContent: null,
      sourceUrl: null,
      messages: [{ role: 'user', content: 'Make a private briefing.' }],
    });
    mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
      source: 'WEB',
      aiProvider: null,
      aiModel: null,
    });
    mockPrismaEpisodeUpdate.mockResolvedValue({});
    mockPrismaUserFindUniqueOrThrow.mockResolvedValue({});
    mockEnqueueDurableJob.mockResolvedValue({ id: 'planning-job-1' });
    mockLogUsage.mockResolvedValue(undefined);
    mockGetAiKey.mockResolvedValue({ apiKey: 'anthropic-key', provider: 'anthropic' });
    mockResolveAiModelAndProvider.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
    });
    mockBuildResearchDossier.mockResolvedValue({
      mode: 'open-web',
      userBrief: { topic: 'Private episodes' },
      sources: [],
      evidence: [],
      gaps: [],
      blockedClaims: [],
      recommendedAngle: null,
      totalInputTokens: 120,
      totalOutputTokens: 60,
      model: 'claude-haiku-4-5-20251001',
    });
  });

  describe('AI routing', () => {
    it('uses the configured BYOK provider when the episode has no model', async () => {
      const aiKey = { apiKey: 'anthropic-key', provider: 'anthropic' };
      mockGetAiKey.mockResolvedValue(aiKey);

      await processDeepResearch(createMockJob(defaultPayload));

      expect(mockGetAiKey).toHaveBeenCalledTimes(1);
      expect(mockGetAiKey).toHaveBeenCalledWith('user-001');
      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: null,
        aiKey,
      });
      expect(mockBuildResearchDossier).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: 'anthropic-key',
          model: 'claude-haiku-4-5-20251001',
          provider: 'anthropic',
        })
      );
    });

    it('uses the explicit episode model owner and matching provider key', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        source: 'WEB',
        aiProvider: null,
        aiModel: 'gpt-5-mini',
      });
      mockResolveAiModelAndProvider.mockResolvedValue({ model: 'gpt-5-mini', provider: 'openai' });
      mockGetAiKey.mockResolvedValue({ apiKey: 'openai-key', provider: 'openai' });

      await processDeepResearch(createMockJob(defaultPayload));

      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: 'gpt-5-mini',
        aiKey: null,
      });
      expect(mockGetAiKey).toHaveBeenCalledTimes(1);
      expect(mockGetAiKey).toHaveBeenCalledWith('user-001', 'openai');
      expect(mockBuildResearchDossier).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: 'openai-key',
          model: 'gpt-5-mini',
          provider: 'openai',
        })
      );
    });

    it('rejects explicit non-local models without a matching provider key', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        source: 'WEB',
        aiProvider: null,
        aiModel: 'gpt-5-mini',
      });
      mockResolveAiModelAndProvider.mockResolvedValue({ model: 'gpt-5-mini', provider: 'openai' });
      mockGetAiKey.mockResolvedValue(null);

      await expect(processDeepResearch(createMockJob(defaultPayload))).rejects.toThrow(
        'AI key for provider "openai" is required for deep research.'
      );
      expect(mockBuildResearchDossier).not.toHaveBeenCalled();
    });

    it('rejects missing model and missing BYOK key before research', async () => {
      mockGetAiKey.mockResolvedValue(null);

      await expect(processDeepResearch(createMockJob(defaultPayload))).rejects.toThrow(
        'AI model is required for deep research when no AI key is configured.'
      );
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockBuildResearchDossier).not.toHaveBeenCalled();
    });

    it('uses platform credentials only for explicit admin-credit routes', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        source: 'WEB',
        aiProvider: null,
        aiModel: 'gpt-5-mini',
      });
      mockResolveAiModelAndProvider.mockResolvedValue({ model: 'gpt-5-mini', provider: 'openai' });

      await processDeepResearch(createMockJob({ ...defaultPayload, allowSharedCredential: true }));

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: 'gpt-5-mini',
        aiKey: null,
      });
      expect(mockBuildResearchDossier).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: undefined,
          model: 'gpt-5-mini',
          provider: 'openai',
        })
      );
    });

    it('rejects admin-credit routes without an explicit model', async () => {
      await expect(
        processDeepResearch(createMockJob({ ...defaultPayload, allowSharedCredential: true }))
      ).rejects.toThrow('AI model is required for deep research when no AI key is configured.');
      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockBuildResearchDossier).not.toHaveBeenCalled();
    });

    it('allows local claude-code models without provider keys', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        source: 'WEB',
        aiProvider: null,
        aiModel: 'claude-code:sonnet',
      });
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'claude-code:sonnet',
        provider: 'claude-code',
      });
      mockGetAiKey.mockResolvedValue(null);

      await processDeepResearch(createMockJob(defaultPayload));

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockBuildResearchDossier).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: undefined,
          model: 'claude-code:sonnet',
          provider: 'claude-code',
        })
      );
    });

    it('skips AI routing when the dossier already exists', async () => {
      mockPrismaResearchDossierFindUnique.mockResolvedValue({ id: 'dossier-001' });

      await processDeepResearch(createMockJob(defaultPayload));

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockBuildResearchDossier).not.toHaveBeenCalled();
      expect(mockEnqueueDurableJob).toHaveBeenCalledWith(
        { name: 'creative-planning' },
        'creative_planning',
        {
          episodeId: 'episode-001',
          userId: 'user-001',
          discoveryId: 'discovery-001',
          dossierId: 'dossier-001',
          allowSharedCredential: undefined,
        },
        { jobId: expect.stringMatching(/^plan-episode-001-/) }
      );
    });
  });
});
