import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { WriteScriptPayload } from '@/lib/queue';

const mockPrismaScriptFindUnique = vi.fn();
const mockPrismaScriptCreate = vi.fn();
const mockPrismaResearchDossierFindUniqueOrThrow = vi.fn();
const mockPrismaCreativeOutlineFindUniqueOrThrow = vi.fn();
const mockPrismaDiscoveryFindUniqueOrThrow = vi.fn();
const mockPrismaEpisodeFindUniqueOrThrow = vi.fn();
const mockPrismaEpisodeUpdate = vi.fn();
const mockPrismaUserFindUniqueOrThrow = vi.fn();
const mockPrismaReferenceCreateMany = vi.fn();
const mockPrismaTagFindMany = vi.fn();
const mockPrismaEpisodeTagUpsert = vi.fn();

vi.mock('@/lib/prisma', () => {
  const prisma = {
    script: {
      findUnique: (...args: unknown[]) => mockPrismaScriptFindUnique(...args),
      create: (...args: unknown[]) => mockPrismaScriptCreate(...args),
    },
    researchDossier: {
      findUniqueOrThrow: (...args: unknown[]) =>
        mockPrismaResearchDossierFindUniqueOrThrow(...args),
    },
    creativeOutline: {
      findUniqueOrThrow: (...args: unknown[]) =>
        mockPrismaCreativeOutlineFindUniqueOrThrow(...args),
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
    reference: {
      createMany: (...args: unknown[]) => mockPrismaReferenceCreateMany(...args),
    },
    tag: {
      findMany: (...args: unknown[]) => mockPrismaTagFindMany(...args),
    },
    episodeTag: {
      upsert: (...args: unknown[]) => mockPrismaEpisodeTagUpsert(...args),
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
const mockGetCheapestModelForProvider = vi.fn((provider: string) => {
  if (provider === 'openai') return 'gpt-5-nano';
  if (provider === 'claude-code') return 'haiku';
  return 'claude-haiku-4-5-20251001';
});

vi.mock('@/lib/providers/ai-registry', () => ({
  resolveAiModelAndProvider: mockResolveAiModelAndProvider,
  getCheapestModelForProvider: (provider: string) => mockGetCheapestModelForProvider(provider),
  getProviderForModel: (model: string) =>
    model === 'codex' || model.startsWith('codex:')
      ? 'codex'
      : model.startsWith('claude-code:')
        ? 'claude-code'
        : model.startsWith('local:')
          ? 'local'
          : 'anthropic',
  providerRequiresAiKey: (provider: string) =>
    provider !== 'claude-code' && provider !== 'codex' && provider !== 'local',
}));

const { mockWriteScript } = vi.hoisted(() => ({
  mockWriteScript: vi.fn().mockResolvedValue({
    turns: [{ speaker: 'Host', text: 'Hello world.' }],
    soundCues: [],
    references: [
      {
        title: 'Reference A',
        authors: 'Author',
        year: 2024,
        url: 'https://example.com/a',
        type: 'WEB',
        publisher: null,
        doi: null,
      },
    ],
    places: [],
    markdown: '# Script',
    inputTokens: 100,
    outputTokens: 50,
    model: 'claude-haiku-4-5-20251001',
  }),
}));

vi.mock('@/lib/script-writer', () => ({
  writeScript: mockWriteScript,
}));

const mockAddJob = vi.fn();
vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { COMPILE_SCRIPT: 'compile_script' },
  compileScriptQueue: { name: 'compile-script' },
}));

vi.mock('@/lib/redis', () => ({
  invalidateEpisodeCache: vi.fn().mockResolvedValue(undefined),
  publishEpisodeStatus: vi.fn().mockResolvedValue(undefined),
}));

const mockLogUsage = vi.fn();
vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

const mockDetectLanguage = vi.fn().mockResolvedValue('en');

vi.mock('@/lib/language-detect', () => ({
  detectLanguage: (...args: unknown[]) => mockDetectLanguage(...args),
}));

vi.mock('@/lib/topic-tagger', () => ({
  matchTopicTags: vi.fn().mockReturnValue([]),
  TAG_PARENT_MAP: {},
}));

vi.mock('@/lib/pipeline-events', () => ({
  logPipelineStageComplete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processScriptWriting } from '@/workers/script-writing.worker';

function createMockJob(data: WriteScriptPayload): Job<WriteScriptPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<WriteScriptPayload>;
}

const defaultPayload: WriteScriptPayload = {
  episodeId: 'episode-001',
  userId: 'user-001',
  discoveryId: 'discovery-001',
  dossierId: 'dossier-001',
  outlineId: 'outline-001',
};

describe('processScriptWriting', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrismaScriptFindUnique.mockResolvedValue(null);
    mockPrismaResearchDossierFindUniqueOrThrow.mockResolvedValue({
      sources: [
        { sourceId: 'source-1', title: 'Source A', authors: 'Author', year: 2024, type: 'WEB' },
      ],
      evidence: [
        {
          evidenceId: 'ev-1',
          claim: 'Claim A',
          claimType: 'fact',
          sourceIds: ['source-1'],
          confidence: 0.9,
        },
      ],
    });
    mockPrismaCreativeOutlineFindUniqueOrThrow.mockResolvedValue({
      drivingQuestion: 'What changed?',
      listenerPromise: 'You will understand the change.',
      thesis: 'The change matters.',
      beats: [{ beatId: 'beat-1', purpose: 'open', summary: 'Intro', evidenceIds: ['ev-1'] }],
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
    mockPrismaUserFindUniqueOrThrow.mockResolvedValue({});
    mockPrismaScriptCreate.mockResolvedValue({ id: 'script-001' });
    mockPrismaReferenceCreateMany.mockResolvedValue({ count: 1 });
    mockPrismaTagFindMany.mockResolvedValue([]);
    mockPrismaEpisodeTagUpsert.mockResolvedValue({});
    mockPrismaEpisodeUpdate.mockResolvedValue({});
    mockAddJob.mockResolvedValue({ id: 'compile-job-1' });
    mockLogUsage.mockResolvedValue(undefined);
    mockGetAiKey.mockResolvedValue({ apiKey: 'anthropic-key', provider: 'anthropic' });
    mockResolveAiModelAndProvider.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
    });
    mockWriteScript.mockResolvedValue({
      turns: [{ speaker: 'Host', text: 'Hello world.' }],
      soundCues: [],
      references: [
        {
          title: 'Reference A',
          authors: 'Author',
          year: 2024,
          url: 'https://example.com/a',
          type: 'WEB',
          publisher: null,
          doi: null,
        },
      ],
      places: [],
      markdown: '# Script',
      inputTokens: 100,
      outputTokens: 50,
      model: 'claude-haiku-4-5-20251001',
    });
  });

  describe('AI routing', () => {
    it('uses the configured BYOK provider when the episode has no model', async () => {
      const aiKey = { apiKey: 'anthropic-key', provider: 'anthropic' };
      mockGetAiKey.mockResolvedValue(aiKey);

      await processScriptWriting(createMockJob(defaultPayload));

      expect(mockGetAiKey).toHaveBeenCalledTimes(1);
      expect(mockGetAiKey).toHaveBeenCalledWith('user-001');
      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: null,
        aiKey,
      });
      expect(mockWriteScript).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: 'anthropic-key',
          model: 'claude-haiku-4-5-20251001',
          provider: 'anthropic',
        })
      );
      expect(mockDetectLanguage).toHaveBeenCalledWith(expect.stringContaining('Hello world.'), {
        providerType: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        apiKeyOverride: 'anthropic-key',
      });
    });

    it('uses the explicit episode model owner and matching provider key', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({ aiModel: 'gpt-5-mini' });
      mockResolveAiModelAndProvider.mockResolvedValue({ model: 'gpt-5-mini', provider: 'openai' });
      mockGetAiKey.mockResolvedValue({ apiKey: 'openai-key', provider: 'openai' });

      await processScriptWriting(createMockJob(defaultPayload));

      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: 'gpt-5-mini',
        aiKey: null,
      });
      expect(mockGetAiKey).toHaveBeenCalledTimes(1);
      expect(mockGetAiKey).toHaveBeenCalledWith('user-001', 'openai');
      expect(mockWriteScript).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: 'openai-key',
          model: 'gpt-5-mini',
          provider: 'openai',
        })
      );
      expect(mockDetectLanguage).toHaveBeenCalledWith(expect.stringContaining('Hello world.'), {
        providerType: 'openai',
        model: 'gpt-5-nano',
        apiKeyOverride: 'openai-key',
      });
    });

    it('rejects explicit non-local models without a matching provider key', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({ aiModel: 'gpt-5-mini' });
      mockResolveAiModelAndProvider.mockResolvedValue({ model: 'gpt-5-mini', provider: 'openai' });
      mockGetAiKey.mockResolvedValue(null);

      await expect(processScriptWriting(createMockJob(defaultPayload))).rejects.toThrow(
        'AI key for provider "openai" is required for script writing.'
      );
      expect(mockWriteScript).not.toHaveBeenCalled();
    });

    it('rejects missing model and missing BYOK key before writing', async () => {
      mockGetAiKey.mockResolvedValue(null);

      await expect(processScriptWriting(createMockJob(defaultPayload))).rejects.toThrow(
        'AI model is required for script writing when no AI key is configured.'
      );
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockWriteScript).not.toHaveBeenCalled();
    });

    it('uses platform credentials only for explicit admin-credit routes', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({ aiModel: 'gpt-5-mini' });
      mockResolveAiModelAndProvider.mockResolvedValue({ model: 'gpt-5-mini', provider: 'openai' });

      await processScriptWriting(createMockJob({ ...defaultPayload, useAdminCredits: true }));

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: 'gpt-5-mini',
        aiKey: null,
      });
      expect(mockWriteScript).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: undefined,
          model: 'gpt-5-mini',
          provider: 'openai',
        })
      );
    });

    it('rejects admin-credit routes without an explicit model', async () => {
      await expect(
        processScriptWriting(createMockJob({ ...defaultPayload, useAdminCredits: true }))
      ).rejects.toThrow('AI model is required for script writing when no AI key is configured.');
      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockWriteScript).not.toHaveBeenCalled();
    });

    it('allows local claude-code models without provider keys', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({ aiModel: 'claude-code:sonnet' });
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'claude-code:sonnet',
        provider: 'claude-code',
      });
      mockGetAiKey.mockResolvedValue(null);

      await processScriptWriting(createMockJob(defaultPayload));

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockWriteScript).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: undefined,
          model: 'claude-code:sonnet',
          provider: 'claude-code',
        })
      );
    });

    it('skips AI routing when the script already exists', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue({ id: 'script-001' });

      await processScriptWriting(createMockJob(defaultPayload));

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockWriteScript).not.toHaveBeenCalled();
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'compile-script' },
        'compile_script',
        { episodeId: 'episode-001', userId: 'user-001' },
        { jobId: expect.stringMatching(/^compile-episode-001-/) }
      );
    });
  });
});
