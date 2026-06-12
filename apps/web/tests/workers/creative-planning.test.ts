import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { CreativePlanningPayload } from '@/lib/queue';

const mockPrismaCreativeOutlineFindUnique = vi.fn();
const mockPrismaCreativeOutlineCreate = vi.fn();
const mockPrismaResearchDossierFindUniqueOrThrow = vi.fn();
const mockPrismaDiscoveryFindUniqueOrThrow = vi.fn();
const mockPrismaEpisodeFindUniqueOrThrow = vi.fn();
const mockPrismaEpisodeUpdate = vi.fn();
const mockPrismaUserFindUniqueOrThrow = vi.fn();

vi.mock('@/lib/prisma', () => {
  const prisma = {
    creativeOutline: {
      findUnique: (...args: unknown[]) => mockPrismaCreativeOutlineFindUnique(...args),
      create: (...args: unknown[]) => mockPrismaCreativeOutlineCreate(...args),
    },
    researchDossier: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaResearchDossierFindUniqueOrThrow(...args),
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
}));

const { mockCreateCreativeOutline } = vi.hoisted(() => ({
  mockCreateCreativeOutline: vi.fn().mockResolvedValue({
    drivingQuestion: 'What changed?',
    listenerPromise: 'You will understand the change.',
    thesis: 'Private audio changes the workflow.',
    narrativeFramework: 'anecdote_reflection',
    speakerRoles: [{ speaker: 'Host', role: 'Curious host' }],
    beats: [
      {
        beatId: 'beat-1',
        purpose: 'hook',
        summary: 'Open with the privacy problem.',
        evidenceIds: ['ev-1'],
        requiredSourceIds: ['source-1'],
        speaker: 'Host',
        targetDurationSeconds: 60,
        tone: 'casual',
      },
    ],
    tensionCurve: [{ beatOrder: 1, tension: 0.6 }],
    bannedAngles: [],
    unresolvedQuestions: [],
    inputTokens: 100,
    outputTokens: 50,
    model: 'claude-haiku-4-5-20251001',
  }),
}));

vi.mock('@/lib/creative-director', () => ({
  createCreativeOutline: mockCreateCreativeOutline,
}));

const mockAddJob = vi.fn();
vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { WRITE_SCRIPT: 'write_script' },
  scriptWritingQueue: { name: 'script-writing' },
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

import { processCreativePlanning } from '@/workers/creative-planning.worker';

function createMockJob(data: CreativePlanningPayload): Job<CreativePlanningPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<CreativePlanningPayload>;
}

const defaultPayload: CreativePlanningPayload = {
  episodeId: 'episode-001',
  userId: 'user-001',
  discoveryId: 'discovery-001',
  dossierId: 'dossier-001',
};

describe('processCreativePlanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrismaCreativeOutlineFindUnique.mockResolvedValue(null);
    mockPrismaCreativeOutlineCreate.mockResolvedValue({ id: 'outline-001' });
    mockPrismaResearchDossierFindUniqueOrThrow.mockResolvedValue({
      sources: [{ sourceId: 'source-1', title: 'Source A', authors: 'Author', year: 2024, type: 'WEB' }],
      evidence: [{ evidenceId: 'ev-1', claim: 'Claim A', claimType: 'fact', sourceIds: ['source-1'], confidence: 0.9 }],
      recommendedAngle: 'Focus on private workflows.',
    });
    mockPrismaDiscoveryFindUniqueOrThrow.mockResolvedValue({
      topic: 'Private episodes',
      depth: 'standard',
      tone: 'casual',
      audience: 'general',
      audienceLevel: 'intermediate',
      durationTarget: 10,
      speakers: [{ name: 'Host', description: 'Curious host' }],
    });
    mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({ aiModel: null });
    mockPrismaEpisodeUpdate.mockResolvedValue({});
    mockPrismaUserFindUniqueOrThrow.mockResolvedValue({});
    mockAddJob.mockResolvedValue({ id: 'write-job-1' });
    mockLogUsage.mockResolvedValue(undefined);
    mockGetAiKey.mockResolvedValue({ apiKey: 'anthropic-key', provider: 'anthropic' });
    mockResolveAiModelAndProvider.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
    });
    mockCreateCreativeOutline.mockResolvedValue({
      drivingQuestion: 'What changed?',
      listenerPromise: 'You will understand the change.',
      thesis: 'Private audio changes the workflow.',
      narrativeFramework: 'anecdote_reflection',
      speakerRoles: [{ speaker: 'Host', role: 'Curious host' }],
      beats: [
        {
          beatId: 'beat-1',
          purpose: 'hook',
          summary: 'Open with the privacy problem.',
          evidenceIds: ['ev-1'],
          requiredSourceIds: ['source-1'],
          speaker: 'Host',
          targetDurationSeconds: 60,
          tone: 'casual',
        },
      ],
      tensionCurve: [{ beatOrder: 1, tension: 0.6 }],
      bannedAngles: [],
      unresolvedQuestions: [],
      inputTokens: 100,
      outputTokens: 50,
      model: 'claude-haiku-4-5-20251001',
    });
  });

  describe('AI routing', () => {
    it('uses the configured BYOK provider when the episode has no model', async () => {
      const aiKey = { apiKey: 'anthropic-key', provider: 'anthropic' };
      mockGetAiKey.mockResolvedValue(aiKey);

      await processCreativePlanning(createMockJob(defaultPayload));

      expect(mockGetAiKey).toHaveBeenCalledTimes(1);
      expect(mockGetAiKey).toHaveBeenCalledWith('user-001');
      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: null,
        aiKey,
      });
      expect(mockCreateCreativeOutline).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: 'anthropic-key',
          model: 'claude-haiku-4-5-20251001',
          provider: 'anthropic',
        }),
      );
    });

    it('uses the explicit episode model owner and matching provider key', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({ aiModel: 'gpt-5-mini' });
      mockResolveAiModelAndProvider.mockResolvedValue({ model: 'gpt-5-mini', provider: 'openai' });
      mockGetAiKey.mockResolvedValue({ apiKey: 'openai-key', provider: 'openai' });

      await processCreativePlanning(createMockJob(defaultPayload));

      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: 'gpt-5-mini',
        aiKey: null,
      });
      expect(mockGetAiKey).toHaveBeenCalledTimes(1);
      expect(mockGetAiKey).toHaveBeenCalledWith('user-001', 'openai');
      expect(mockCreateCreativeOutline).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: 'openai-key',
          model: 'gpt-5-mini',
          provider: 'openai',
        }),
      );
    });

    it('rejects explicit non-local models without a matching provider key', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({ aiModel: 'gpt-5-mini' });
      mockResolveAiModelAndProvider.mockResolvedValue({ model: 'gpt-5-mini', provider: 'openai' });
      mockGetAiKey.mockResolvedValue(null);

      await expect(processCreativePlanning(createMockJob(defaultPayload))).rejects.toThrow(
        'AI key for provider "openai" is required for creative planning.',
      );
      expect(mockCreateCreativeOutline).not.toHaveBeenCalled();
    });

    it('rejects missing model and missing BYOK key before planning', async () => {
      mockGetAiKey.mockResolvedValue(null);

      await expect(processCreativePlanning(createMockJob(defaultPayload))).rejects.toThrow(
        'AI model is required for creative planning when no AI key is configured.',
      );
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockCreateCreativeOutline).not.toHaveBeenCalled();
    });

    it('uses platform credentials only for explicit admin-credit routes', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({ aiModel: 'gpt-5-mini' });
      mockResolveAiModelAndProvider.mockResolvedValue({ model: 'gpt-5-mini', provider: 'openai' });

      await processCreativePlanning(createMockJob({ ...defaultPayload, useAdminCredits: true }));

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: 'gpt-5-mini',
        aiKey: null,
      });
      expect(mockCreateCreativeOutline).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: undefined,
          model: 'gpt-5-mini',
          provider: 'openai',
        }),
      );
    });

    it('rejects admin-credit routes without an explicit model', async () => {
      await expect(
        processCreativePlanning(createMockJob({ ...defaultPayload, useAdminCredits: true })),
      ).rejects.toThrow('AI model is required for creative planning when no AI key is configured.');
      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockCreateCreativeOutline).not.toHaveBeenCalled();
    });

    it('allows local claude-code models without provider keys', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({ aiModel: 'claude-code:sonnet' });
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'claude-code:sonnet',
        provider: 'claude-code',
      });
      mockGetAiKey.mockResolvedValue(null);

      await processCreativePlanning(createMockJob(defaultPayload));

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockCreateCreativeOutline).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: undefined,
          model: 'claude-code:sonnet',
          provider: 'claude-code',
        }),
      );
    });

    it('skips AI routing when the outline already exists', async () => {
      mockPrismaCreativeOutlineFindUnique.mockResolvedValue({ id: 'outline-001' });

      await processCreativePlanning(createMockJob(defaultPayload));

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockCreateCreativeOutline).not.toHaveBeenCalled();
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'script-writing' },
        'write_script',
        {
          episodeId: 'episode-001',
          userId: 'user-001',
          discoveryId: 'discovery-001',
          dossierId: 'dossier-001',
          outlineId: 'outline-001',
          useAdminCredits: undefined,
        },
        { jobId: expect.stringMatching(/^write-episode-001-/) },
      );
    });
  });
});
