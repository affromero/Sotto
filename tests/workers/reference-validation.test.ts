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
const mockPrismaPodcastFindUnique = vi.fn().mockResolvedValue({
  topic: 'Quantum Computing',
});
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});
const mockPrismaSegmentCreate = vi.fn().mockResolvedValue({ id: 'segment-001' });

vi.mock('@/lib/prisma', () => ({
  prisma: {
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
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
    },
    segment: {
      create: (...args: unknown[]) => mockPrismaSegmentCreate(...args),
    },
  },
}));

const mockVerifyUrl = vi.fn().mockResolvedValue({
  layer: 'url',
  passed: true,
  confidence: 0.6,
  detail: 'URL returned 200',
});
const mockVerifyDoi = vi.fn().mockResolvedValue({
  layer: 'doi',
  passed: true,
  confidence: 0.95,
  detail: 'DOI verified: title similarity 100%',
});
const mockSearchTitle = vi.fn().mockResolvedValue({
  layer: 'title_search',
  passed: true,
  confidence: 0.9,
  detail: 'Title matched in OpenAlex (similarity 95%)',
});
const mockAiEvaluateReferences = vi.fn().mockResolvedValue(new Map());
const mockComputeVerificationVerdict = vi.fn().mockReturnValue({
  status: 'VERIFIED',
  confidence: 0.8,
});

const mockAssessSourceQuality = vi
  .fn()
  .mockReturnValue({ accepted: true, reason: 'Trusted source' });

vi.mock('@/lib/reference-validator', () => ({
  verifyUrl: (...args: unknown[]) => mockVerifyUrl(...args),
  verifyDoi: (...args: unknown[]) => mockVerifyDoi(...args),
  searchTitle: (...args: unknown[]) => mockSearchTitle(...args),
  aiEvaluateReferences: (...args: unknown[]) => mockAiEvaluateReferences(...args),
  computeVerificationVerdict: (...args: unknown[]) => mockComputeVerificationVerdict(...args),
  assessSourceQuality: (...args: unknown[]) => mockAssessSourceQuality(...args),
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

    // Default: single reference, script with turns
    mockPrismaReferenceFindMany.mockResolvedValue([
      {
        id: 'ref-001',
        number: 1,
        title: 'Introduction to Quantum Computing',
        authors: ['John Doe', 'Jane Smith'],
        year: 2023,
        url: 'https://example.com/paper',
        doi: '10.1234/qc.2023.001',
        type: 'article',
      },
    ]);

    mockPrismaScriptFindUnique.mockResolvedValue({
      turns: [
        { speaker: 'HOST', text: 'Welcome to the show! [1]' },
        { speaker: 'EXPERT', text: 'Thanks for having me!' },
      ],
      markdown: '# Transcript\n\n[1] Introduction to Quantum Computing',
    });

    mockPrismaPodcastFindUnique.mockResolvedValue({
      topic: 'Quantum Computing Basics',
    });

    // Default: all checks pass
    mockVerifyUrl.mockResolvedValue({
      layer: 'url',
      passed: true,
      confidence: 0.6,
      detail: 'URL returned 200',
    });

    mockVerifyDoi.mockResolvedValue({
      layer: 'doi',
      passed: true,
      confidence: 0.95,
      detail: 'DOI verified: title similarity 100%',
    });

    mockSearchTitle.mockResolvedValue({
      layer: 'title_search',
      passed: true,
      confidence: 0.9,
      detail: 'Title matched in OpenAlex (similarity 95%)',
    });

    mockAiEvaluateReferences.mockResolvedValue(
      new Map([
        [
          'ref-001',
          {
            layer: 'ai',
            passed: true,
            confidence: 0.85,
            detail: 'AI: REAL — Reference appears legitimate',
          },
        ],
      ])
    );

    mockComputeVerificationVerdict.mockReturnValue({
      status: 'VERIFIED',
      confidence: 0.85,
    });

    mockPrismaSegmentCreate.mockImplementation(async ({ data }: { data: { order: number } }) => ({
      id: `segment-${data.order.toString().padStart(3, '0')}`,
    }));
  });

  describe('loading references and script', () => {
    it('loads references for the podcast', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceFindMany).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        orderBy: { number: 'asc' },
      });
    });

    it('loads the script for the podcast', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaScriptFindUnique).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
      });
    });

    it('loads the podcast topic', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaPodcastFindUnique).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        select: { topic: true },
      });
    });

    it('throws error if script is not found', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue(null);
      const job = createMockJob(defaultPayload);

      await expect(processReferenceValidation(job)).rejects.toThrow(
        'Script not found for podcast podcast-001'
      );
    });
  });

  describe('no references to validate', () => {
    beforeEach(() => {
      mockPrismaReferenceFindMany.mockResolvedValue([]);
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
      });

      expect(mockAddJob).toHaveBeenCalledWith({ name: 'audio-generation' }, 'generate_audio', {
        podcastId: 'podcast-001',
        segmentId: 'segment-001',
        speaker: 'EXPERT',
        text: 'Thanks for having me!',
      });
    });

    it('does not run verification layers when no references exist', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockVerifyUrl).not.toHaveBeenCalled();
      expect(mockVerifyDoi).not.toHaveBeenCalled();
      expect(mockSearchTitle).not.toHaveBeenCalled();
      expect(mockAiEvaluateReferences).not.toHaveBeenCalled();
    });
  });

  describe('4-layer verification pipeline', () => {
    it('runs URL verification for each reference', async () => {
      mockPrismaReferenceFindMany.mockResolvedValue([
        {
          id: 'ref-001',
          number: 1,
          title: 'Paper A',
          authors: ['Author A'],
          year: 2023,
          url: 'https://example.com/paper-a',
          doi: null,
          type: 'article',
        },
        {
          id: 'ref-002',
          number: 2,
          title: 'Paper B',
          authors: ['Author B'],
          year: 2022,
          url: 'https://example.com/paper-b',
          doi: null,
          type: 'article',
        },
      ]);

      mockAiEvaluateReferences.mockResolvedValue(
        new Map([
          ['ref-001', { layer: 'ai', passed: true, confidence: 0.85, detail: 'AI: REAL' }],
          ['ref-002', { layer: 'ai', passed: true, confidence: 0.85, detail: 'AI: REAL' }],
        ])
      );

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockVerifyUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'ref-001',
          url: 'https://example.com/paper-a',
        })
      );

      expect(mockVerifyUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'ref-002',
          url: 'https://example.com/paper-b',
        })
      );
    });

    it('runs DOI verification for each reference', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockVerifyDoi).toHaveBeenCalledWith(
        expect.objectContaining({
          doi: '10.1234/qc.2023.001',
        })
      );
    });

    it('runs title search for each reference', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockSearchTitle).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Introduction to Quantum Computing',
        })
      );
    });

    it('runs AI evaluation after external checks', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockAiEvaluateReferences).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'ref-001',
            title: 'Introduction to Quantum Computing',
          }),
        ]),
        expect.any(Map),
        'Quantum Computing Basics'
      );
    });

    it('passes prior checks to AI evaluation', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      const priorChecks = mockAiEvaluateReferences.mock.calls[0][1] as Map<string, unknown[]>;
      const ref001Checks = priorChecks.get('ref-001') as Array<{ layer: string }>;

      expect(ref001Checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ layer: 'url' }),
          expect.objectContaining({ layer: 'doi' }),
          expect.objectContaining({ layer: 'title_search' }),
        ])
      );
    });

    it('proceeds with empty checks if all external APIs fail', async () => {
      mockVerifyUrl.mockRejectedValue(new Error('Network error'));
      mockVerifyDoi.mockRejectedValue(new Error('Network error'));
      mockSearchTitle.mockRejectedValue(new Error('Network error'));

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockAiEvaluateReferences).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Map),
        expect.anything()
      );
    });

    it('continues without AI checks if AI evaluation fails', async () => {
      mockAiEvaluateReferences.mockRejectedValue(new Error('Claude API error'));
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockComputeVerificationVerdict).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ layer: 'url' }),
          expect.objectContaining({ layer: 'doi' }),
          expect.objectContaining({ layer: 'title_search' }),
        ])
      );
    });
  });

  describe('verification verdicts and status updates', () => {
    it('updates reference status to VERIFIED when verdict is VERIFIED', async () => {
      mockComputeVerificationVerdict.mockReturnValue({
        status: 'VERIFIED',
        confidence: 0.9,
      });

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
        {
          id: 'ref-001',
          number: 1,
          title: 'Introduction to Quantum Computing',
          authors: ['John Doe', 'Jane Smith'],
          year: 2023,
          url: 'https://example.com/paper',
          doi: '10.1234/qc.2023.001',
          type: 'article',
        },
        {
          id: 'ref-002',
          number: 2,
          title: 'Another Paper',
          authors: ['Other Author'],
          year: 2022,
          url: 'https://example.com/paper2',
          doi: null,
          type: 'article',
        },
      ]);

      mockAiEvaluateReferences.mockResolvedValue(
        new Map([
          ['ref-001', { layer: 'ai', passed: false, confidence: 0, detail: 'AI: FAKE' }],
          ['ref-002', { layer: 'ai', passed: true, confidence: 0.8, detail: 'AI: REAL' }],
        ])
      );

      mockComputeVerificationVerdict
        .mockReturnValueOnce({
          status: 'REMOVED',
          confidence: 0.1,
        })
        .mockReturnValueOnce({
          status: 'VERIFIED',
          confidence: 0.8,
        });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-001' },
        data: expect.objectContaining({
          verificationStatus: 'REMOVED',
        }),
      });
    });

    it('updates reference status to FAILED when verdict is FAILED', async () => {
      mockPrismaReferenceFindMany.mockResolvedValue([
        {
          id: 'ref-001',
          number: 1,
          title: 'Introduction to Quantum Computing',
          authors: ['John Doe', 'Jane Smith'],
          year: 2023,
          url: 'https://example.com/paper',
          doi: '10.1234/qc.2023.001',
          type: 'article',
        },
        {
          id: 'ref-002',
          number: 2,
          title: 'Another Paper',
          authors: ['Other Author'],
          year: 2022,
          url: 'https://example.com/paper2',
          doi: null,
          type: 'article',
        },
      ]);

      mockAiEvaluateReferences.mockResolvedValue(
        new Map([
          ['ref-001', { layer: 'ai', passed: false, confidence: 0, detail: 'AI: FAKE' }],
          ['ref-002', { layer: 'ai', passed: true, confidence: 0.8, detail: 'AI: REAL' }],
        ])
      );

      mockComputeVerificationVerdict
        .mockReturnValueOnce({
          status: 'FAILED',
          confidence: 0,
        })
        .mockReturnValueOnce({
          status: 'VERIFIED',
          confidence: 0.8,
        });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-001' },
        data: expect.objectContaining({
          verificationStatus: 'FAILED',
        }),
      });
    });

    it('updates reference with replacement data when verdict is REPLACED', async () => {
      mockComputeVerificationVerdict.mockReturnValue({
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
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-001' },
        data: expect.objectContaining({
          verificationStatus: 'REPLACED',
          originalTitle: 'Introduction to Quantum Computing',
          title: 'Corrected Title',
          authors: ['Corrected Author'],
          year: 2024,
          url: 'https://corrected.com/paper',
          doi: '10.5678/corrected',
          publisher: 'Nature',
        }),
      });
    });

    it('stores verification details with all checks', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-001' },
        data: expect.objectContaining({
          verificationDetails: expect.objectContaining({
            checks: expect.arrayContaining([
              expect.objectContaining({ layer: 'url' }),
              expect.objectContaining({ layer: 'doi' }),
              expect.objectContaining({ layer: 'title_search' }),
              expect.objectContaining({ layer: 'ai' }),
            ]),
            verifiedAt: expect.any(String),
          }),
        }),
      });
    });
  });

  describe('AI-only fallback mode', () => {
    it('lowers verification threshold when only AI checks succeed', async () => {
      mockVerifyUrl.mockRejectedValue(new Error('Timeout'));
      mockVerifyDoi.mockRejectedValue(new Error('Timeout'));
      mockSearchTitle.mockRejectedValue(new Error('Timeout'));

      mockAiEvaluateReferences.mockResolvedValue(
        new Map([
          [
            'ref-001',
            {
              layer: 'ai',
              passed: true,
              confidence: 0.4,
              detail: 'AI: REAL',
            },
          ],
        ])
      );

      mockComputeVerificationVerdict.mockReturnValue({
        status: 'VERIFIED',
        confidence: 0.4,
      });

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-001' },
        data: expect.objectContaining({
          verificationStatus: 'VERIFIED',
        }),
      });
    });
  });

  describe('script cleaning when references are removed', () => {
    beforeEach(() => {
      mockPrismaReferenceFindMany.mockResolvedValue([
        {
          id: 'ref-001',
          number: 1,
          title: 'Paper A',
          authors: [],
          year: null,
          url: null,
          doi: null,
          type: 'article',
        },
        {
          id: 'ref-002',
          number: 2,
          title: 'Paper B',
          authors: [],
          year: null,
          url: null,
          doi: null,
          type: 'article',
        },
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
      mockComputeVerificationVerdict
        .mockReturnValueOnce({ status: 'REMOVED', confidence: 0 })
        .mockReturnValueOnce({ status: 'VERIFIED', confidence: 0.8 });

      mockAiEvaluateReferences.mockResolvedValue(
        new Map([
          ['ref-001', { layer: 'ai', passed: false, confidence: 0, detail: 'AI: FAKE' }],
          ['ref-002', { layer: 'ai', passed: true, confidence: 0.8, detail: 'AI: REAL' }],
        ])
      );

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockBuildRenumberMap).toHaveBeenCalledWith([1, 2], expect.any(Set));

      const removedSet = mockBuildRenumberMap.mock.calls[0]?.[1] as Set<number>;
      expect(Array.from(removedSet)).toContain(1);
    });

    it('cleans and renumbers citations in turns', async () => {
      mockComputeVerificationVerdict
        .mockReturnValueOnce({ status: 'REMOVED', confidence: 0 })
        .mockReturnValueOnce({ status: 'VERIFIED', confidence: 0.8 });

      mockAiEvaluateReferences.mockResolvedValue(
        new Map([
          ['ref-001', { layer: 'ai', passed: false, confidence: 0, detail: 'AI: FAKE' }],
          ['ref-002', { layer: 'ai', passed: true, confidence: 0.8, detail: 'AI: REAL' }],
        ])
      );

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
      mockComputeVerificationVerdict
        .mockReturnValueOnce({ status: 'REMOVED', confidence: 0 })
        .mockReturnValueOnce({ status: 'VERIFIED', confidence: 0.8 });

      mockAiEvaluateReferences.mockResolvedValue(
        new Map([
          ['ref-001', { layer: 'ai', passed: false, confidence: 0, detail: 'AI: FAKE' }],
          ['ref-002', { layer: 'ai', passed: true, confidence: 0.8, detail: 'AI: REAL' }],
        ])
      );

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
      mockComputeVerificationVerdict
        .mockReturnValueOnce({ status: 'REMOVED', confidence: 0 })
        .mockReturnValueOnce({ status: 'VERIFIED', confidence: 0.8 });

      mockAiEvaluateReferences.mockResolvedValue(
        new Map([
          ['ref-001', { layer: 'ai', passed: false, confidence: 0, detail: 'AI: FAKE' }],
          ['ref-002', { layer: 'ai', passed: true, confidence: 0.8, detail: 'AI: REAL' }],
        ])
      );

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
      mockComputeVerificationVerdict
        .mockReturnValueOnce({ status: 'REMOVED', confidence: 0 })
        .mockReturnValueOnce({ status: 'VERIFIED', confidence: 0.8 });

      mockAiEvaluateReferences.mockResolvedValue(
        new Map([
          ['ref-001', { layer: 'ai', passed: false, confidence: 0, detail: 'AI: FAKE' }],
          ['ref-002', { layer: 'ai', passed: true, confidence: 0.8, detail: 'AI: REAL' }],
        ])
      );

      mockBuildRenumberMap.mockReturnValue(new Map([[2, 1]]));

      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaReferenceUpdate).toHaveBeenCalledWith({
        where: { id: 'ref-002' },
        data: { number: 1 },
      });
    });

    it('deletes removed references from database', async () => {
      mockComputeVerificationVerdict
        .mockReturnValueOnce({ status: 'REMOVED', confidence: 0 })
        .mockReturnValueOnce({ status: 'VERIFIED', confidence: 0.8 });

      mockAiEvaluateReferences.mockResolvedValue(
        new Map([
          ['ref-001', { layer: 'ai', passed: false, confidence: 0, detail: 'AI: FAKE' }],
          ['ref-002', { layer: 'ai', passed: true, confidence: 0.8, detail: 'AI: REAL' }],
        ])
      );

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
      mockComputeVerificationVerdict.mockReturnValue({
        status: 'REMOVED',
        confidence: 0,
      });

      mockAiEvaluateReferences.mockResolvedValue(
        new Map([['ref-001', { layer: 'ai', passed: false, confidence: 0, detail: 'AI: FAKE' }]])
      );
    });

    it('sets podcast status to FAILED when all references are removed', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'FAILED' },
      });
    });

    it('sends failure notification when all references fail', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockAddJob).toHaveBeenCalledWith({ name: 'notifications' }, 'send_notification', {
        userId: 'user-001',
        type: 'PODCAST_READY',
        title: 'Podcast generation failed',
        message: 'All references could not be verified. Please try again with a different topic.',
        data: { podcastId: 'podcast-001' },
      });
    });

    it('does not create segments when all references fail', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockPrismaSegmentCreate).not.toHaveBeenCalled();
    });

    it('does not queue audio generation when all references fail', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(mockAddJob).toHaveBeenCalledTimes(1);
      expect(mockAddJob).toHaveBeenCalledWith(
        expect.anything(),
        'send_notification',
        expect.anything()
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
    it('reports progress at 5% after starting', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(job.updateProgress).toHaveBeenCalledWith(5);
    });

    it('reports progress at 15% after layer 1-3 setup', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(job.updateProgress).toHaveBeenCalledWith(15);
    });

    it('reports progress at 50% after external checks complete', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(job.updateProgress).toHaveBeenCalledWith(50);
    });

    it('reports progress at 55% after AI evaluation', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(job.updateProgress).toHaveBeenCalledWith(55);
    });

    it('reports progress at 65% after computing verdicts', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(job.updateProgress).toHaveBeenCalledWith(65);
    });

    it('reports progress at 70% after updating references', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(job.updateProgress).toHaveBeenCalledWith(70);
    });

    it('reports progress at 95% after creating segments', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(job.updateProgress).toHaveBeenCalledWith(95);
    });

    it('reports progress at 100% at the end', async () => {
      const job = createMockJob(defaultPayload);
      await processReferenceValidation(job);

      expect(job.updateProgress).toHaveBeenCalledWith(100);
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
});
