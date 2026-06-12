import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaScriptFindUniqueOrThrow = vi.fn();
const mockPrismaScriptUpdate = vi.fn().mockResolvedValue({});
const mockPrismaDiscoveryFindUniqueOrThrow = vi.fn();
const mockPrismaReferenceFindMany = vi.fn();
const mockPrismaReferenceDeleteMany = vi.fn().mockResolvedValue({});
const mockPrismaReferenceCreateMany = vi.fn().mockResolvedValue({});
const mockPrismaEpisodeFindUniqueOrThrow = vi.fn();
const mockPrismaEpisodeUpdate = vi.fn().mockResolvedValue({});
const mockPrismaPipelineEventCreate = vi.fn().mockResolvedValue({});

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
      findUniqueOrThrow: vi.fn().mockResolvedValue({}),
    },
    episode: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaEpisodeFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockPrismaEpisodeUpdate(...args),
    },
    pipelineEvent: {
      create: (...args: unknown[]) => mockPrismaPipelineEventCreate(...args),
    },
    vocabularyEntry: {
      deleteMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    briefingLog: {
      findFirst: vi.fn().mockResolvedValue(null),
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

const mockMarkEpisodeFailed = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/pipeline-resume', () => ({
  markEpisodeFailed: (...args: unknown[]) => mockMarkEpisodeFailed(...args),
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

const mockGetAiKey = vi.fn().mockResolvedValue({ apiKey: 'anthropic-key', provider: 'anthropic' });
const mockHasByokKey = vi.fn().mockResolvedValue(false);
const mockGetByokKey = vi.fn().mockResolvedValue(null);

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
  hasByokKey: (...args: unknown[]) => mockHasByokKey(...args),
  getByokKey: (...args: unknown[]) => mockGetByokKey(...args),
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

const mockResolveAiModelAndProvider = vi.fn().mockResolvedValue({ model: 'claude-sonnet-4-6', provider: 'anthropic' });

vi.mock('@/lib/providers/ai-registry', () => ({
  resolveAiModelAndProvider: (...args: unknown[]) => mockResolveAiModelAndProvider(...args),
  getCheapestModelForProvider: vi.fn().mockReturnValue('claude-haiku-4-5-20251001'),
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
  }),
}));

vi.mock('@/lib/voice-assigner', () => ({
  assignVoicesForEpisode: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tts-tag-converter', () => ({
  convertTurnsForProvider: vi.fn().mockImplementation((turns: unknown[]) => Promise.resolve(turns)),
}));

vi.mock('@/lib/pipeline-events', () => ({
  logPipelineStageComplete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/redis', () => ({
  invalidateEpisodeCache: vi.fn().mockResolvedValue(undefined),
  publishEpisodeStatus: vi.fn().mockResolvedValue(undefined),
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
  episodeId: 'episode-001',
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
  unsupportedClaims: [
    { claimText: 'claim-a', turnIndex: 1, speaker: 'HOST', existingCitations: [], isCommonKnowledge: false, needsMoreCitations: true, hasUnreliableSource: false, hasMisattribution: false, verificationNote: '' },
    { claimText: 'claim-b', turnIndex: 2, speaker: 'EXPERT', existingCitations: [], isCommonKnowledge: false, needsMoreCitations: true, hasUnreliableSource: false, hasMisattribution: false, verificationNote: '' },
  ],
};

const parseErrorVerdict = {
  ...passedVerdict,
  passed: false,
  score: 0,
  feedback: 'PARSE_ERROR: Script verification failed: could not parse AI response. Will retry.',
  failureType: 'parse_error' as const,
  totalClaims: 0,
  unsupportedClaims: [],
  unreliableSourceClaims: [],
  allClaims: [],
};

const revisedScriptResult = {
  turns: [{ speaker: 'HOST', text: 'Revised welcome.' }, { speaker: 'EXPERT', text: 'Revised expert turn.' }],
  references: [],
  vocabulary: [],
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
    mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({ aiModel: null, source: 'WEB' });
    mockGetAiKey.mockResolvedValue({ apiKey: 'anthropic-key', provider: 'anthropic' });
    mockHasByokKey.mockResolvedValue(false);
    mockGetByokKey.mockResolvedValue(null);
    mockResolveAiModelAndProvider.mockResolvedValue({ model: 'claude-sonnet-4-6', provider: 'anthropic' });
    mockVerifyScript.mockResolvedValue(passedVerdict);
    mockGenerateScriptWithFeedback.mockResolvedValue(revisedScriptResult);
  });

  describe('model resolution', () => {
    it('uses the resolved model for verification', async () => {
      mockResolveAiModelAndProvider.mockResolvedValueOnce({ model: 'claude-opus-4-6-20251101', provider: 'anthropic' });

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockVerifyScript).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-opus-4-6-20251101' })
      );
    });

    it('passes explicit episodeAiModel to resolveAiModelAndProvider', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({ aiModel: 'claude-haiku-4-5-20251001', source: 'WEB' });

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith(
        expect.objectContaining({ episodeAiModel: 'claude-haiku-4-5-20251001' })
      );
    });
  });

  describe('AI routing', () => {
    it('uses the configured BYOK provider when the episode has no model', async () => {
      const aiKey = { apiKey: 'anthropic-key', provider: 'anthropic' };
      mockGetAiKey.mockResolvedValue(aiKey);

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockGetAiKey).toHaveBeenCalledTimes(1);
      expect(mockGetAiKey).toHaveBeenCalledWith('user-001');
      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: null,
        aiKey,
      });
      expect(mockVerifyScript).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: 'anthropic-key',
          model: 'claude-sonnet-4-6',
        })
      );
    });

    it('uses the explicit episode model owner and matching provider key', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        aiModel: 'gpt-5-mini',
        verificationMode: 'standard',
        language: null,
        source: 'WEB',
        zeroCostVideo: false,
      });
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'gpt-5-mini',
        provider: 'openai',
      });
      mockGetAiKey.mockResolvedValue({ apiKey: 'openai-key', provider: 'openai' });

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: 'gpt-5-mini',
        aiKey: null,
      });
      expect(mockGetAiKey).toHaveBeenCalledTimes(1);
      expect(mockGetAiKey).toHaveBeenCalledWith('user-001', 'openai');
      expect(mockVerifyScript).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: 'openai-key',
          model: 'gpt-5-mini',
        })
      );
    });

    it('rejects explicit non-local models without a matching provider key', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        aiModel: 'gpt-5-mini',
        verificationMode: 'standard',
        language: null,
        source: 'WEB',
        zeroCostVideo: false,
      });
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'gpt-5-mini',
        provider: 'openai',
      });
      mockGetAiKey.mockResolvedValue(null);

      const job = createMockJob(defaultPayload);
      await expect(processScriptVerification(job)).rejects.toThrow(
        'AI key for provider "openai" is required for script verification.'
      );
      expect(mockVerifyScript).not.toHaveBeenCalled();
    });

    it('rejects missing model and missing BYOK key before verification', async () => {
      mockGetAiKey.mockResolvedValue(null);

      const job = createMockJob(defaultPayload);
      await expect(processScriptVerification(job)).rejects.toThrow(
        'AI model is required for script verification when no AI key is configured.'
      );
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockVerifyScript).not.toHaveBeenCalled();
    });

    it('uses platform credentials only for explicit admin-credit routes', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        aiModel: 'gpt-5-mini',
        verificationMode: 'standard',
        language: null,
        source: 'WEB',
        zeroCostVideo: false,
      });
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'gpt-5-mini',
        provider: 'openai',
      });

      const job = createMockJob({ ...defaultPayload, useAdminCredits: true });
      await processScriptVerification(job);

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        episodeAiModel: 'gpt-5-mini',
        aiKey: null,
      });
      expect(mockVerifyScript).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: undefined,
          model: 'gpt-5-mini',
        })
      );
    });

    it('rejects admin-credit routes without an explicit model', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        aiModel: null,
        verificationMode: 'standard',
        language: null,
        source: 'WEB',
        zeroCostVideo: false,
      });

      const job = createMockJob({ ...defaultPayload, useAdminCredits: true });
      await expect(processScriptVerification(job)).rejects.toThrow(
        'AI model is required for script verification when no AI key is configured.'
      );
      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockVerifyScript).not.toHaveBeenCalled();
    });

    it('allows local claude-code models without provider keys', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        aiModel: 'claude-code:sonnet',
        verificationMode: 'standard',
        language: null,
        source: 'WEB',
        zeroCostVideo: false,
      });
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'claude-code:sonnet',
        provider: 'claude-code',
      });
      mockGetAiKey.mockResolvedValue(null);

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockVerifyScript).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: undefined,
          model: 'claude-code:sonnet',
        })
      );
    });

    it('skips AI routing for zero-cost verification skips', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        aiModel: null,
        verificationMode: 'standard',
        language: null,
        source: 'WEB',
        zeroCostVideo: true,
      });
      mockGetAiKey.mockResolvedValue(null);

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockVerifyScript).not.toHaveBeenCalled();
      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalledWith('episode-001', defaultScript.turns);
    });
  });

  describe('model used for verification and regeneration', () => {
    it('uses same resolved model for both verifyScript and regeneration', async () => {
      // First call fails verification, triggering regeneration
      mockVerifyScript.mockResolvedValue(failedVerdict);
      mockPrismaScriptFindUniqueOrThrow.mockResolvedValue({ ...defaultScript, verificationAttempts: 0 });

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      // Both verifyScript and generateScriptWithFeedback use the resolved model
      expect(mockVerifyScript).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6' })
      );

      expect(mockGenerateScriptWithFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6' })
      );
    });
  });

  describe('verification pass — with references', () => {
    it('routes to compile when references exist', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
        data: { status: 'COMPILING' },
      });
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'reference-validation' },
        'validate_references',
        { episodeId: 'episode-001', userId: 'user-001', useAdminCredits: undefined },
        { jobId: expect.stringMatching(/^validate-episode-001-/) }
      );
    });

    it('increments verificationAttempts on pass', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaScriptUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { episodeId: 'episode-001' },
          data: expect.objectContaining({ verificationAttempts: 1 }),
        })
      );
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

  describe('verification pass — showcase mode skips reference validation', () => {
    beforeEach(() => {
      mockPrismaEpisodeFindUniqueOrThrow
        .mockResolvedValueOnce({ aiModel: null, verificationMode: 'showcase' })
        .mockResolvedValueOnce({ source: 'WEB' });
    });

    it('skips reference validation and pauses at SCRIPT_READY', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockAddJob).not.toHaveBeenCalledWith(
        { name: 'reference-validation' },
        'validate_references',
        expect.anything(),
        expect.anything()
      );
      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
        data: { status: 'SCRIPT_READY' },
      });
    });

    it('sends SCRIPT_READY notification even with references present', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notifications' },
        'send_notification',
        expect.objectContaining({ type: 'SCRIPT_READY' })
      );
    });
  });

  describe('verification pass — with duration adjustment', () => {
    const durationVerdict = {
      ...passedVerdict,
      durationFeedback: 'The script is 2000 words, which exceeds the maximum of 1575 words for a 10-minute episode. Reduce to 1425–1575 words (1500 ideal).',
    };

    beforeEach(() => {
      mockVerifyScript.mockResolvedValue(durationVerdict);
    });

    it('calls generateScriptWithFeedback with duration feedback', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockGenerateScriptWithFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          verificationFeedback: `DURATION: ${durationVerdict.durationFeedback}`,
          previousScript: defaultScript.turns,
        })
      );
    });

    it('saves adjusted script with version increment', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaScriptUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            turns: revisedScriptResult.turns,
            version: { increment: 1 },
          }),
        })
      );
    });

    it('still routes to compile after adjustment', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
        data: { status: 'COMPILING' },
      });
    });

    it('logs usage for both verification and duration adjustment', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'script_verification' })
      );
      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'script_generation' })
      );
    });

    it('does not count as a verification failure', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockMarkEpisodeFailed).not.toHaveBeenCalled();
    });

    it('skips adjustment when durationFeedback is null', async () => {
      mockVerifyScript.mockResolvedValue(passedVerdict);
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockGenerateScriptWithFeedback).not.toHaveBeenCalled();
    });
  });

  describe('verification pass — no references, WEB source', () => {
    beforeEach(() => {
      mockPrismaReferenceFindMany.mockResolvedValue([]);
      mockPrismaEpisodeFindUniqueOrThrow
        .mockResolvedValueOnce({ aiModel: null })
        .mockResolvedValueOnce({ source: 'WEB' });
    });

    it('pauses at SCRIPT_READY', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
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
      mockPrismaEpisodeFindUniqueOrThrow
        .mockResolvedValueOnce({ aiModel: null })
        .mockResolvedValueOnce({ source: 'IMPORT' });
    });

    it('pauses at SCRIPT_READY for IMPORT source', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
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
      mockPrismaEpisodeFindUniqueOrThrow
        .mockResolvedValueOnce({ aiModel: null })
        .mockResolvedValueOnce({ source: 'TWITTER' });
    });

    it('auto-approves and creates segments', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalledWith(
        'episode-001',
        defaultScript.turns
      );
    });

    it('sets status to GENERATING_AUDIO', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
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
      mockPrismaEpisodeFindUniqueOrThrow
        .mockResolvedValueOnce({ aiModel: null })
        .mockResolvedValueOnce({ source: 'API' });
    });

    it('auto-approves for API source', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalled();
      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'GENERATING_AUDIO' } })
      );
    });
  });

  describe('verification fail — revision loop (attempt < 4)', () => {
    beforeEach(() => {
      mockVerifyScript.mockResolvedValue(failedVerdict);
      mockPrismaScriptFindUniqueOrThrow.mockResolvedValue({ ...defaultScript, verificationAttempts: 0 });
    });

    it('saves attempt count and feedback on failure', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaScriptUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { episodeId: 'episode-001' },
          data: expect.objectContaining({
            verificationAttempts: 1,
            verificationFeedback: failedVerdict.feedback,
          }),
        })
      );
    });

    it('keeps old references when revision produces none', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaReferenceDeleteMany).not.toHaveBeenCalled();
    });

    it('replaces references when revision produces new ones', async () => {
      mockGenerateScriptWithFeedback.mockResolvedValue({
        ...revisedScriptResult,
        references: [
          { number: 1, title: 'Replacement Paper', authors: ['Smith'], year: 2024, url: 'https://new.com', type: 'PAPER', publisher: null, doi: null },
        ],
      });

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaReferenceDeleteMany).toHaveBeenCalledWith({ where: { episodeId: 'episode-001' } });
      expect(mockPrismaReferenceCreateMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ episodeId: 'episode-001', number: 1, title: 'Replacement Paper' }),
        ]),
      });
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
          where: { episodeId: 'episode-001' },
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
          expect.objectContaining({ episodeId: 'episode-001', number: 1, title: 'New Paper' }),
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
        { episodeId: 'episode-001', userId: 'user-001', discoveryId: 'discovery-001', useAdminCredits: undefined },
        { jobId: expect.stringMatching(/^verify-episode-001-2-\d+$/) }
      );
    });

    it('does not mark episode failed', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockMarkEpisodeFailed).not.toHaveBeenCalled();
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

  describe('verification fail — max attempts reached (attempt 4)', () => {
    beforeEach(() => {
      mockVerifyScript.mockResolvedValue(failedVerdict);
      mockPrismaScriptFindUniqueOrThrow.mockResolvedValue({ ...defaultScript, verificationAttempts: 3 });
    });

    it('marks episode failed after 4 attempts', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockMarkEpisodeFailed).toHaveBeenCalledWith('episode-001', {
        failureReason: "Our fact-checker found issues that couldn't be resolved after 3 attempts. Please try again with a different topic or approach.",
        technicalError: expect.stringContaining('Verification failed 4/4'),
      });
    });

    it('saves final attempt count and feedback', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaScriptUpdate).toHaveBeenCalledWith({
        where: { episodeId: 'episode-001' },
        data: {
          verificationAttempts: 4,
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
        expect.objectContaining({ userId: 'user-001', type: 'EPISODE_FAILED' })
      );
    });

    it('writes PipelineEvent with error details', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockPrismaPipelineEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          episodeId: 'episode-001',
          stage: 'script-verification',
          type: 'error',
          message: expect.stringContaining('Verification failed after 4 attempts'),
          metadata: expect.objectContaining({
            attemptNumber: 4,
            score: failedVerdict.score,
          }),
        }),
      });
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
          episodeId: 'episode-001',
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

    it('propagates errors from episode update', async () => {
      mockPrismaEpisodeUpdate.mockRejectedValue(new Error('Database write failed'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptVerification(job)).rejects.toThrow('Database write failed');
    });
  });

  describe('parse error handling', () => {
    it('retries without incrementing attempts on first parse error', async () => {
      mockVerifyScript.mockResolvedValue(parseErrorVerdict);
      mockPrismaScriptFindUniqueOrThrow.mockResolvedValue({
        ...defaultScript,
        verificationAttempts: 0,
        verificationFeedback: null,
      });

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      // Should NOT increment verificationAttempts — only save feedback
      expect(mockPrismaScriptUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { episodeId: 'episode-001' },
          data: { verificationFeedback: parseErrorVerdict.feedback },
        })
      );

      // Should re-queue for verification (parse retry)
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'script-verification' },
        'verify_script',
        { episodeId: 'episode-001', userId: 'user-001', discoveryId: 'discovery-001', useAdminCredits: undefined },
        { jobId: expect.stringMatching(/parse-retry-\d+$/) }
      );

      // Should NOT regenerate the script
      expect(mockGenerateScriptWithFeedback).not.toHaveBeenCalled();
    });

    it('falls through to failure on consecutive parse errors', async () => {
      mockVerifyScript.mockResolvedValue(parseErrorVerdict);
      mockPrismaScriptFindUniqueOrThrow.mockResolvedValue({
        ...defaultScript,
        verificationAttempts: 0,
        verificationFeedback: 'PARSE_ERROR: previous parse failure',
      });

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      // Consecutive parse error → falls through to revision loop (not parse retry)
      // The script should be regenerated since attemptNumber (1) < MAX_VERIFICATION_ATTEMPTS (4)
      expect(mockGenerateScriptWithFeedback).toHaveBeenCalled();
    });

    it('uses processing issue message when max attempts exhausted by parse errors', async () => {
      mockVerifyScript.mockResolvedValue(parseErrorVerdict);
      mockPrismaScriptFindUniqueOrThrow.mockResolvedValue({
        ...defaultScript,
        verificationAttempts: 3,
        verificationFeedback: 'PARSE_ERROR: previous parse failure',
      });

      const job = createMockJob(defaultPayload);
      await processScriptVerification(job);

      expect(mockMarkEpisodeFailed).toHaveBeenCalledWith('episode-001', {
        failureReason: 'We encountered a temporary processing issue while fact-checking your episode. Please try generating again.',
        technicalError: expect.stringContaining('Verification failed 4/4'),
      });

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notifications' },
        'send_notification',
        expect.objectContaining({
          message: 'We encountered a temporary processing issue while fact-checking your episode. Please try generating again.',
        })
      );
    });
  });
});
