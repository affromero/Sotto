import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockPrismaReferenceFindMany = vi.fn();
const mockPrismaScriptFindUnique = vi.fn();
const mockPrismaSegmentCreate = vi.fn();
const mockPrismaReferenceUpdate = vi.fn();
const mockPrismaReferenceDeleteMany = vi.fn();
const mockPrismaScriptUpdate = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockPodcastUpdate = vi.fn();

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
    segment: {
      create: (...args: unknown[]) => mockPrismaSegmentCreate(...args),
    },
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
  },
}));

const mockAddJob = vi.fn();
vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    GENERATE_AUDIO: 'generate_audio',
    SEND_NOTIFICATION: 'send_notification',
  },
  audioGenerationQueue: { name: 'audio-generation' },
  notificationQueue: { name: 'notifications' },
}));

const mockVerifyUrl = vi.fn();
const mockVerifyDoi = vi.fn();
const mockSearchTitle = vi.fn();
const mockAiEvaluateReferences = vi.fn();

vi.mock('@/lib/reference-validator', async () => {
  const actual = await vi.importActual<typeof import('@/lib/reference-validator')>('@/lib/reference-validator');
  return {
    verifyUrl: (...args: unknown[]) => mockVerifyUrl(...args),
    verifyDoi: (...args: unknown[]) => mockVerifyDoi(...args),
    searchTitle: (...args: unknown[]) => mockSearchTitle(...args),
    aiEvaluateReferences: (...args: unknown[]) => mockAiEvaluateReferences(...args),
    computeVerificationVerdict: actual.computeVerificationVerdict,
  };
});

vi.mock('@/lib/script-updater', async () => {
  const actual = await vi.importActual('@/lib/script-updater');
  return actual;
});

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
  podcastId: 'pod-001',
  userId: 'user-001',
};

const mockScript = {
  podcastId: 'pod-001',
  turns: [
    { speaker: 'HOST', text: 'According to research [1], this is important.' },
    { speaker: 'EXPERT', text: 'Yes, and [2] confirms this finding.' },
  ],
  markdown: 'Research [1] is important. Study [2] confirms this.',
};

const mockReferences = [
  {
    id: 'ref-001',
    podcastId: 'pod-001',
    number: 1,
    title: 'Attention Is All You Need',
    authors: ['Vaswani, A.'],
    year: 2017,
    url: 'https://arxiv.org/abs/1706.03762',
    doi: '10.48550/arXiv.1706.03762',
    type: 'PAPER',
    publisher: null,
    verificationStatus: 'PENDING',
    verificationDetails: null,
    originalTitle: null,
    createdAt: new Date(),
  },
  {
    id: 'ref-002',
    podcastId: 'pod-001',
    number: 2,
    title: 'BERT: Pre-training of Deep Bidirectional Transformers',
    authors: ['Devlin, J.'],
    year: 2018,
    url: 'https://arxiv.org/abs/1810.04805',
    doi: null,
    type: 'PAPER',
    publisher: null,
    verificationStatus: 'PENDING',
    verificationDetails: null,
    originalTitle: null,
    createdAt: new Date(),
  },
];

function setupDefaultMocks() {
  mockPrismaReferenceFindMany.mockResolvedValue(mockReferences);
  mockPrismaScriptFindUnique.mockResolvedValue(mockScript);
  mockPodcastFindUnique.mockResolvedValue({ topic: 'machine learning' });
  mockPodcastUpdate.mockResolvedValue({});
  mockPrismaReferenceUpdate.mockResolvedValue({});
  mockPrismaReferenceDeleteMany.mockResolvedValue({});
  mockPrismaScriptUpdate.mockResolvedValue({});
  mockPrismaSegmentCreate.mockImplementation(async (args: { data: { podcastId: string; speaker: string; text: string; order: number } }) => ({
    id: `seg-${args.data.order}`,
    ...args.data,
  }));
  mockAddJob.mockResolvedValue({});

  // All verification checks pass
  mockVerifyUrl.mockResolvedValue({ layer: 'url', passed: true, confidence: 0.6, detail: 'OK' });
  mockVerifyDoi.mockResolvedValue({ layer: 'doi', passed: true, confidence: 0.95, detail: 'DOI verified' });
  mockSearchTitle.mockResolvedValue({ layer: 'title_search', passed: true, confidence: 0.9, detail: 'Found' });
  mockAiEvaluateReferences.mockResolvedValue(
    new Map([
      ['ref-001', { layer: 'ai', passed: true, confidence: 0.85, detail: 'AI: REAL' }],
      ['ref-002', { layer: 'ai', passed: true, confidence: 0.85, detail: 'AI: REAL' }],
    ])
  );
}

// ---- Tests ----

describe('processReferenceValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('loads references and script from database', async () => {
    const job = createMockJob(defaultPayload);
    await processReferenceValidation(job);

    expect(mockPrismaReferenceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { podcastId: 'pod-001' } })
    );
    expect(mockPrismaScriptFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { podcastId: 'pod-001' } })
    );
  });

  it('throws when script not found', async () => {
    mockPrismaScriptFindUnique.mockResolvedValue(null);
    const job = createMockJob(defaultPayload);

    await expect(processReferenceValidation(job)).rejects.toThrow('Script not found');
  });

  it('skips validation when no references exist', async () => {
    mockPrismaReferenceFindMany.mockResolvedValue([]);
    const job = createMockJob(defaultPayload);

    await processReferenceValidation(job);

    expect(mockVerifyUrl).not.toHaveBeenCalled();
    expect(mockPrismaSegmentCreate).toHaveBeenCalledTimes(2);
    expect(mockAddJob).toHaveBeenCalledTimes(2);
  });

  it('runs all 4 verification layers', async () => {
    const job = createMockJob(defaultPayload);
    await processReferenceValidation(job);

    expect(mockVerifyUrl).toHaveBeenCalledTimes(2);
    expect(mockVerifyDoi).toHaveBeenCalledTimes(2);
    expect(mockSearchTitle).toHaveBeenCalledTimes(2);
    expect(mockAiEvaluateReferences).toHaveBeenCalledTimes(1);
  });

  it('creates segments and queues audio generation after verification', async () => {
    const job = createMockJob(defaultPayload);
    await processReferenceValidation(job);

    expect(mockPrismaSegmentCreate).toHaveBeenCalledTimes(2);
    expect(mockAddJob).toHaveBeenCalledTimes(2);
  });

  it('sets podcast status to GENERATING_AUDIO on success', async () => {
    const job = createMockJob(defaultPayload);
    await processReferenceValidation(job);

    expect(mockPodcastUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'GENERATING_AUDIO' }),
      })
    );
  });

  it('sets podcast to FAILED when all references fail', async () => {
    mockVerifyUrl.mockResolvedValue({ layer: 'url', passed: false, confidence: 0, detail: 'Failed' });
    mockVerifyDoi.mockResolvedValue({ layer: 'doi', passed: false, confidence: 0, detail: 'No DOI' });
    mockSearchTitle.mockResolvedValue({ layer: 'title_search', passed: false, confidence: 0, detail: 'Not found' });
    mockAiEvaluateReferences.mockResolvedValue(
      new Map([
        ['ref-001', { layer: 'ai', passed: false, confidence: 0, detail: 'AI: HALLUCINATED — fake' }],
        ['ref-002', { layer: 'ai', passed: false, confidence: 0, detail: 'AI: HALLUCINATED — fake' }],
      ])
    );

    const job = createMockJob(defaultPayload);
    await processReferenceValidation(job);

    expect(mockPodcastUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      })
    );
  });

  it('sends notification when all references fail', async () => {
    mockVerifyUrl.mockResolvedValue({ layer: 'url', passed: false, confidence: 0, detail: 'Failed' });
    mockVerifyDoi.mockResolvedValue({ layer: 'doi', passed: false, confidence: 0, detail: 'No DOI' });
    mockSearchTitle.mockResolvedValue({ layer: 'title_search', passed: false, confidence: 0, detail: 'Not found' });
    mockAiEvaluateReferences.mockResolvedValue(
      new Map([
        ['ref-001', { layer: 'ai', passed: false, confidence: 0, detail: 'AI: HALLUCINATED — fake' }],
        ['ref-002', { layer: 'ai', passed: false, confidence: 0, detail: 'AI: HALLUCINATED — fake' }],
      ])
    );

    const job = createMockJob(defaultPayload);
    await processReferenceValidation(job);

    expect(mockAddJob).toHaveBeenCalledWith(
      expect.anything(),
      'send_notification',
      expect.objectContaining({ userId: 'user-001' })
    );
  });

  it('updates progress throughout the pipeline', async () => {
    const job = createMockJob(defaultPayload);
    await processReferenceValidation(job);

    expect(job.updateProgress).toHaveBeenCalledWith(5);
    expect(job.updateProgress).toHaveBeenCalledWith(15);
    expect(job.updateProgress).toHaveBeenCalledWith(50);
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  it('continues when AI evaluation fails', async () => {
    mockAiEvaluateReferences.mockRejectedValue(new Error('AI unavailable'));

    const job = createMockJob(defaultPayload);
    await processReferenceValidation(job);

    // Should still complete — DOI check passes so refs are verified
    expect(mockPrismaSegmentCreate).toHaveBeenCalled();
    expect(mockPodcastUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'GENERATING_AUDIO' }),
      })
    );
  });
});
