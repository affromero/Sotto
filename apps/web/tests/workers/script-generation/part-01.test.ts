import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaDiscoveryFindUniqueOrThrow = vi.fn().mockResolvedValue({
  id: 'discovery-001',
  topic: 'Quantum Computing',
  depth: 'standard',
  audienceLevel: 'intermediate',
  audience: 'general',
  focusAreas: ['algorithms', 'applications'],
  tone: 'casual',
  durationTarget: 10,
  sourceContent: null,
});

const mockPrismaScriptFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaScriptCreate = vi.fn().mockResolvedValue({
  id: 'script-001',
  episodeId: 'episode-001',
});

const mockPrismaReferenceCreateMany = vi.fn().mockResolvedValue({ count: 5 });

const mockPrismaSegmentCreate = vi.fn().mockImplementation((args) => ({
  id: `segment-${args.data.order}`,
  ...args.data,
}));

const mockPrismaEpisodeUpdate = vi.fn().mockResolvedValue({});
const mockPrismaEpisodeFindUniqueOrThrow = vi
  .fn()
  .mockResolvedValue({ aiModel: null, verificationMode: 'standard' });
const mockPrismaTagFindMany = vi.fn().mockResolvedValue([
  { id: 'tag-general', slug: 'general-audience' },
  { id: 'tag-prod', slug: 'prod-ai-generated' },
  { id: 'tag-explainer', slug: 'type-explainer' },
]);
const mockPrismaEpisodeTagUpsert = vi.fn().mockResolvedValue({});
const mockPrismaPipelineEventCreate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    discovery: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaDiscoveryFindUniqueOrThrow(...args),
    },
    script: {
      findUnique: (...args: unknown[]) => mockPrismaScriptFindUnique(...args),
      create: (...args: unknown[]) => mockPrismaScriptCreate(...args),
    },
    reference: {
      createMany: (...args: unknown[]) => mockPrismaReferenceCreateMany(...args),
    },
    segment: {
      create: (...args: unknown[]) => mockPrismaSegmentCreate(...args),
    },
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({}),
    },
    episode: {
      update: (...args: unknown[]) => mockPrismaEpisodeUpdate(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaEpisodeFindUniqueOrThrow(...args),
    },
    tag: {
      findMany: (...args: unknown[]) => mockPrismaTagFindMany(...args),
    },
    episodeTag: {
      upsert: (...args: unknown[]) => mockPrismaEpisodeTagUpsert(...args),
    },
    pipelineEvent: {
      create: (...args: unknown[]) => mockPrismaPipelineEventCreate(...args),
    },
    vocabularyEntry: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(_mockPrisma)),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockGenerateScript = vi.fn().mockResolvedValue({
  turns: [
    { speaker: 'HOST', text: 'Welcome to the show!' },
    { speaker: 'EXPERT', text: 'Thanks for having me!' },
  ],
  soundCues: [
    { type: 'intro', prompt: 'warm episode intro', durationSeconds: 3, insertAfterTurn: -1 },
    { type: 'outro', prompt: 'gentle outro', durationSeconds: 4, insertAfterTurn: 1 },
  ],
  references: [],
  vocabulary: [],
  places: [],
  markdown: '**HOST:** Welcome to the show!\n\n**EXPERT:** Thanks for having me!',
  inputTokens: 1000,
  outputTokens: 500,
  model: 'claude-haiku-4-5-20251001',
});

vi.mock('@/lib/script-generator', () => ({
  generateScript: (...args: unknown[]) => mockGenerateScript(...args),
}));

const mockLogUsage = vi.fn();

vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

const mockAddJob = vi.fn().mockResolvedValue({ id: 'job-1' });

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    COMPILE_SCRIPT: 'compile_script',
    GENERATE_AUDIO: 'generate_audio',
  },
  compileScriptQueue: { name: 'compile-script' },
  audioGenerationQueue: { name: 'audio-generation' },
}));

const mockGetAiKey = vi.fn().mockResolvedValue({ apiKey: 'provider-key', provider: 'anthropic' });
const mockHasByokKey = vi.fn().mockResolvedValue(false);

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
  hasByokKey: (...args: unknown[]) => mockHasByokKey(...args),
}));

vi.mock('@/lib/generation-features', () => ({
  getGenerationFeatures: vi.fn().mockReturnValue({
    maxDurationMinutes: 40,
    maxSpeakers: 4,
    maxQaInteractions: Infinity,
    webSearchEnabled: true,
    autoApproveScript: false,
    privateAllowed: true,
    priorityQueue: true,
    analyticsEnabled: true,
  }),
}));

const mockResolveAiModelAndProvider = vi.fn().mockResolvedValue({
  model: 'claude-haiku-4-5-20251001',
  provider: 'anthropic',
});
const mockGetCheapestModelForProvider = vi.fn((provider: string) => {
  if (provider === 'openai') return 'gpt-5-nano';
  if (provider === 'claude-code') return 'haiku';
  return 'claude-haiku-4-5-20251001';
});

vi.mock('@/lib/providers/ai-registry', () => ({
  resolveAiModelAndProvider: (...args: unknown[]) => mockResolveAiModelAndProvider(...args),
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

vi.mock('@/lib/pipeline-events', () => ({
  logPipelineStageComplete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/redis', () => ({
  invalidateEpisodeCache: vi.fn().mockResolvedValue(undefined),
  publishEpisodeStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockDetectLanguage = vi.fn().mockResolvedValue(null);

vi.mock('@/lib/language-detect', () => ({
  detectLanguage: (...args: unknown[]) => mockDetectLanguage(...args),
}));

// ---- Import under test ----
import { processScriptGeneration } from '@/workers/script-generation.worker';
import type { GenerateScriptPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function createMockJob(data: GenerateScriptPayload): Job<GenerateScriptPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<GenerateScriptPayload>;
}

const defaultPayload: GenerateScriptPayload = {
  episodeId: 'episode-001',
  userId: 'user-001',
  discoveryId: 'discovery-001',
};

// ---- Tests ----

describe('processScriptGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default discovery data
    mockPrismaDiscoveryFindUniqueOrThrow.mockResolvedValue({
      id: 'discovery-001',
      topic: 'Quantum Computing',
      depth: 'standard',
      audienceLevel: 'intermediate',
      audience: 'general',
      focusAreas: ['algorithms', 'applications'],
      tone: 'casual',
      durationTarget: 10,
      sourceContent: null,
    });

    // Default script generation result (no references)
    mockGenerateScript.mockResolvedValue({
      turns: [
        { speaker: 'HOST', text: 'Welcome to the show!' },
        { speaker: 'EXPERT', text: 'Thanks for having me!' },
      ],
      soundCues: [
        { type: 'intro', prompt: 'warm episode intro', durationSeconds: 3, insertAfterTurn: -1 },
        { type: 'outro', prompt: 'gentle outro', durationSeconds: 4, insertAfterTurn: 1 },
      ],
      references: [],
      places: [],
      markdown: '**HOST:** Welcome to the show!\n\n**EXPERT:** Thanks for having me!',
      inputTokens: 1000,
      outputTokens: 500,
    });

    // Reset all Prisma mocks
    mockPrismaScriptFindUnique.mockResolvedValue(null);
    mockPrismaScriptCreate.mockResolvedValue({
      id: 'script-001',
      episodeId: 'episode-001',
    });
    mockPrismaEpisodeUpdate.mockResolvedValue({});
    mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
      aiModel: null,
      verificationMode: 'standard',
    });
    mockPrismaSegmentCreate.mockImplementation((args) => ({
      id: `segment-${args.data.order}`,
      ...args.data,
    }));
    mockAddJob.mockResolvedValue({ id: 'job-1' });
    mockGetAiKey.mockResolvedValue({ apiKey: 'anthropic-key', provider: 'anthropic' });
    mockHasByokKey.mockResolvedValue(false);

    // Reset model resolution mock
    mockResolveAiModelAndProvider.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
    });
  });

  describe('idempotency', () => {
    it('skips generation when script already exists', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue({ id: 'existing-script' });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockGenerateScript).not.toHaveBeenCalled();
      expect(mockPrismaScriptCreate).not.toHaveBeenCalled();
      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
        data: { status: 'COMPILING' },
      });
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'compile-script' },
        'compile_script',
        {
          episodeId: 'episode-001',
          userId: 'user-001',
        },
        { jobId: expect.stringMatching(/^compile-episode-001-/) }
      );
    });

    it('proceeds normally when no script exists', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue(null);

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockGenerateScript).toHaveBeenCalled();
      expect(mockPrismaScriptCreate).toHaveBeenCalled();
    });
  });

  describe('discovery metadata fetch', () => {
    it('throws if discovery not found', async () => {
      mockPrismaDiscoveryFindUniqueOrThrow.mockRejectedValue(new Error('Discovery not found'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptGeneration(job)).rejects.toThrow('Discovery not found');
    });
  });

  describe('AI routing', () => {
    it('uses the configured BYOK provider when the episode has no model', async () => {
      const aiKey = { apiKey: 'anthropic-key', provider: 'anthropic' };
      mockGetAiKey.mockResolvedValue(aiKey);

      await processScriptGeneration(createMockJob(defaultPayload));

      expect(mockGetAiKey).toHaveBeenCalledTimes(1);
      expect(mockGetAiKey).toHaveBeenCalledWith('user-001');
      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: null,
        aiKey,
      });
      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: 'anthropic-key',
          model: 'claude-haiku-4-5-20251001',
          provider: 'anthropic',
        })
      );
      expect(mockDetectLanguage).toHaveBeenCalledWith(
        expect.stringContaining('Welcome to the show!'),
        {
          providerType: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          apiKeyOverride: 'anthropic-key',
        }
      );
    });

    it('uses the explicit episode model owner and matching provider key', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        aiModel: 'gpt-5-mini',
        verificationMode: 'standard',
        source: 'WEB',
        language: null,
      });
      mockGetAiKey.mockResolvedValue({ apiKey: 'openai-key', provider: 'openai' });
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'gpt-5-mini',
        provider: 'openai',
      });

      await processScriptGeneration(createMockJob(defaultPayload));

      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: 'gpt-5-mini',
        aiKey: null,
      });
      expect(mockGetAiKey).toHaveBeenCalledTimes(1);
      expect(mockGetAiKey).toHaveBeenCalledWith('user-001', 'openai');
      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: 'openai-key',
          model: 'gpt-5-mini',
          provider: 'openai',
        })
      );
      expect(mockDetectLanguage).toHaveBeenCalledWith(
        expect.stringContaining('Welcome to the show!'),
        {
          providerType: 'openai',
          model: 'gpt-5-nano',
          apiKeyOverride: 'openai-key',
        }
      );
    });

    it('rejects explicit non-local models without a matching provider key', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        aiModel: 'gpt-5-mini',
        verificationMode: 'standard',
        source: 'WEB',
        language: null,
      });
      mockGetAiKey.mockResolvedValue(null);
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'gpt-5-mini',
        provider: 'openai',
      });

      await expect(processScriptGeneration(createMockJob(defaultPayload))).rejects.toThrow(
        'AI key for provider "openai" is required for script generation.'
      );
      expect(mockGenerateScript).not.toHaveBeenCalled();
    });

    it('uses platform credentials only for explicit admin-credit routes', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        aiModel: 'gpt-5-mini',
        verificationMode: 'standard',
        source: 'WEB',
        language: null,
      });
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'gpt-5-mini',
        provider: 'openai',
      });

      await processScriptGeneration(
        createMockJob({
          ...defaultPayload,
          useAdminCredits: true,
        })
      );

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: 'gpt-5-mini',
        aiKey: null,
      });
      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: undefined,
          model: 'gpt-5-mini',
          provider: 'openai',
        })
      );
    });
  });

  describe('Claude prompt construction', () => {
    it('passes all discovery parameters to generateScript', async () => {
      mockPrismaDiscoveryFindUniqueOrThrow.mockResolvedValue({
        topic: 'AI Safety',
        depth: 'deep_dive',
        audienceLevel: 'expert',
        audience: 'mature',
        focusAreas: ['alignment', 'interpretability'],
        tone: 'professional',
        durationTarget: 20,
        sourceContent: 'Research paper content here...',
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'AI Safety',
          depth: 'deep_dive',
          audienceLevel: 'expert',
          audience: 'mature',
          focusAreas: ['alignment', 'interpretability'],
          tone: 'professional',
          durationTarget: 20,
          sourceContent: 'Research paper content here...',
        })
      );
    });

    it('passes empty strings as fallback for null topic', async () => {
      mockPrismaDiscoveryFindUniqueOrThrow.mockResolvedValue({
        topic: null,
        depth: null,
        audienceLevel: null,
        audience: null,
        focusAreas: [],
        tone: null,
        durationTarget: null,
        sourceContent: null,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: '',
          depth: 'standard',
          audienceLevel: 'intermediate',
          audience: 'general',
          focusAreas: [],
          tone: 'casual',
          durationTarget: 10,
          sourceContent: undefined,
        })
      );
    });

    it('omits sourceContent parameter when null', async () => {
      mockPrismaDiscoveryFindUniqueOrThrow.mockResolvedValue({
        topic: 'Machine Learning',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        focusAreas: ['basics'],
        tone: 'casual',
        durationTarget: 5,
        sourceContent: null,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceContent: undefined,
        })
      );
    });

    it('includes sourceContent when present', async () => {
      mockPrismaDiscoveryFindUniqueOrThrow.mockResolvedValue({
        topic: 'Blockchain',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: ['consensus'],
        tone: 'casual',
        durationTarget: 10,
        sourceContent: 'Source content about blockchain...',
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceContent: 'Source content about blockchain...',
        })
      );
    });
  });

  describe('script persistence', () => {
    it('saves script with turns, soundCues, and markdown', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'First turn', direction: 'excited' },
          { speaker: 'EXPERT', text: 'Second turn' },
        ],
        soundCues: [
          { type: 'intro', prompt: 'intro music', durationSeconds: 3, insertAfterTurn: -1 },
        ],
        references: [],
        vocabulary: [],
        places: [],
        markdown: '**HOST:** First turn\n\n**EXPERT:** Second turn',
        inputTokens: 1500,
        outputTokens: 800,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaScriptCreate).toHaveBeenCalledWith({
        data: {
          episodeId: 'episode-001',
          turns: [
            { speaker: 'HOST', text: 'First turn', direction: 'excited' },
            { speaker: 'EXPERT', text: 'Second turn' },
          ],
          soundCues: [
            { type: 'intro', prompt: 'intro music', durationSeconds: 3, insertAfterTurn: -1 },
          ],
          markdown: '**HOST:** First turn\n\n**EXPERT:** Second turn',
        },
      });
    });

    it('omits soundCues when empty array', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'Hello' }],
        soundCues: [],
        references: [],
        vocabulary: [],
        places: [],
        markdown: '**HOST:** Hello',
        inputTokens: 500,
        outputTokens: 200,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaScriptCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          soundCues: undefined,
        }),
      });
    });

    it('includes soundCues when non-empty', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'Hello' }],
        soundCues: [
          { type: 'intro', prompt: 'intro', durationSeconds: 3, insertAfterTurn: -1 },
          { type: 'outro', prompt: 'outro', durationSeconds: 4, insertAfterTurn: 0 },
        ],
        references: [],
        vocabulary: [],
        places: [],
        markdown: '**HOST:** Hello',
        inputTokens: 500,
        outputTokens: 200,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaScriptCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          soundCues: [
            { type: 'intro', prompt: 'intro', durationSeconds: 3, insertAfterTurn: -1 },
            { type: 'outro', prompt: 'outro', durationSeconds: 4, insertAfterTurn: 0 },
          ],
        }),
      });
    });
  });

  describe('reference extraction and persistence', () => {
    it('saves references when present in script result', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'According to research [1]...' },
          { speaker: 'EXPERT', text: 'The study found [2]...' },
        ],
        soundCues: [],
        references: [
          {
            number: 1,
            title: 'Quantum Supremacy Using a Programmable Superconducting Processor',
            authors: ['John Martinis', 'Sergio Boixo'],
            year: 2019,
            url: 'https://www.nature.com/articles/s41586-019-1666-5',
            type: 'PAPER',
            publisher: 'Nature',
            doi: '10.1038/s41586-019-1666-5',
          },
          {
            number: 2,
            title: 'Introduction to Quantum Computing',
            authors: ['Michael Nielsen', 'Isaac Chuang'],
            year: 2010,
            url: null,
            type: 'BOOK',
            publisher: 'Cambridge University Press',
            doi: null,
          },
        ],
        places: [],
        markdown: '**HOST:** According to research [1]...',
        inputTokens: 2000,
        outputTokens: 1200,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaReferenceCreateMany).toHaveBeenCalledWith({
        data: [
          {
            episodeId: 'episode-001',
            number: 1,
            title: 'Quantum Supremacy Using a Programmable Superconducting Processor',
            authors: ['John Martinis', 'Sergio Boixo'],
            year: 2019,
            url: 'https://www.nature.com/articles/s41586-019-1666-5',
            type: 'PAPER',
            publisher: 'Nature',
            doi: '10.1038/s41586-019-1666-5',
          },
          {
            episodeId: 'episode-001',
            number: 2,
            title: 'Introduction to Quantum Computing',
            authors: ['Michael Nielsen', 'Isaac Chuang'],
            year: 2010,
            url: null,
            type: 'BOOK',
            publisher: 'Cambridge University Press',
            doi: null,
          },
        ],
      });
    });

    it('does not call createMany when no references', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'No citations here' }],
        soundCues: [],
        references: [],
        vocabulary: [],
        places: [],
        markdown: '**HOST:** No citations here',
        inputTokens: 800,
        outputTokens: 400,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaReferenceCreateMany).not.toHaveBeenCalled();
    });

    it('handles references with null fields', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'Citing [1]' }],
        soundCues: [],
        references: [
          {
            number: 1,
            title: 'Web Article',
            authors: [],
            year: null,
            url: 'https://example.com/article',
            type: 'WEB',
            publisher: null,
            doi: null,
          },
        ],
        places: [],
        markdown: '**HOST:** Citing [1]',
        inputTokens: 900,
        outputTokens: 450,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaReferenceCreateMany).toHaveBeenCalledWith({
        data: [
          {
            episodeId: 'episode-001',
            number: 1,
            title: 'Web Article',
            authors: [],
            year: null,
            url: 'https://example.com/article',
            type: 'WEB',
            publisher: null,
            doi: null,
          },
        ],
      });
    });
  });
});
