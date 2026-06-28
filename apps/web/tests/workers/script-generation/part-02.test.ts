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

  describe('pipeline routing: always routes to compile', () => {
    it('updates episode status to COMPILING with references', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'With refs [1]' }],
        soundCues: [],
        references: [
          {
            number: 1,
            title: 'Test Paper',
            authors: ['Author'],
            year: 2023,
            url: 'https://example.com',
            type: 'PAPER',
            publisher: null,
            doi: null,
          },
        ],
        places: [],
        markdown: '**HOST:** With refs [1]',
        inputTokens: 1000,
        outputTokens: 500,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
        data: expect.objectContaining({ status: 'COMPILING' }),
      });
    });

    it('queues compile job with references', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'With refs [1]' }],
        soundCues: [],
        references: [
          {
            number: 1,
            title: 'Test Paper',
            authors: ['Author'],
            year: 2023,
            url: 'https://example.com',
            type: 'PAPER',
            publisher: null,
            doi: null,
          },
        ],
        places: [],
        markdown: '**HOST:** With refs [1]',
        inputTokens: 1000,
        outputTokens: 500,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'compile-script' },
        'compile_script',
        { episodeId: 'episode-001', userId: 'user-001' },
        { jobId: expect.stringMatching(/^compile-episode-001-/) }
      );
    });

    it('updates episode status to COMPILING without references', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'First turn' },
          { speaker: 'EXPERT', text: 'Second turn' },
        ],
        soundCues: [],
        references: [],
        vocabulary: [],
        places: [],
        markdown: '**HOST:** First turn\n\n**EXPERT:** Second turn',
        inputTokens: 1500,
        outputTokens: 800,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
        data: expect.objectContaining({ status: 'COMPILING' }),
      });
    });

    it('queues compile job without references', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'First turn' },
          { speaker: 'EXPERT', text: 'Second turn' },
        ],
        soundCues: [],
        references: [],
        vocabulary: [],
        places: [],
        markdown: '**HOST:** First turn\n\n**EXPERT:** Second turn',
        inputTokens: 1500,
        outputTokens: 800,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'compile-script' },
        'compile_script',
        { episodeId: 'episode-001', userId: 'user-001' },
        { jobId: expect.stringMatching(/^compile-episode-001-/) }
      );
    });
  });

  describe('API usage logging', () => {
    it('logs Claude API usage with token counts', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'Hello' }],
        soundCues: [],
        references: [],
        vocabulary: [],
        places: [],
        markdown: '**HOST:** Hello',
        inputTokens: 2500,
        outputTokens: 1800,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'anthropic',
          category: 'script_generation',
          inputTokens: 2500,
          outputTokens: 1800,
          episodeId: 'episode-001',
          userId: 'user-001',
        })
      );
    });

    it('logs usage even when no references', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockLogUsage).toHaveBeenCalled();
    });

    it('logs usage even when references exist', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'With refs [1]' }],
        soundCues: [],
        references: [
          {
            number: 1,
            title: 'Test',
            authors: [],
            year: 2023,
            url: null,
            type: 'WEB',
            publisher: null,
            doi: null,
          },
        ],
        places: [],
        markdown: '**HOST:** With refs [1]',
        inputTokens: 3000,
        outputTokens: 2000,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockLogUsage).toHaveBeenCalled();
    });
  });

  describe('job progress tracking', () => {
    it('reports monotonically increasing progress ending at 100', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      const calls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: any[]) => c[0]
      );
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]);
      }
      expect(calls[calls.length - 1]).toBe(100);
    });
  });

  describe('error propagation', () => {
    it('propagates errors from generateScript', async () => {
      mockGenerateScript.mockRejectedValue(new Error('Claude API rate limited'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptGeneration(job)).rejects.toThrow('Claude API rate limited');
    });

    it('propagates errors from script.create', async () => {
      mockPrismaScriptCreate.mockRejectedValue(new Error('Database constraint violation'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptGeneration(job)).rejects.toThrow('Database constraint violation');
    });

    it('propagates errors from reference.createMany', async () => {
      mockPrismaScriptCreate.mockResolvedValueOnce({
        id: 'script-001',
        episodeId: 'episode-001',
      });
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'Test' }],
        soundCues: [],
        references: [
          {
            number: 1,
            title: 'Test',
            authors: [],
            year: 2023,
            url: null,
            type: 'PAPER',
            publisher: null,
            doi: null,
          },
        ],
        places: [],
        markdown: '**HOST:** Test',
        inputTokens: 1000,
        outputTokens: 500,
      });
      mockPrismaReferenceCreateMany.mockRejectedValue(new Error('Foreign key constraint failed'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptGeneration(job)).rejects.toThrow('Foreign key constraint failed');
    });

    it('propagates errors from episode.update', async () => {
      mockPrismaScriptCreate.mockResolvedValueOnce({
        id: 'script-001',
        episodeId: 'episode-001',
      });
      mockPrismaEpisodeUpdate.mockRejectedValue(new Error('Episode update failed'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptGeneration(job)).rejects.toThrow('Episode update failed');
    });

    it('propagates errors from addJob', async () => {
      mockPrismaScriptCreate.mockResolvedValueOnce({
        id: 'script-001',
        episodeId: 'episode-001',
      });
      mockPrismaReferenceCreateMany.mockResolvedValueOnce({ count: 1 });
      mockPrismaEpisodeUpdate.mockResolvedValueOnce({});
      mockAddJob.mockRejectedValue(new Error('Queue connection failed'));
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'Test' }],
        soundCues: [],
        references: [
          {
            number: 1,
            title: 'Test',
            authors: [],
            year: 2023,
            url: null,
            type: 'PAPER',
            publisher: null,
            doi: null,
          },
        ],
        places: [],
        markdown: '**HOST:** Test',
        inputTokens: 1000,
        outputTokens: 500,
      });
      const job = createMockJob(defaultPayload);

      await expect(processScriptGeneration(job)).rejects.toThrow('Queue connection failed');
    });
  });

  describe('end-to-end flows', () => {
    it('executes full pipeline with references', async () => {
      mockPrismaReferenceCreateMany.mockResolvedValue({ count: 2 });
      mockGenerateScript.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'Let me cite this [1]' },
          { speaker: 'EXPERT', text: 'And also this [2]' },
        ],
        soundCues: [{ type: 'intro', prompt: 'intro', durationSeconds: 3, insertAfterTurn: -1 }],
        references: [
          {
            number: 1,
            title: 'Paper One',
            authors: ['Smith'],
            year: 2022,
            url: 'https://example.com/1',
            type: 'PAPER',
            publisher: 'Nature',
            doi: '10.1234/abc',
          },
          {
            number: 2,
            title: 'Paper Two',
            authors: ['Jones'],
            year: 2023,
            url: 'https://example.com/2',
            type: 'ARTICLE',
            publisher: 'Science',
            doi: '10.5678/def',
          },
        ],
        places: [],
        markdown: '**HOST:** Let me cite this [1]\n\n**EXPERT:** And also this [2]',
        inputTokens: 1800,
        outputTokens: 1200,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      // Discovery fetched
      expect(mockPrismaDiscoveryFindUniqueOrThrow).toHaveBeenCalled();

      // Script generated
      expect(mockGenerateScript).toHaveBeenCalled();

      // Script saved
      expect(mockPrismaScriptCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          episodeId: 'episode-001',
          turns: expect.arrayContaining([
            expect.objectContaining({ speaker: 'HOST', text: 'Let me cite this [1]' }),
          ]),
        }),
      });

      // References saved
      expect(mockPrismaReferenceCreateMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ number: 1, title: 'Paper One' }),
          expect.objectContaining({ number: 2, title: 'Paper Two' }),
        ]),
      });

      // Status updated to COMPILING
      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
        data: expect.objectContaining({ status: 'COMPILING' }),
      });

      // Compile job queued
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'compile-script' },
        'compile_script',
        expect.objectContaining({ episodeId: 'episode-001' }),
        { jobId: expect.stringMatching(/^compile-episode-001-/) }
      );

      // Usage logged
      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'script_generation',
          inputTokens: 1800,
          outputTokens: 1200,
        })
      );

      // Progress tracked
      expect(job.updateProgress).toHaveBeenCalledWith(100);
    });

    it('executes full pipeline without references', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'No citations here' },
          { speaker: 'EXPERT', text: 'Just conversation' },
        ],
        soundCues: [],
        references: [],
        vocabulary: [],
        places: [],
        markdown: '**HOST:** No citations here\n\n**EXPERT:** Just conversation',
        inputTokens: 1200,
        outputTokens: 600,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      // Discovery fetched
      expect(mockPrismaDiscoveryFindUniqueOrThrow).toHaveBeenCalled();

      // Script generated
      expect(mockGenerateScript).toHaveBeenCalled();

      // Script saved
      expect(mockPrismaScriptCreate).toHaveBeenCalled();

      // No references saved
      expect(mockPrismaReferenceCreateMany).not.toHaveBeenCalled();

      // Compile job queued
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'compile-script' },
        'compile_script',
        expect.objectContaining({ episodeId: 'episode-001' }),
        { jobId: expect.stringMatching(/^compile-episode-001-/) }
      );

      // Status updated to COMPILING
      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
        data: expect.objectContaining({ status: 'COMPILING' }),
      });

      // Usage logged
      expect(mockLogUsage).toHaveBeenCalled();

      // Progress tracked
      expect(job.updateProgress).toHaveBeenCalledWith(100);
    });
  });

  describe('demo mode (showcase)', () => {
    it('passes mode: demo when verificationMode is showcase', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        aiModel: null,
        verificationMode: 'showcase',
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'demo',
        })
      );
    });

    it('passes mode: standard for non-showcase verificationMode', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        aiModel: null,
        verificationMode: 'standard',
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'standard',
        })
      );
    });
  });
});
