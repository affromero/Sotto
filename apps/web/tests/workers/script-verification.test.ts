import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaScriptFindUniqueOrThrow = vi.fn();
const mockPrismaScriptUpdate = vi.fn().mockResolvedValue({});
const mockPrismaDiscoveryFindUniqueOrThrow = vi.fn();
const mockPrismaReferenceFindMany = vi.fn();
const mockPrismaReferenceDeleteMany = vi.fn().mockResolvedValue({});
const mockPrismaReferenceCreateMany = vi.fn().mockResolvedValue({});
const mockPrismaPodcastFindUniqueOrThrow = vi.fn();
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    script: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaScriptFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockPrismaScriptUpdate(...args),
    },
    discovery: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaDiscoveryFindUniqueOrThrow(...args),
    },
    reference: {
      findMany: (...args: unknown[]) => mockPrismaReferenceFindMany(...args),
      deleteMany: (...args: unknown[]) => mockPrismaReferenceDeleteMany(...args),
      createMany: (...args: unknown[]) => mockPrismaReferenceCreateMany(...args),
    },
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ plan: 'FREE' }),
    },
    podcast: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaPodcastFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockVerifyScript = vi.fn();
vi.mock('@/lib/script-verifier', () => ({
  verifyScript: (...args: unknown[]) => mockVerifyScript(...args),
}));

const mockGenerateScriptWithFeedback = vi.fn();
vi.mock('@/lib/script-generator', () => ({
  generateScriptWithFeedback: (...args: unknown[]) => mockGenerateScriptWithFeedback(...args),
}));

const mockCreateSegmentsAndQueueAudio = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/segment-creator', () => ({
  createSegmentsAndQueueAudio: (...args: unknown[]) => mockCreateSegmentsAndQueueAudio(...args),
}));

const mockMarkPodcastFailed = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/pipeline-resume', () => ({
  markPodcastFailed: (...args: unknown[]) => mockMarkPodcastFailed(...args),
}));

const mockLogUsage = vi.fn();
vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

const mockAddJob = vi.fn().mockResolvedValue({ id: 'job-1' });
vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    VERIFY_SCRIPT: 'verify_script',
    VALIDATE_REFERENCES: 'validate_references',
    GENERATE_AUDIO: 'generate_audio',
    SEND_NOTIFICATION: 'send_notification',
  },
  scriptVerificationQueue: { name: 'script-verification' },
  referenceValidationQueue: { name: 'reference-validation' },
  audioGenerationQueue: { name: 'audio-generation' },
  notificationQueue: { name: 'notifications' },
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: vi.fn().mockResolvedValue(null),
  hasByokKey: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/tier-features', () => ({
  getTierFeatures: vi.fn().mockReturnValue({
    maxDurationMinutes: 40,
    maxQaInteractions: Infinity,
    webSearchEnabled: true,
    autoApproveScript: false,
    privateAllowed: true,
    analyticsEnabled: true,
  }),
}));

const mockGetFreeTierConfig = vi.fn();
vi.mock('@/lib/free-tier-config', () => ({
  getFreeTierConfig: (...args: unknown[]) => mockGetFreeTierConfig(...args),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderMeta: vi.fn().mockReturnValue({ defaultModel: 'claude-sonnet-4-6' }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test ----
import { processScriptVerification } from '@/workers/script-verification.worker';
import type { VerifyScriptPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function createMockJob(data: VerifyScriptPayload): Job<VerifyScriptPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<VerifyScriptPayload>;
}

const defaultPayload: VerifyScriptPayload = {
  podcastId: 'podcast-001',
  userId: 'user-001',
  discoveryId: 'discovery-001',
};

const defaultScript = {
  turns: [
    { speaker: 'HOST', text: 'Welcome! [1]' },
    { speaker: 'EXPERT', text: 'Thanks for having me!' },
  ],
  verificationAttempts: 0,
  verificationFeedback: null,
};

const defaultDiscovery = {
  id: 'discovery-001',
  topic: 'Quantum Computing',
  depth: 'standard',
  audienceLevel: 'intermediate',
  audience: 'general',
  focusAreas: ['algorithms'],
  tone: 'casual',
  durationTarget: 10,
  sourceContent: null,
  sourceMetadata: null,
};

const defaultReferences = [
  {
    number: 1,
    title: 'Quantum Supremacy',
    authors: ['Smith'],
    year: 2022,
    url: 'https://example.com',
    type: 'PAPER',
    publisher: 'Nature',
    doi: '10.1234/abc',
  },
];

const passedVerdict = {
  passed: true,
  score: 0.92,
  feedback: '',
  model: 'claude-haiku-4-5-20251001',
  inputTokens: 1200,
  outputTokens: 400,
  totalClaims: 5,
  unsupportedClaims: [],
  unreliableSourceClaims: [],
  referenceQuality: { totalCount: 1, requiredCount: 1, countPassed: true, seriousRatio: 0.8, qualityScore: 0.85 },
};

const failedVerdict = {
  ...passedVerdict,
  passed: false,
  score: 0.45,
  feedback: 'Claims in segment 2 are unsupported by the provided references.',
  unsupportedClaims: ['claim-a', 'claim-b'],
};

const revisedScriptResult = {
  turns: [{ speaker: 'HOST', text: 'Revised welcome.' }, { speaker: 'EXPERT', text: 'Revised expert turn.' }],
  references: [],
  soundCues: [],
  markdown: '**HOST:** Revised welcome.',
  model: 'claude-haiku-4-5-20251001',
  inputTokens: 900,
  outputTokens: 350,
};

// ---- Tests ----

describe('processScriptVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrismaScriptFindUniqueOrThrow.mockResolvedValue(defaultScript);
    mockPrismaDiscoveryFindUniqueOrThrow.mockResolvedValue(defaultDiscovery);
    mockPrismaReferenceFindMany.mockResolvedValue(defaultReferences);
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({ aiModel: null, source: 'WEB' });
    mockVerifyScript.mockResolvedValue(passedVerdict);
    mockGenerateScriptWithFeedback.mockResolvedValue(revisedScriptResult);
    mockGetFreeTierConfig.mockResolvedValue({ aiModel: 'claude-haiku-4-5-20251001', aiAllocations: [] });
  });

  describe('model resolution', () => {
    it('uses podcast-level aiModel when set', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({ aiModel: 'claude-opus-4-6-20251101', source: 'WEB' });

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockVerifyScript).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-opus-4-6-20251101' })
      );
    });

    it('falls back to free tier config when no podcast aiModel and no BYOK key', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({ aiModel: null, source: 'WEB' });
      mockGetFreeTierConfig.mockResolvedValue({ aiModel: 'claude-haiku-4-5-20251001', aiAllocations: [] });

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockVerifyScript).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-haiku-4-5-20251001' })
      );
    });
  });

  describe('verification pass — with references', () => {
    it('routes to reference validation when references exist', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'VALIDATING_REFERENCES' },
      });
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'reference-validation' },
        'validate_references',
        { podcastId: 'podcast-001', userId: 'user-001' }
      );
    });

    it('increments verificationAttempts on pass', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaScriptUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        data: { verificationAttempts: 1 },
      });
    });

    it('does not create segments when references exist', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
    });

    it('passes discovery metadata to verifyScript', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockVerifyScript).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'Quantum Computing',
          depth: 'standard',
          audienceLevel: 'intermediate',
        })
      );
    });

    it('passes attemptNumber as 1 on first verification', async () => {
      mockPrismaScriptFindUniqueOrThrow.mockResolvedValue({ ...defaultScript, verificationAttempts: 0 });

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockVerifyScript).toHaveBeenCalledWith(
        expect.objectContaining({ attemptNumber: 1 })
      );
    });
  });

  describe('verification pass — no references, WEB source', () => {
    beforeEach(() => {
      mockPrismaReferenceFindMany.mockResolvedValue([]);
      mockPrismaPodcastFindUniqueOrThrow
        .mockResolvedValueOnce({ aiModel: null })
        .mockResolvedValueOnce({ source: 'WEB' });
    });

    it('pauses at SCRIPT_READY', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'SCRIPT_READY' },
      });
    });

    it('sends SCRIPT_READY notification to user', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notifications' },
        'send_notification',
        expect.objectContaining({ userId: 'user-001', type: 'SCRIPT_READY' })
      );
    });

    it('does not create segments', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
    });
  });

  describe('verification pass — no references, IMPORT source', () => {
    beforeEach(() => {
      mockPrismaReferenceFindMany.mockResolvedValue([]);
      mockPrismaPodcastFindUniqueOrThrow
        .mockResolvedValueOnce({ aiModel: null })
        .mockResolvedValueOnce({ source: 'IMPORT' });
    });

    it('pauses at SCRIPT_READY for IMPORT source', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'SCRIPT_READY' },
      });
    });

    it('does not auto-approve for IMPORT source', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
    });
  });

  describe('verification pass — no references, TWITTER source (auto-approve)', () => {
    beforeEach(() => {
      mockPrismaReferenceFindMany.mockResolvedValue([]);
      mockPrismaPodcastFindUniqueOrThrow
        .mockResolvedValueOnce({ aiModel: null })
        .mockResolvedValueOnce({ source: 'TWITTER' });
    });

    it('auto-approves and creates segments', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalledWith(
        'podcast-001',
        defaultScript.turns
      );
    });

    it('sets status to GENERATING_AUDIO', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'GENERATING_AUDIO' },
      });
    });

    it('does not send SCRIPT_READY notification', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      const scriptReadyCalls = mockAddJob.mock.calls.filter(
        (c: unknown[]) => (c[2] as { type?: string })?.type === 'SCRIPT_READY'
      );
      expect(scriptReadyCalls).toHaveLength(0);
    });
  });

  describe('verification pass — no references, API source (auto-approve)', () => {
    beforeEach(() => {
      mockPrismaReferenceFindMany.mockResolvedValue([]);
      mockPrismaPodcastFindUniqueOrThrow
        .mockResolvedValueOnce({ aiModel: null })
        .mockResolvedValueOnce({ source: 'API' });
    });

    it('auto-approves for API source', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalled();
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'GENERATING_AUDIO' } })
      );
    });
  });

  describe('verification fail — revision loop (attempt < 3)', () => {
    beforeEach(() => {
      mockVerifyScript.mockResolvedValue(failedVerdict);
      mockPrismaScriptFindUniqueOrThrow.mockResolvedValue({ ...defaultScript, verificationAttempts: 0 });
    });

    it('saves attempt count and feedback on failure', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaScriptUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { podcastId: 'podcast-001' },
          data: expect.objectContaining({
            verificationAttempts: 1,
            verificationFeedback: failedVerdict.feedback,
          }),
        })
      );
    });

    it('deletes old references before regenerating', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaReferenceDeleteMany).toHaveBeenCalledWith({ where: { podcastId: 'podcast-001' } });
    });

    it('calls generateScriptWithFeedback with the verdict feedback', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockGenerateScriptWithFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'Quantum Computing',
          verificationFeedback: failedVerdict.feedback,
          previousScript: defaultScript.turns,
        })
      );
    });

    it('saves revised script with version increment', async () => {
      mockGenerateScriptWithFeedback.mockResolvedValue({
        ...revisedScriptResult,
        turns: [{ speaker: 'HOST', text: 'Revised.' }],
      });

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaScriptUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { podcastId: 'podcast-001' },
          data: expect.objectContaining({
            turns: [{ speaker: 'HOST', text: 'Revised.' }],
            version: { increment: 1 },
          }),
        })
      );
    });

    it('persists new references from revised script', async () => {
      mockGenerateScriptWithFeedback.mockResolvedValue({
        ...revisedScriptResult,
        references: [
          { number: 1, title: 'New Paper', authors: ['Jones'], year: 2023, url: 'https://new.com', type: 'PAPER', publisher: null, doi: null },
        ],
      });

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaReferenceCreateMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ podcastId: 'podcast-001', number: 1, title: 'New Paper' }),
        ]),
      });
    });

    it('does not persist references when revised script has none', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaReferenceCreateMany).not.toHaveBeenCalled();
    });

    it('re-queues for another verification pass', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'script-verification' },
        'verify_script',
        { podcastId: 'podcast-001', userId: 'user-001', discoveryId: 'discovery-001' }
      );
    });

    it('does not mark podcast failed', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockMarkPodcastFailed).not.toHaveBeenCalled();
    });

    it('logs usage for both verification and regeneration', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'script_verification' })
      );
      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'script_generation' })
      );
    });
  });

  describe('verification fail — max attempts reached (attempt 3)', () => {
    beforeEach(() => {
      mockVerifyScript.mockResolvedValue(failedVerdict);
      mockPrismaScriptFindUniqueOrThrow.mockResolvedValue({ ...defaultScript, verificationAttempts: 2 });
    });

    it('marks podcast failed after 3 attempts', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockMarkPodcastFailed).toHaveBeenCalledWith('podcast-001');
    });

    it('saves final attempt count and feedback', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaScriptUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        data: {
          verificationAttempts: 3,
          verificationFeedback: failedVerdict.feedback,
        },
      });
    });

    it('sends failure notification to user', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notifications' },
        'send_notification',
        expect.objectContaining({ userId: 'user-001', type: 'PODCAST_READY' })
      );
    });

    it('does not regenerate script on max failure', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockGenerateScriptWithFeedback).not.toHaveBeenCalled();
    });

    it('does not re-queue for verification', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      const verifyCalls = mockAddJob.mock.calls.filter(
        (c: unknown[]) => c[1] === 'verify_script'
      );
      expect(verifyCalls).toHaveLength(0);
    });
  });

  describe('usage logging', () => {
    it('logs verification usage with token counts on pass', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'anthropic',
          category: 'script_verification',
          inputTokens: passedVerdict.inputTokens,
          outputTokens: passedVerdict.outputTokens,
          podcastId: 'podcast-001',
          userId: 'user-001',
        })
      );
    });

    it('logs only verification usage (not generation) on pass', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockLogUsage).toHaveBeenCalledTimes(1);
    });
  });

  describe('progress tracking', () => {
    it('reports monotonically increasing progress ending at 100', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      const calls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as number
      );
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]);
      }
      expect(calls[calls.length - 1]).toBe(100);
    });

    it('reports progress ending at 100 even through the revision loop', async () => {
      mockVerifyScript.mockResolvedValue(failedVerdict);
      mockPrismaScriptFindUniqueOrThrow.mockResolvedValue({ ...defaultScript, verificationAttempts: 0 });

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      const calls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as number
      );
      expect(calls[calls.length - 1]).toBe(100);
    });
  });

  describe('error propagation', () => {
    it('propagates errors from verifyScript', async () => {
      mockVerifyScript.mockRejectedValue(new Error('Claude API unavailable'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptVerification(job)).rejects.toThrow('Claude API unavailable');
    });

    it('propagates errors from script database fetch', async () => {
      mockPrismaScriptFindUniqueOrThrow.mockRejectedValue(new Error('Script not found'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptVerification(job)).rejects.toThrow('Script not found');
    });

    it('propagates errors from discovery database fetch', async () => {
      mockPrismaDiscoveryFindUniqueOrThrow.mockRejectedValue(new Error('Discovery not found'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptVerification(job)).rejects.toThrow('Discovery not found');
    });

    it('propagates errors from generateScriptWithFeedback during revision', async () => {
      mockVerifyScript.mockResolvedValue(failedVerdict);
      mockGenerateScriptWithFeedback.mockRejectedValue(new Error('Rate limit exceeded'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptVerification(job)).rejects.toThrow('Rate limit exceeded');
    });

    it('propagates errors from podcast update', async () => {
      mockPrismaPodcastUpdate.mockRejectedValue(new Error('Database write failed'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptVerification(job)).rejects.toThrow('Database write failed');
    });
  });
});
