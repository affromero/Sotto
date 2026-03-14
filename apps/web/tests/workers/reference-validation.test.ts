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
      findUniqueOrThrow: vi.fn().mockResolvedValue({ plan: 'PRO', role: 'USER' }),
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
  },
  audioGenerationQueue: { name: 'audio-generation' },
  notificationQueue: { name: 'notifications' },
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: vi.fn().mockResolvedValue(null),
  hasByokKey: vi.fn().mockResolvedValue(false),
  getByokKey: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/tier-features', () => ({
  getTierFeatures: vi.fn().mockReturnValue({
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

vi.mock('@/lib/providers/ai-registry', () => ({
  resolveAiModelAndProvider: vi.fn().mockResolvedValue({ model: 'claude-haiku-4-5-20251001', provider: 'anthropic' }),
  getCheapestModelForProvider: vi.fn().mockReturnValue('claude-haiku-4-5-20251001'),
}));

vi.mock('@/lib/free-tier-provider-selector', () => ({
  selectFreeTierProviders: vi.fn().mockResolvedValue({
    aiProvider: 'anthropic',
    aiModel: 'claude-haiku-4-5-20251001',
    aiQuota: 10,
    ttsProvider: 'elevenlabs',
    ttsModel: 'eleven_multilingual_v2',
    ttsQuota: 10,
  }),
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

const mockMarkPodcastFailed = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/pipeline-resume', () => ({
  markPodcastFailed: (...args: unknown[]) => mockMarkPodcastFailed(...args),
}));

vi.mock('@/lib/script-verifier', () => ({
  MIN_REFERENCE_COUNTS: {
    deep_dive: 10,
    standard: 5,
    quick_overview: 3,
    eli5: 3,
  },
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
      verificationMode: 'standard',
    });

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

  describe('no references to validate (showcase mode — gate exempt)', () => {
    beforeEach(() => {
      mockPrismaReferenceFindMany.mockResolvedValue([]);
      mockPrismaPodcastFindUnique.mockResolvedValue({
        topic: 'Quantum Computing Basics',
        source: 'TWITTER',
        verificationMode: 'showcase',
      });
    });

    it('creates segments from script turns when no references exist', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: {
          podcastId: 'podcast-001',
          speaker: 'HOST',
          text: 'Welcome to the show! [1]',
          order: 0,
        },
      });

      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: {
          podcastId: 'podcast-001',
          speaker: 'EXPERT',
          text: 'Thanks for having me!',
          order: 1,
        },
      });
    });

    it('queues audio generation for each segment when no references exist', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockAddJob).toHaveBeenCalledWith({ name: 'audio-generation' }, 'generate_audio', {
        podcastId: 'podcast-001',
        segmentId: 'segment-000',
        speaker: 'HOST',
        text: 'Welcome to the show! [1]',
        previousText: undefined,
        nextText: 'Thanks for having me!',
      });

      expect(mockAddJob).toHaveBeenCalledWith({ name: 'audio-generation' }, 'generate_audio', {
        podcastId: 'podcast-001',
        segmentId: 'segment-001',
        speaker: 'EXPERT',
        text: 'Thanks for having me!',
        previousText: 'Welcome to the show! [1]',
        nextText: undefined,
      });
    });

    it('still queues audio generation when no references exist', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'audio-generation' },
        'generate_audio',
        expect.objectContaining({ podcastId: 'podcast-001' })
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
        undefined,
        expect.any(String),
        'anthropic'
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

    it('fails podcast via markPodcastFailed when all references are removed', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockMarkPodcastFailed).toHaveBeenCalledWith(
        'podcast-001',
        expect.stringContaining('reference(s) could be verified')
      );
    });

    it('does not continue to audio generation when all references are removed', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockAddJob).not.toHaveBeenCalledWith(
        expect.anything(),
        'generate_audio',
        expect.anything()
      );
    });

    it('sends PODCAST_FAILED notification when all references are removed', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notifications' },
        'send_notification',
        expect.objectContaining({
          userId: 'user-001',
          type: 'PODCAST_FAILED',
        })
      );
    });
  });

  describe('segment creation and audio generation queueing', () => {
    it('creates segments from script turns after validation', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaSegmentCreate).toHaveBeenCalledTimes(2);
      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: {
          podcastId: 'podcast-001',
          speaker: 'HOST',
          text: 'Welcome to the show! [1]',
          order: 0,
        },
      });
    });

    it('queues audio generation for each segment', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'audio-generation' },
        'generate_audio',
        expect.objectContaining({
          podcastId: 'podcast-001',
          segmentId: 'segment-000',
          speaker: 'HOST',
        })
      );
    });

    it('updates podcast status to GENERATING_AUDIO after queueing', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'GENERATING_AUDIO' },
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
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({ source: 'TWITTER' });
    });

    it('calls selectFreeTierProviders for free-tier user (no-refs path)', async () => {
      const { hasByokKey } = await import('@/lib/byok');
      (hasByokKey as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const { selectFreeTierProviders } = await import('@/lib/free-tier-provider-selector');

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(selectFreeTierProviders).toHaveBeenCalledWith('user-001');
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'podcast-001' },
          data: { ttsProvider: 'elevenlabs', ttsModel: 'eleven_multilingual_v2' },
        })
      );
    });

    it('skips selectFreeTierProviders for BYOK user (no-refs path)', async () => {
      const { hasByokKey } = await import('@/lib/byok');
      (hasByokKey as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const { selectFreeTierProviders } = await import('@/lib/free-tier-provider-selector');

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(selectFreeTierProviders).not.toHaveBeenCalled();
    });

    it('calls selectFreeTierProviders for free-tier at full-validation auto-approve', async () => {
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
      // TWITTER auto-approves + non-BYOK
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({ source: 'TWITTER' });
      const { hasByokKey } = await import('@/lib/byok');
      (hasByokKey as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const { selectFreeTierProviders } = await import('@/lib/free-tier-provider-selector');

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(selectFreeTierProviders).toHaveBeenCalledWith('user-001');
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { ttsProvider: 'elevenlabs', ttsModel: 'eleven_multilingual_v2' },
        })
      );
    });

    it('skips selectFreeTierProviders for BYOK at full-validation auto-approve', async () => {
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
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({ source: 'TWITTER' });
      const { hasByokKey } = await import('@/lib/byok');
      (hasByokKey as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const { selectFreeTierProviders } = await import('@/lib/free-tier-provider-selector');

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(selectFreeTierProviders).not.toHaveBeenCalled();
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
      mockPrismaSegmentCreate.mockRejectedValueOnce(new Error('Segment creation failed'));
      const job = createMockJob(defaultPayload);

      await expect(processReferenceValidation(job)).rejects.toThrow('Segment creation failed');
    });
  });

  describe('minimum reference gate', () => {
    it('fails podcast when remaining references drop below minimum for depth', async () => {
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

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockMarkPodcastFailed).toHaveBeenCalledWith(
        'podcast-001',
        expect.stringContaining('1 reference(s) could be verified')
      );
      expect(mockAddJob).not.toHaveBeenCalledWith(
        expect.anything(), 'generate_audio', expect.anything()
      );
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

      expect(mockMarkPodcastFailed).not.toHaveBeenCalled();
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

      expect(mockMarkPodcastFailed).not.toHaveBeenCalled();
    });

    it('skips gate for showcase verificationMode', async () => {
      // showcase + 0 remaining refs → should NOT fail
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

      expect(mockMarkPodcastFailed).not.toHaveBeenCalled();
    });

    it('fails podcast when references.length === 0 and not showcase', async () => {
      // Early-exit path: 0 refs, standard depth → gate fires
      mockPrismaReferenceFindMany.mockResolvedValue([]);

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockMarkPodcastFailed).toHaveBeenCalledWith(
        'podcast-001',
        expect.stringContaining('No references could be found')
      );
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notifications' },
        'send_notification',
        expect.objectContaining({ type: 'PODCAST_FAILED' })
      );
    });
  });
});
