import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaReferenceFindMany = vi.fn().mockResolvedValue([]);
const mockPrismaReferenceUpdate = vi.fn().mockResolvedValue({});
const mockPrismaReferenceDeleteMany = vi.fn().mockResolvedValue({});
const mockPrismaScriptFindUnique = vi.fn().mockResolvedValue({
  turns: [],
  markdown: '',
});
const mockPrismaScriptUpdate = vi.fn().mockResolvedValue({});
const mockPrismaDiscoveryFindUnique = vi.fn().mockResolvedValue({ depth: 'standard' });
const mockPrismaPodcastFindUnique = vi.fn().mockResolvedValue({
  topic: 'Quantum Computing',
  source: 'TWITTER',
  verificationMode: 'standard',
});
const mockPrismaPodcastFindUniqueOrThrow = vi.fn().mockResolvedValue({
  source: 'TWITTER',
  ttsProvider: 'elevenlabs',
});
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});
const mockPrismaSegmentCreate = vi.fn().mockResolvedValue({ id: 'segment-001' });

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    reference: {
      findMany: (...args: unknown[]) => mockPrismaReferenceFindMany(...args),
      update: (...args: unknown[]) => mockPrismaReferenceUpdate(...args),
      deleteMany: (...args: unknown[]) => mockPrismaReferenceDeleteMany(...args),
    },
    script: {
      findUnique: (...args: unknown[]) => mockPrismaScriptFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaScriptUpdate(...args),
    },
    podcast: {
      findUnique: (...args: unknown[]) => mockPrismaPodcastFindUnique(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaPodcastFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
    },
    segment: {
      create: (...args: unknown[]) => mockPrismaSegmentCreate(...args),
    },
    discovery: {
      findUnique: (...args: unknown[]) => mockPrismaDiscoveryFindUnique(...args),
    },
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ role: 'USER' }),
    },
    autoModelConfig: {
      upsert: vi.fn().mockResolvedValue({
        id: 'singleton',
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
        ttsProvider: 'elevenlabs',
        ttsModel: 'eleven_multilingual_v2',
        sttProvider: 'openai',
        sttModel: 'whisper-1',
        platformAiProvider: 'anthropic',
        platformAiModel: 'claude-haiku-4-5-20251001',
      }),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

// Mock the new reference-verification module (Phase 4: replaces individual layer mocks)
const mockRunReferenceVerification = vi.fn().mockResolvedValue({
  results: new Map([
    [
      'ref-001',
      {
        domain: 'ACADEMIC',
        verdict: { status: 'VERIFIED', confidence: 0.85 },
        score: 0.85,
        checks: [
          { layer: 'url', passed: true, confidence: 0.6, detail: 'URL returned 200' },
          { layer: 'doi', passed: true, confidence: 0.95, detail: 'DOI verified: title similarity 100%' },
          { layer: 'title_search', passed: true, confidence: 0.9, detail: 'Title matched in OpenAlex (similarity 95%)' },
          { layer: 'ai', passed: true, confidence: 0.85, detail: 'AI: REAL — Reference appears legitimate' },
        ],
        logOddsContributions: { doi: 1.5, title_search: 0.8, url: 0.2, ai: 0.6 },
      },
    ],
  ]),
  rejectedRefIds: new Set<string>(),
});

vi.mock('@/lib/reference-verification', () => ({
  runReferenceVerification: (...args: unknown[]) => mockRunReferenceVerification(...args),
  buildReferenceRetryFeedback: vi.fn().mockReturnValue('mock feedback'),
  mergeVerifiedReferences: vi.fn().mockReturnValue([]),
  extractClaimContexts: vi.fn().mockReturnValue([]),
  groundFailedReferences: vi.fn().mockResolvedValue({ results: new Map(), rejectedRefIds: new Set() }),
}));

// reference-validator is still imported for ReferenceInput type — keep a minimal mock
vi.mock('@/lib/reference-validator', () => ({
  assessSourceQuality: vi.fn().mockReturnValue({ accepted: true, reason: 'Trusted source' }),
}));

const mockBuildRenumberMap = vi.fn().mockReturnValue(new Map());
const mockCleanAndRenumberCitations = vi.fn((turns) => turns);
const mockCleanAndRenumberMarkdown = vi.fn((markdown) => markdown);

vi.mock('@/lib/script-updater', () => ({
  buildRenumberMap: (...args: unknown[]) => mockBuildRenumberMap(...(args as [unknown])),
  cleanAndRenumberCitations: (...args: unknown[]) =>
    mockCleanAndRenumberCitations(...(args as [unknown])),
  cleanAndRenumberMarkdown: (...args: unknown[]) =>
    mockCleanAndRenumberMarkdown(...(args as [unknown])),
}));

const mockAddJob = vi.fn().mockResolvedValue({ id: 'audio-job-1' });

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    GENERATE_AUDIO: 'generate_audio',
    SEND_NOTIFICATION: 'send_notification',
    VALIDATE_REFERENCES: 'validate_references',
  },
  audioGenerationQueue: { name: 'audio-generation' },
  notificationQueue: { name: 'notifications' },
  referenceValidationQueue: { name: 'reference-validation' },
}));

const mockCreateSegmentsAndQueueAudio = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/segment-creator', () => ({
  createSegmentsAndQueueAudio: (...args: unknown[]) => mockCreateSegmentsAndQueueAudio(...args),
}));

const { mockGetAiKey, mockHasByokKey, mockGetByokKey } = vi.hoisted(() => ({
  mockGetAiKey: vi.fn().mockResolvedValue({ apiKey: 'anthropic-key', provider: 'anthropic' }),
  mockHasByokKey: vi.fn().mockResolvedValue(false),
  mockGetByokKey: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: mockGetAiKey,
  hasByokKey: mockHasByokKey,
  getByokKey: mockGetByokKey,
}));

vi.mock('@/lib/generation-features', () => ({
  getGenerationFeatures: vi.fn().mockReturnValue({
    maxDurationMinutes: 30,
    maxSpeakers: 4,
    autoApproveScript: false,
    webSearchEnabled: true,
    maxQaInteractions: Infinity,
    privateAllowed: true,
    priorityQueue: true,
    analyticsEnabled: true,
    voiceTracksEnabled: true,
    maxVoiceTracks: 3,
    voiceCloningEnabled: true,
  }),
  getJobPriority: vi.fn().mockReturnValue(1),
}));

const { mockResolveAiModelAndProvider } = vi.hoisted(() => ({
  mockResolveAiModelAndProvider: vi.fn().mockResolvedValue({ model: 'claude-haiku-4-5-20251001', provider: 'anthropic' }),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  resolveAiModelAndProvider: mockResolveAiModelAndProvider,
  getCheapestModelForProvider: vi.fn().mockReturnValue('claude-haiku-4-5-20251001'),
  getAllAiProviderMeta: vi.fn().mockReturnValue([]),
  getAiProviderMeta: vi.fn().mockReturnValue({ id: 'anthropic', models: [] }),
  getAiProviderIds: vi.fn().mockReturnValue([]),
  getAiProviderIdsWithPricing: vi.fn().mockReturnValue([]),
  isValidAiProviderId: vi.fn().mockReturnValue(false),
  isValidModelId: vi.fn().mockReturnValue(false),
  isReasoningModel: vi.fn().mockReturnValue(false),
  getProviderForModel: vi.fn().mockReturnValue('anthropic'),
  getAiModelDisplayName: vi.fn().mockReturnValue('claude-haiku-4-5-20251001'),
  getAllAiProviderClientMeta: vi.fn().mockReturnValue([]),
  getPricetokenModelInfo: vi.fn().mockReturnValue(null),
  getModelRequiredPlan: vi.fn().mockReturnValue(null),
  getModelContextWindow: vi.fn().mockReturnValue(200000),
  getModelMaxOutputTokens: vi.fn().mockReturnValue(8192),
  validateAiProviderCredentials: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock('@/lib/voice-assigner', () => ({
  assignVoicesForPodcast: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tts-tag-converter', () => ({
  convertTurnsForProvider: vi.fn().mockImplementation((turns: unknown[]) => Promise.resolve(turns)),
}));

vi.mock('@/lib/pipeline-events', () => ({
  logPipelineStageComplete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/discovery-figure-extractor', () => ({
  extractDiscoveryFigures: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/pipeline-resume', () => ({
  markPodcastFailed: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({
  invalidatePodcastCache: vi.fn().mockResolvedValue(undefined),
  publishPodcastStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/script-verifier', () => ({
  getMinReferenceCount: (depth: string) => {
    const bases: Record<string, number> = { deep_dive: 10, standard: 5, quick_overview: 3, eli5: 3 };
    return bases[depth] ?? 5;
  },
}));

const { mockGenerateScriptWithFeedback } = vi.hoisted(() => ({
  mockGenerateScriptWithFeedback: vi.fn().mockResolvedValue({ turns: [], references: [], markdown: '' }),
}));

vi.mock('@/lib/script-generator', () => ({
  generateScript: vi.fn().mockResolvedValue({ turns: [], references: [], markdown: '' }),
  generateScriptWithFeedback: mockGenerateScriptWithFeedback,
  generateScriptWithUserFeedback: vi.fn().mockResolvedValue({ turns: [], references: [], markdown: '' }),
}));

vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: vi.fn().mockResolvedValue({
    model: {
      aiProvider: 'anthropic',
      aiModel: 'claude-haiku-4-5-20251001',
      ttsProvider: 'elevenlabs',
      ttsModel: 'eleven_multilingual_v2',
      sttProvider: 'openai',
      sttModel: 'whisper-1',
    },
    platform: {
      aiProvider: 'anthropic',
      aiModel: 'claude-haiku-4-5-20251001',
    },
  }),
}));

vi.mock('@/lib/llm', () => ({
  generateResponse: vi.fn().mockResolvedValue('mock LLM response'),
  streamResponse: vi.fn(),
  WEB_SEARCH_TOOL: { name: 'web_search', type: 'web_search_20250305' },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---- Import under test ----
import { processReferenceValidation } from '@/workers/reference-validation.worker';
import type { ValidateReferencesPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function createMockJob(data: ValidateReferencesPayload): Job<ValidateReferencesPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<ValidateReferencesPayload>;
}

const defaultPayload: ValidateReferencesPayload = {
  podcastId: 'podcast-001',
  userId: 'user-001',
};

// ---- Tests ----

describe('processReferenceValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: 5 references (meets standard depth minimum), script with turns
    mockPrismaReferenceFindMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `ref-00${i + 1}`,
        number: i + 1,
        title: `Paper ${String.fromCharCode(65 + i)}`,
        authors: ['Author'],
        year: 2023,
        url: `https://example.com/paper-${i + 1}`,
        doi: i === 0 ? '10.1234/qc.2023.001' : null,
        type: 'article',
      }))
    );

    mockPrismaScriptFindUnique.mockResolvedValue({
      turns: [
        { speaker: 'HOST', text: 'Welcome to the show! [1]' },
        { speaker: 'EXPERT', text: 'Thanks for having me!' },
      ],
      markdown: '# Transcript\n\n[1] Paper A',
    });

    mockPrismaPodcastFindUnique.mockResolvedValue({
      topic: 'Quantum Computing Basics',
      source: 'TWITTER',
      aiModel: null,
      verificationMode: 'standard',
    });

    mockGetAiKey.mockResolvedValue({ apiKey: 'anthropic-key', provider: 'anthropic' });
    mockHasByokKey.mockResolvedValue(false);
    mockGetByokKey.mockResolvedValue(null);
    mockResolveAiModelAndProvider.mockResolvedValue({ model: 'claude-haiku-4-5-20251001', provider: 'anthropic' });
    mockGenerateScriptWithFeedback.mockResolvedValue({ turns: [], references: [], markdown: '' });

    mockRunReferenceVerification.mockResolvedValue({
      results: new Map(
        Array.from({ length: 5 }, (_, i) => [
          `ref-00${i + 1}`,
          {
            domain: 'ACADEMIC',
            verdict: { status: 'VERIFIED' as const, confidence: 0.85 },
            score: 0.85,
            checks: [
              { layer: 'url', passed: true, confidence: 0.6, detail: 'URL returned 200' },
              { layer: 'ai', passed: true, confidence: 0.85, detail: 'AI: REAL' },
            ],
            logOddsContributions: { url: 0.2, ai: 0.6 },
          },
        ])
      ),
      rejectedRefIds: new Set<string>(),
    });

    mockPrismaSegmentCreate.mockImplementation(async ({ data }: { data: { order: number } }) => ({
      id: `segment-${data.order.toString().padStart(3, '0')}`,
    }));
  });

  describe('loading references and script', () => {
    it('throws error if script is not found', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue(null);
      const job = createMockJob(defaultPayload);

      await expect(processReferenceValidation(job)).rejects.toThrow(
        'Script not found for podcast podcast-001'
      );
    });
  });

  describe('AI routing', () => {
    it('uses the configured BYOK provider when the podcast has no model', async () => {
      const aiKey = { apiKey: 'anthropic-key', provider: 'anthropic' };
      mockGetAiKey.mockResolvedValue(aiKey);

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockGetAiKey).toHaveBeenCalledTimes(1);
      expect(mockGetAiKey).toHaveBeenCalledWith('user-001');
      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        podcastAiModel: null,
        aiKey,
      });
      expect(mockRunReferenceVerification).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        'Quantum Computing Basics',
        'anthropic-key',
        'claude-haiku-4-5-20251001',
        'anthropic',
        expect.any(Number)
      );
    });

    it('uses the explicit podcast model owner and matching provider key', async () => {
      mockPrismaPodcastFindUnique.mockResolvedValue({
        topic: 'Quantum Computing Basics',
        source: 'TWITTER',
        aiModel: 'gpt-5-mini',
        verificationMode: 'standard',
      });
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'gpt-5-mini',
        provider: 'openai',
      });
      mockGetAiKey.mockResolvedValue({ apiKey: 'openai-key', provider: 'openai' });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        podcastAiModel: 'gpt-5-mini',
        aiKey: null,
      });
      expect(mockGetAiKey).toHaveBeenCalledTimes(1);
      expect(mockGetAiKey).toHaveBeenCalledWith('user-001', 'openai');
      expect(mockRunReferenceVerification).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        'Quantum Computing Basics',
        'openai-key',
        'gpt-5-mini',
        'openai',
        expect.any(Number)
      );
    });

    it('rejects explicit non-local models without a matching provider key', async () => {
      mockPrismaPodcastFindUnique.mockResolvedValue({
        topic: 'Quantum Computing Basics',
        source: 'TWITTER',
        aiModel: 'gpt-5-mini',
        verificationMode: 'standard',
      });
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'gpt-5-mini',
        provider: 'openai',
      });
      mockGetAiKey.mockResolvedValue(null);

      const job = createMockJob(defaultPayload);
      await expect(processReferenceValidation(job)).rejects.toThrow(
        'AI key for provider "openai" is required for reference validation.'
      );
      expect(mockRunReferenceVerification).not.toHaveBeenCalled();
    });

    it('rejects missing model and missing BYOK key before verification', async () => {
      mockGetAiKey.mockResolvedValue(null);

      const job = createMockJob(defaultPayload);
      await expect(processReferenceValidation(job)).rejects.toThrow(
        'AI model is required for reference validation when no AI key is configured.'
      );
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockRunReferenceVerification).not.toHaveBeenCalled();
    });

    it('uses platform credentials only for explicit admin-credit routes', async () => {
      mockPrismaPodcastFindUnique.mockResolvedValue({
        topic: 'Quantum Computing Basics',
        source: 'TWITTER',
        aiModel: 'gpt-5-mini',
        verificationMode: 'standard',
      });
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'gpt-5-mini',
        provider: 'openai',
      });

      const job = createMockJob({ ...defaultPayload, useAdminCredits: true });
      await processReferenceValidation(job);

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        podcastAiModel: 'gpt-5-mini',
        aiKey: null,
      });
      expect(mockRunReferenceVerification).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        'Quantum Computing Basics',
        undefined,
        'gpt-5-mini',
        'openai',
        expect.any(Number)
      );
    });

    it('rejects admin-credit routes without an explicit model when references need AI', async () => {
      const job = createMockJob({ ...defaultPayload, useAdminCredits: true });

      await expect(processReferenceValidation(job)).rejects.toThrow(
        'AI model is required for reference validation when no AI key is configured.'
      );
      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockRunReferenceVerification).not.toHaveBeenCalled();
    });

    it('allows local claude-code models without provider keys', async () => {
      mockPrismaPodcastFindUnique.mockResolvedValue({
        topic: 'Quantum Computing Basics',
        source: 'TWITTER',
        aiModel: 'claude-code:sonnet',
        verificationMode: 'standard',
      });
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'claude-code:sonnet',
        provider: 'claude-code',
      });
      mockGetAiKey.mockResolvedValue(null);

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockRunReferenceVerification).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        'Quantum Computing Basics',
        undefined,
        'claude-code:sonnet',
        'claude-code',
        expect.any(Number)
      );
    });

    it('skips AI routing when no references require verification', async () => {
      mockPrismaReferenceFindMany.mockResolvedValue([]);
      mockPrismaPodcastFindUnique.mockResolvedValue({
        topic: 'Quantum Computing Basics',
        source: 'TWITTER',
        aiModel: null,
        verificationMode: 'showcase',
      });
      mockGetAiKey.mockResolvedValue(null);

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockRunReferenceVerification).not.toHaveBeenCalled();
      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalled();
    });

    it('uses the routed provider key for retry script regeneration', async () => {
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map(
          Array.from({ length: 5 }, (_, i) => [
            `ref-00${i + 1}`,
            {
              domain: 'GENERAL',
              verdict: { status: i === 0 ? 'VERIFIED' : 'REMOVED', confidence: 0.8 },
              score: 0.8,
              checks: [],
              logOddsContributions: {},
            },
          ])
        ),
        rejectedRefIds: new Set<string>(),
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockGenerateScriptWithFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: 'anthropic-key',
          model: 'claude-haiku-4-5-20251001',
          provider: 'anthropic',
        })
      );
    });
  });

  describe('no references to validate (showcase mode — gate exempt)', () => {
    beforeEach(() => {
      mockPrismaReferenceFindMany.mockResolvedValue([]);
      mockPrismaPodcastFindUnique.mockResolvedValue({
        topic: 'Quantum Computing Basics',
        source: 'TWITTER',
        verificationMode: 'showcase',
      });
    });

    it('creates segments and queues audio when no references exist', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalledWith(
        'podcast-001',
        expect.arrayContaining([
          expect.objectContaining({ speaker: 'HOST', text: 'Welcome to the show! [1]' }),
          expect.objectContaining({ speaker: 'EXPERT', text: 'Thanks for having me!' }),
        ])
      );
    });
  });

  describe('domain-aware verification pipeline', () => {
    it('calls runReferenceVerification with refs, script turns, and topic', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockRunReferenceVerification).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'ref-001',
            title: 'Paper A',
          }),
        ]),
        expect.arrayContaining([
          expect.objectContaining({ speaker: 'HOST' }),
        ]),
        'Quantum Computing Basics',
        'anthropic-key',
        expect.any(String),
        'anthropic',
        expect.any(Number)
      );
    });

    it('produces a VERIFIED verdict and stores contentDomain on Reference', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-001' },
        data: expect.objectContaining({
          verificationStatus: 'VERIFIED',
          contentDomain: 'ACADEMIC',
        }),
      });
    });

    it('stores contentDomain in Reference record after validation', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-001' },
        data: expect.objectContaining({
          contentDomain: 'ACADEMIC',
        }),
      });
    });

    it('classifies news reference as NEWS domain and verifies it', async () => {
      mockPrismaReferenceFindMany.mockResolvedValue([
        {
          id: 'ref-news',
          number: 1,
          title: 'Breaking: Major Development',
          authors: [],
          year: 2024,
          url: 'https://nytimes.com/article/breaking',
          doi: null,
          type: 'ARTICLE',
        },
      ]);

      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          [
            'ref-news',
            {
              domain: 'NEWS',
              verdict: { status: 'VERIFIED', confidence: 0.76 },
              score: 0.76,
              checks: [
                { layer: 'url', passed: true, confidence: 0.6, detail: 'URL returned 200' },
                { layer: 'ai', passed: true, confidence: 0.85, detail: 'AI: REAL — NYT article verified' },
              ],
              logOddsContributions: { url: 0.3, ai: 0.9 },
            },
          ],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-news' },
        data: expect.objectContaining({
          contentDomain: 'NEWS',
          verificationStatus: 'VERIFIED',
        }),
      });
    });

    it('NEWS reference with live URL + AI passes verification (score > 0.50 threshold)', async () => {
      // url = 0.35 × 0.6 = 0.21, ai = 0.65 × 0.85 = 0.5525, total = 0.76 > 0.50 threshold
      mockPrismaReferenceFindMany.mockResolvedValue([
        {
          id: 'ref-nyt',
          number: 1,
          title: 'Climate Summit Coverage',
          authors: [],
          year: 2024,
          url: 'https://nytimes.com/climate',
          doi: null,
          type: 'ARTICLE',
        },
      ]);

      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          [
            'ref-nyt',
            {
              domain: 'NEWS',
              verdict: { status: 'VERIFIED', confidence: 0.76 },
              score: 0.76,
              checks: [
                { layer: 'url', passed: true, confidence: 0.6, detail: 'URL returned 200' },
                { layer: 'ai', passed: true, confidence: 0.85, detail: 'AI: REAL — credible outlet' },
              ],
              logOddsContributions: { url: 0.3, ai: 0.9 },
            },
          ],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-nyt' },
        data: expect.objectContaining({ verificationStatus: 'VERIFIED' }),
      });
    });

    it('ACADEMIC reference without DOI classified by arxiv.org URL pattern', async () => {
      mockPrismaReferenceFindMany.mockResolvedValue([
        {
          id: 'ref-arxiv',
          number: 1,
          title: 'Attention Is All You Need',
          authors: ['Vaswani et al.'],
          year: 2017,
          url: 'https://arxiv.org/abs/1706.03762',
          doi: null,
          type: 'PAPER',
        },
      ]);

      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          [
            'ref-arxiv',
            {
              domain: 'ACADEMIC',
              verdict: { status: 'VERIFIED', confidence: 0.80 },
              score: 0.80,
              checks: [
                { layer: 'url', passed: true, confidence: 0.6, detail: 'URL returned 200' },
                { layer: 'title_search', passed: true, confidence: 0.9, detail: 'Title matched' },
                { layer: 'ai', passed: true, confidence: 0.85, detail: 'AI: REAL' },
              ],
              logOddsContributions: { url: 0.2, title_search: 0.7, ai: 0.6 },
            },
          ],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-arxiv' },
        data: expect.objectContaining({
          contentDomain: 'ACADEMIC',
          verificationStatus: 'VERIFIED',
        }),
      });
    });
  });

  describe('verification verdicts and status updates', () => {
    it('updates reference status to VERIFIED when verdict is VERIFIED', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-001' },
        data: expect.objectContaining({
          verificationStatus: 'VERIFIED',
        }),
      });
    });

    it('updates reference status to REMOVED when verdict is REMOVED', async () => {
      mockPrismaReferenceFindMany.mockResolvedValue([
        { id: 'ref-001', number: 1, title: 'Paper A', authors: ['Author A'], year: 2023, url: 'https://example.com/a', doi: null, type: 'article' },
        { id: 'ref-002', number: 2, title: 'Paper B', authors: ['Author B'], year: 2022, url: 'https://example.com/b', doi: null, type: 'article' },
      ]);

      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          ['ref-001', { domain: 'GENERAL', verdict: { status: 'REMOVED', confidence: 0.1 }, score: 0.1, checks: [{ layer: 'ai', passed: false, confidence: 0, detail: 'AI: FAKE' }], logOddsContributions: { ai: -1.2 } }],
          ['ref-002', { domain: 'GENERAL', verdict: { status: 'VERIFIED', confidence: 0.8 }, score: 0.8, checks: [{ layer: 'ai', passed: true, confidence: 0.8, detail: 'AI: REAL' }], logOddsContributions: { ai: 0.9 } }],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-001' },
        data: expect.objectContaining({ verificationStatus: 'REMOVED' }),
      });
    });

    it('updates reference status to FAILED when verdict is FAILED', async () => {
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          ['ref-001', { domain: 'GENERAL', verdict: { status: 'FAILED', confidence: 0 }, score: 0, checks: [], logOddsContributions: {} }],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-001' },
        data: expect.objectContaining({ verificationStatus: 'FAILED' }),
      });
    });

    it('updates reference with replacement data when verdict is REPLACED', async () => {
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          [
            'ref-001',
            {
              domain: 'ACADEMIC',
              verdict: {
                status: 'REPLACED',
                confidence: 0.3,
                replacement: {
                  title: 'Corrected Title',
                  authors: ['Corrected Author'],
                  year: 2024,
                  url: 'https://corrected.com/paper',
                  doi: '10.5678/corrected',
                  publisher: 'Nature',
                },
              },
              score: 0.3,
              checks: [],
              logOddsContributions: {},
            },
          ],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-001' },
        data: expect.objectContaining({
          verificationStatus: 'REPLACED',
          originalTitle: 'Paper A',
          title: 'Corrected Title',
          authors: ['Corrected Author'],
          year: 2024,
          url: 'https://corrected.com/paper',
          doi: '10.5678/corrected',
          publisher: 'Nature',
        }),
      });
    });

    it('stores verification details with all checks and Bayesian scoring data', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-001' },
        data: expect.objectContaining({
          verificationDetails: expect.objectContaining({
            checks: expect.arrayContaining([
              expect.objectContaining({ layer: 'url' }),
              expect.objectContaining({ layer: 'ai' }),
            ]),
            posterior: 0.85,
            logOddsContributions: { url: 0.2, ai: 0.6 },
            verifiedAt: expect.any(String),
          }),
        }),
      });
    });
  });

  describe('script cleaning when references are removed', () => {
    beforeEach(() => {
      mockPrismaReferenceFindMany.mockResolvedValue([
        { id: 'ref-001', number: 1, title: 'Paper A', authors: [], year: null, url: null, doi: null, type: 'article' },
        { id: 'ref-002', number: 2, title: 'Paper B', authors: [], year: null, url: null, doi: null, type: 'article' },
      ]);

      mockPrismaScriptFindUnique.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'Introduction [1] to the topic [2].' },
          { speaker: 'EXPERT', text: 'Yes, that is covered in [1].' },
        ],
        markdown: '# Transcript\n\n[1] Paper A\n[2] Paper B',
      });
    });

    it('builds renumber map when references are removed', async () => {
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          ['ref-001', { domain: 'GENERAL', verdict: { status: 'REMOVED', confidence: 0 }, score: 0, checks: [], logOddsContributions: {} }],
          ['ref-002', { domain: 'GENERAL', verdict: { status: 'VERIFIED', confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} }],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockBuildRenumberMap).toHaveBeenCalledWith([1, 2], expect.any(Set));

      const removedSet = mockBuildRenumberMap.mock.calls[0]?.[1] as Set<number>;
      expect(Array.from(removedSet)).toContain(1);
    });

    it('cleans and renumbers citations in turns', async () => {
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          ['ref-001', { domain: 'GENERAL', verdict: { status: 'REMOVED', confidence: 0 }, score: 0, checks: [], logOddsContributions: {} }],
          ['ref-002', { domain: 'GENERAL', verdict: { status: 'VERIFIED', confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} }],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      mockBuildRenumberMap.mockReturnValue(new Map([[2, 1]]));
      mockCleanAndRenumberCitations.mockReturnValue([
        { speaker: 'HOST', text: 'Introduction to the topic [1].' },
        { speaker: 'EXPERT', text: 'Yes, that is covered.' },
      ]);

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockCleanAndRenumberCitations).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ text: 'Introduction [1] to the topic [2].' }),
        ]),
        expect.any(Set),
        expect.any(Map)
      );
    });

    it('cleans and renumbers markdown', async () => {
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          ['ref-001', { domain: 'GENERAL', verdict: { status: 'REMOVED', confidence: 0 }, score: 0, checks: [], logOddsContributions: {} }],
          ['ref-002', { domain: 'GENERAL', verdict: { status: 'VERIFIED', confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} }],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      mockBuildRenumberMap.mockReturnValue(new Map([[2, 1]]));
      mockCleanAndRenumberMarkdown.mockReturnValue('# Transcript\n\n[1] Paper B');

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockCleanAndRenumberMarkdown).toHaveBeenCalledWith(
        '# Transcript\n\n[1] Paper A\n[2] Paper B',
        expect.any(Set),
        expect.any(Map)
      );
    });

    it('updates script with cleaned turns and markdown', async () => {
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          ['ref-001', { domain: 'GENERAL', verdict: { status: 'REMOVED', confidence: 0 }, score: 0, checks: [], logOddsContributions: {} }],
          ['ref-002', { domain: 'GENERAL', verdict: { status: 'VERIFIED', confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} }],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      const cleanedTurns = [
        { speaker: 'HOST', text: 'Introduction to the topic [1].' },
        { speaker: 'EXPERT', text: 'Yes, that is covered.' },
      ];
      const cleanedMarkdown = '# Transcript\n\n[1] Paper B';

      mockCleanAndRenumberCitations.mockReturnValue(cleanedTurns);
      mockCleanAndRenumberMarkdown.mockReturnValue(cleanedMarkdown);

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaScriptUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        data: {
          turns: cleanedTurns,
          markdown: cleanedMarkdown,
        },
      });
    });

    it('renumbers remaining references in database', async () => {
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          ['ref-001', { domain: 'GENERAL', verdict: { status: 'REMOVED', confidence: 0 }, score: 0, checks: [], logOddsContributions: {} }],
          ['ref-002', { domain: 'GENERAL', verdict: { status: 'VERIFIED', confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} }],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      mockBuildRenumberMap.mockReturnValue(new Map([[2, 1]]));

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-002' },
        data: { number: 1 },
      });
    });

    it('deletes removed references from database', async () => {
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          ['ref-001', { domain: 'GENERAL', verdict: { status: 'REMOVED', confidence: 0 }, score: 0, checks: [], logOddsContributions: {} }],
          ['ref-002', { domain: 'GENERAL', verdict: { status: 'VERIFIED', confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} }],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceDeleteMany).toHaveBeenCalledWith({
        where: {
          podcastId: 'podcast-001',
          number: { in: expect.arrayContaining([1]) },
        },
      });
    });
  });

  describe('all references failed', () => {
    beforeEach(() => {
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          ['ref-001', { domain: 'GENERAL', verdict: { status: 'REMOVED', confidence: 0 }, score: 0, checks: [], logOddsContributions: {} }],
        ]),
        rejectedRefIds: new Set<string>(),
      });
    });

    it('strips all citation markers from the script when all references are removed', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockCleanAndRenumberCitations).toHaveBeenCalled();
      expect(mockPrismaScriptUpdate).toHaveBeenCalled();
    });

    it('deletes all Reference rows when all references are removed', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceDeleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ podcastId: 'podcast-001' }),
        })
      );
    });

    it('pauses at SCRIPT_READY when all references are removed (retries exhausted)', async () => {
      // Use max retry attempt so the worker falls through to SCRIPT_READY
      const job = createMockJob({ ...defaultPayload, referenceRetryAttempt: 2 });
      await processReferenceValidation(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: expect.objectContaining({ status: 'SCRIPT_READY', lowReferences: true }),
      });
    });

    it('does not continue to audio generation when all references are removed', async () => {
      const job = createMockJob({ ...defaultPayload, referenceRetryAttempt: 2 });
      await processReferenceValidation(job);

      expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
    });

    it('sends SCRIPT_READY notification when all references are removed', async () => {
      const job = createMockJob({ ...defaultPayload, referenceRetryAttempt: 2 });
      await processReferenceValidation(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notifications' },
        'send_notification',
        expect.objectContaining({
          userId: 'user-001',
          type: 'SCRIPT_READY',
          title: expect.stringContaining('references'),
        })
      );
    });
  });

  describe('segment creation and audio generation queueing', () => {
    it('delegates segment creation and audio queueing to createSegmentsAndQueueAudio', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalledWith(
        'podcast-001',
        expect.arrayContaining([
          expect.objectContaining({ speaker: 'HOST', text: 'Welcome to the show! [1]' }),
        ])
      );
    });

    it('updates podcast status to GENERATING_AUDIO after queueing', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: expect.objectContaining({ status: 'GENERATING_AUDIO' }),
      });
    });
  });

  describe('progress tracking', () => {
    it('reports monotonically increasing progress ending at 100', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      const calls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]);
      }
      expect(calls[calls.length - 1]).toBe(100);
    });
  });

  describe('auto-select TTS provider at auto-approve', () => {
    beforeEach(() => {
      // Set up for auto-approve path: TWITTER source, showcase (bypass gate for 0-refs tests)
      mockPrismaReferenceFindMany.mockResolvedValue([]);
      mockPrismaPodcastFindUnique.mockResolvedValue({
        topic: 'Quantum Computing Basics',
        source: 'TWITTER',
        verificationMode: 'showcase',
      });
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        source: 'TWITTER',
        ttsProvider: 'elevenlabs',
      });
    });

    it('sets the unified auto TTS provider when missing (no-refs path)', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValueOnce({ ttsProvider: null });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'podcast-001' },
          data: { ttsProvider: 'elevenlabs', ttsModel: 'eleven_multilingual_v2' },
        })
      );
    });

    it('uses persisted ttsProvider when present (no-refs path)', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalled();
    });

    it('continues no-refs auto-approval after filling a missing ttsProvider', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValueOnce({ ttsProvider: null });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'podcast-001' },
          data: { ttsProvider: 'elevenlabs', ttsModel: 'eleven_multilingual_v2' },
        })
      );
      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalled();
    });

    it('sets the unified auto TTS provider at full-validation auto-approve', async () => {
      // Has 5 references → passes gate, goes through full validation path
      mockPrismaReferenceFindMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({ id: `ref-00${i + 1}`, number: i + 1, title: 'Paper', authors: [], year: 2023, url: 'https://example.com', doi: null, type: 'article' }))
      );
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map(
          Array.from({ length: 5 }, (_, i) => [`ref-00${i + 1}`, { domain: 'GENERAL', verdict: { status: 'VERIFIED' as const, confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} }])
        ),
        rejectedRefIds: new Set<string>(),
      });
      mockPrismaPodcastFindUnique.mockResolvedValue({ topic: 'Test', source: 'TWITTER', verificationMode: 'standard' });
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValueOnce({ ttsProvider: null });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { ttsProvider: 'elevenlabs', ttsModel: 'eleven_multilingual_v2' },
        })
      );
    });

    it('uses persisted ttsProvider at full-validation auto-approve', async () => {
      mockPrismaReferenceFindMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({ id: `ref-00${i + 1}`, number: i + 1, title: 'Paper', authors: [], year: 2023, url: 'https://example.com', doi: null, type: 'article' }))
      );
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map(
          Array.from({ length: 5 }, (_, i) => [`ref-00${i + 1}`, { domain: 'GENERAL', verdict: { status: 'VERIFIED' as const, confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} }])
        ),
        rejectedRefIds: new Set<string>(),
      });
      mockPrismaPodcastFindUnique.mockResolvedValue({ topic: 'Test', source: 'TWITTER', verificationMode: 'standard' });
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        source: 'TWITTER',
        ttsProvider: 'elevenlabs',
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalled();
    });

    it('continues full-validation auto-approval after filling a missing ttsProvider', async () => {
      mockPrismaReferenceFindMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({ id: `ref-00${i + 1}`, number: i + 1, title: 'Paper', authors: [], year: 2023, url: 'https://example.com', doi: null, type: 'article' }))
      );
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map(
          Array.from({ length: 5 }, (_, i) => [`ref-00${i + 1}`, { domain: 'GENERAL', verdict: { status: 'VERIFIED' as const, confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} }])
        ),
        rejectedRefIds: new Set<string>(),
      });
      mockPrismaPodcastFindUnique.mockResolvedValue({ topic: 'Test', source: 'TWITTER', verificationMode: 'standard' });
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValueOnce({ ttsProvider: null });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'podcast-001' },
          data: { ttsProvider: 'elevenlabs', ttsModel: 'eleven_multilingual_v2' },
        })
      );
      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalled();
    });
  });

  describe('error propagation', () => {
    it('propagates errors when script is not found', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue(null);
      const job = createMockJob(defaultPayload);

      await expect(processReferenceValidation(job)).rejects.toThrow(
        'Script not found for podcast podcast-001'
      );
    });

    it('propagates errors from prisma reference updates', async () => {
      mockPrismaReferenceUpdate.mockRejectedValue(new Error('Database connection failed'));
      const job = createMockJob(defaultPayload);

      await expect(processReferenceValidation(job)).rejects.toThrow('Database connection failed');
    });

    it('propagates errors from segment creation', async () => {
      mockPrismaReferenceUpdate.mockResolvedValue({});
      mockCreateSegmentsAndQueueAudio.mockRejectedValueOnce(new Error('Segment creation failed'));
      const job = createMockJob(defaultPayload);

      await expect(processReferenceValidation(job)).rejects.toThrow('Segment creation failed');
    });
  });

  describe('minimum reference gate', () => {
    it('pauses at SCRIPT_READY when remaining references drop below minimum for depth', async () => {
      // 5 refs, 4 removed → 1 remaining < 5 required
      mockPrismaReferenceFindMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({
          id: `ref-00${i + 1}`, number: i + 1, title: `Paper ${i + 1}`, authors: [], year: 2023,
          url: `https://example.com/${i + 1}`, doi: null, type: 'article',
        }))
      );
      const resultsMap = new Map<string, { domain: string; verdict: { status: string; confidence: number }; score: number; checks: never[]; logOddsContributions: Record<string, never> }>();
      resultsMap.set('ref-001', { domain: 'GENERAL', verdict: { status: 'VERIFIED', confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} });
      for (let i = 2; i <= 5; i++) {
        resultsMap.set(`ref-00${i}`, { domain: 'GENERAL', verdict: { status: 'REMOVED', confidence: 0 }, score: 0, checks: [], logOddsContributions: {} });
      }
      mockRunReferenceVerification.mockResolvedValue({
        results: resultsMap,
        rejectedRefIds: new Set<string>(),
      });

      // Exhaust retries so the worker falls through to SCRIPT_READY
      const job = createMockJob({ ...defaultPayload, referenceRetryAttempt: 2 });
      await processReferenceValidation(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: expect.objectContaining({ status: 'SCRIPT_READY', lowReferences: true }),
      });
      expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
    });

    it('continues when remaining references meet minimum', async () => {
      // 7 refs, 2 removed → 5 remaining >= 5 required
      mockPrismaReferenceFindMany.mockResolvedValue(
        Array.from({ length: 7 }, (_, i) => ({
          id: `ref-00${i + 1}`, number: i + 1, title: `Paper ${i + 1}`, authors: [], year: 2023,
          url: `https://example.com/${i + 1}`, doi: null, type: 'article',
        }))
      );
      const resultsMap = new Map<string, { domain: string; verdict: { status: string; confidence: number }; score: number; checks: never[]; logOddsContributions: Record<string, never> }>();
      for (let i = 0; i < 5; i++) {
        resultsMap.set(`ref-00${i + 1}`, { domain: 'GENERAL', verdict: { status: 'VERIFIED', confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} });
      }
      resultsMap.set('ref-006', { domain: 'GENERAL', verdict: { status: 'REMOVED', confidence: 0 }, score: 0, checks: [], logOddsContributions: {} });
      resultsMap.set('ref-007', { domain: 'GENERAL', verdict: { status: 'REMOVED', confidence: 0 }, score: 0, checks: [], logOddsContributions: {} });
      mockRunReferenceVerification.mockResolvedValue({
        results: resultsMap,
        rejectedRefIds: new Set<string>(),
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaPodcastUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'SCRIPT_READY' } })
      );
    });

    it('uses eli5 thresholds for relaxed verificationMode', async () => {
      // relaxed → eli5 depth → requires 3. 3 refs, 0 removed → passes
      mockPrismaPodcastFindUnique.mockResolvedValue({
        topic: 'Fun Topic',
        source: 'TWITTER',
        verificationMode: 'relaxed',
      });
      mockPrismaReferenceFindMany.mockResolvedValue(
        Array.from({ length: 3 }, (_, i) => ({
          id: `ref-00${i + 1}`, number: i + 1, title: `Paper ${i + 1}`, authors: [], year: 2023,
          url: `https://example.com/${i + 1}`, doi: null, type: 'article',
        }))
      );
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map(
          Array.from({ length: 3 }, (_, i) => [`ref-00${i + 1}`, {
            domain: 'GENERAL', verdict: { status: 'VERIFIED' as const, confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {},
          }])
        ),
        rejectedRefIds: new Set<string>(),
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaPodcastUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'SCRIPT_READY' } })
      );
    });

    it('skips gate for showcase verificationMode', async () => {
      // showcase + 0 remaining refs → should NOT pause
      mockPrismaPodcastFindUnique.mockResolvedValue({
        topic: 'Showcase Topic',
        source: 'TWITTER',
        verificationMode: 'showcase',
      });
      mockPrismaReferenceFindMany.mockResolvedValue([
        { id: 'ref-001', number: 1, title: 'Paper', authors: [], year: 2023, url: 'https://example.com', doi: null, type: 'article' },
      ]);
      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          ['ref-001', { domain: 'GENERAL', verdict: { status: 'REMOVED', confidence: 0 }, score: 0, checks: [], logOddsContributions: {} }],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      // Showcase should proceed to audio, not pause at SCRIPT_READY due to gate
      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalledWith(
        'podcast-001',
        expect.any(Array)
      );
    });

    it('pauses at SCRIPT_READY when references.length === 0 and not showcase', async () => {
      // Early-exit path: 0 refs, standard depth → gate fires
      mockPrismaReferenceFindMany.mockResolvedValue([]);

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'SCRIPT_READY', lowReferences: true },
      });
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notifications' },
        'send_notification',
        expect.objectContaining({ type: 'SCRIPT_READY' })
      );
    });
  });

  describe('skip re-verification on retry', () => {
    it('excludes previously verified refs from verification pipeline', async () => {
      // 3 refs total, ref-001 was verified in prior attempt
      mockPrismaReferenceFindMany.mockResolvedValue([
        { id: 'ref-001', number: 1, title: 'Paper A', authors: [], year: 2023, url: 'https://example.com/a', doi: null, type: 'article' },
        { id: 'ref-002', number: 2, title: 'Paper B', authors: [], year: 2023, url: 'https://example.com/b', doi: null, type: 'article' },
        { id: 'ref-003', number: 3, title: 'Paper C', authors: [], year: 2023, url: 'https://example.com/c', doi: null, type: 'article' },
      ]);

      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          ['ref-002', { domain: 'GENERAL', verdict: { status: 'VERIFIED' as const, confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} }],
          ['ref-003', { domain: 'GENERAL', verdict: { status: 'VERIFIED' as const, confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} }],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      const job = createMockJob({
        ...defaultPayload,
        referenceRetryAttempt: 1,
        previouslyVerifiedRefIds: ['ref-001'],
      });
      await processReferenceValidation(job);

      // Should only pass ref-002 and ref-003 to verification (not ref-001)
      const passedRefs = mockRunReferenceVerification.mock.calls[0][0] as Array<{ id: string }>;
      expect(passedRefs).toHaveLength(2);
      expect(passedRefs.map((r) => r.id)).toEqual(['ref-002', 'ref-003']);
    });

    it('includes skipped count in verified total', async () => {
      // Use quick_overview depth (requires 3) so 3 verified refs passes the gate
      mockPrismaDiscoveryFindUnique.mockResolvedValue({ depth: 'quick_overview' });

      mockPrismaReferenceFindMany.mockResolvedValue([
        { id: 'ref-001', number: 1, title: 'Paper A', authors: [], year: 2023, url: 'https://example.com/a', doi: null, type: 'article' },
        { id: 'ref-002', number: 2, title: 'Paper B', authors: [], year: 2023, url: 'https://example.com/b', doi: null, type: 'article' },
        { id: 'ref-003', number: 3, title: 'Paper C', authors: [], year: 2023, url: 'https://example.com/c', doi: null, type: 'article' },
      ]);

      mockRunReferenceVerification.mockResolvedValue({
        results: new Map([
          ['ref-002', { domain: 'GENERAL', verdict: { status: 'VERIFIED' as const, confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} }],
          ['ref-003', { domain: 'GENERAL', verdict: { status: 'VERIFIED' as const, confidence: 0.8 }, score: 0.8, checks: [], logOddsContributions: {} }],
        ]),
        rejectedRefIds: new Set<string>(),
      });

      const job = createMockJob({
        ...defaultPayload,
        referenceRetryAttempt: 1,
        previouslyVerifiedRefIds: ['ref-001'],
      });
      await processReferenceValidation(job);

      // Complete progress snapshot should show 3 verified (1 skipped + 2 new)
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: expect.objectContaining({
          verificationProgress: expect.objectContaining({
            verified: 3,
            phase: 'complete',
          }),
        }),
      });
    });
  });
});
