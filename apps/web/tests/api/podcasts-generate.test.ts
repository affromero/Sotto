import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuthenticateRequest = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

const mockPrismaPodcastFindUnique = vi.fn();
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});
const mockPrismaPodcastUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockPrismaJobUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaPodcastVersionSegmentDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaPodcastVersionDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaSegmentDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaSegmentFindMany = vi.fn().mockResolvedValue([]);
const mockPrismaScriptDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaReferenceDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaDiscoveryFindUniqueOrThrow = vi.fn().mockResolvedValue({
  id: 'discovery-001',
  sourceContent: null,
});

const mockPrismaPodcastVoiceDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPrismaPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
      updateMany: (...args: unknown[]) => mockPrismaPodcastUpdateMany(...args),
    },
    job: {
      updateMany: (...args: unknown[]) => mockPrismaJobUpdateMany(...args),
    },
    podcastVersionSegment: {
      deleteMany: (...args: unknown[]) => mockPrismaPodcastVersionSegmentDeleteMany(...args),
    },
    podcastVersion: {
      deleteMany: (...args: unknown[]) => mockPrismaPodcastVersionDeleteMany(...args),
    },
    segment: {
      deleteMany: (...args: unknown[]) => mockPrismaSegmentDeleteMany(...args),
      findMany: (...args: unknown[]) => mockPrismaSegmentFindMany(...args),
    },
    script: {
      deleteMany: (...args: unknown[]) => mockPrismaScriptDeleteMany(...args),
    },
    reference: {
      deleteMany: (...args: unknown[]) => mockPrismaReferenceDeleteMany(...args),
    },
    discovery: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaDiscoveryFindUniqueOrThrow(...args),
    },
    podcastVoice: {
      deleteMany: (...args: unknown[]) => mockPrismaPodcastVoiceDeleteMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockAddJob = vi.fn();

vi.mock('@/lib/queue', () => ({
  contentExtractionQueue: { name: 'content-extraction' },
  scriptGenerationQueue: { name: 'script-generation' },
  scriptVerificationQueue: { name: 'script-verification' },
  referenceValidationQueue: { name: 'reference-validation' },
  audioGenerationQueue: { name: 'audio-generation' },
  audioStitchingQueue: { name: 'audio-stitching' },
  audioImportQueue: { name: 'audio-import' },
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    EXTRACT_CONTENT: 'extract_content',
    GENERATE_SCRIPT: 'generate_script',
    VERIFY_SCRIPT: 'verify_script',
    VALIDATE_REFERENCES: 'validate_references',
    GENERATE_AUDIO: 'generate_audio',
    STITCH_AUDIO: 'stitch_audio',
    IMPORT_AUDIO: 'import_audio',
  },
}));

const mockDetermineResumePoint = vi.fn();

vi.mock('@/lib/pipeline-resume', () => ({
  determineResumePoint: (...args: unknown[]) => mockDetermineResumePoint(...args),
}));

const mockCheckGenerationGate = vi
  .fn()
  .mockResolvedValue({ allowed: true, reason: 'ok', isByokUser: true });
const mockGetAutoModelConfig = vi.fn().mockResolvedValue({
  free: {
    aiProvider: 'anthropic',
    aiModel: 'claude-haiku-4-5-20251001',
    ttsProvider: 'openai',
    ttsModel: 'tts-1-hd',
    sttProvider: 'openai',
    sttModel: 'whisper-1',
  },
  dailyGenerationLimit: 3,
  dailyGenerationLimitPro: 5,
  dailyVideoLimit: 1,
  dailyVideoLimitPro: 2,
  dailyAvatarLimit: 1,
  dailyAvatarLimitPro: 1,
  ttsAllocations: [],
  aiAllocations: [],
});

vi.mock('@/lib/generation-gate', () => ({
  checkGenerationGate: (...args: unknown[]) => mockCheckGenerationGate(...args),
}));

vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: (...args: unknown[]) => mockGetAutoModelConfig(...args),
}));

const mockSelectFreeTierProviders = vi.fn().mockResolvedValue({
  aiProvider: 'anthropic',
  aiModel: 'claude-haiku-4-5-20251001',
  aiQuota: 10,
  ttsProvider: 'elevenlabs',
  ttsModel: 'eleven_multilingual_v2',
  ttsQuota: 10,
});

vi.mock('@/lib/free-tier-provider-selector', () => ({
  selectFreeTierProviders: (...args: unknown[]) => mockSelectFreeTierProviders(...args),
}));

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 19, resetAt: 0 });

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock('@/lib/stripe', () => ({
  LIMITS: { maxDurationMinutes: 30 },
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: vi.fn().mockResolvedValue(null),
  getByokKey: vi.fn().mockResolvedValue(null),
  hasByokKey: vi.fn().mockResolvedValue(true),
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

const mockRequireAdmin = vi.fn();

vi.mock('@/lib/auth-guards', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

// ---- Import under test ----
import { POST } from '@/app/api/podcasts/[podcastId]/generate/route';

// ---- Helpers ----

function createMockRequest(
  searchParams?: Record<string, string>,
  body?: Record<string, unknown>
): NextRequest {
  const url = new URL('http://localhost/api/podcasts/p/generate');
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      url.searchParams.set(k, v);
    }
  }
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-api-key',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function createMockParams(podcastId: string) {
  return { params: Promise.resolve({ podcastId }) };
}

// ---- Tests ----

describe('POST /api/podcasts/[podcastId]/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(null); // non-admin by default
    mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', isByokUser: true });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 19, resetAt: 0 });
    mockPrismaPodcastUpdate.mockResolvedValue({});
    mockPrismaPodcastUpdateMany.mockResolvedValue({ count: 1 });
    mockAddJob.mockResolvedValue({ id: 'job-1' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 for unauthenticated request', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('podcast-001');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast does not exist', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaPodcastFindUnique.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('podcast-nonexistent');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toMatchObject({ error: 'Podcast not found' });
  });

  it('returns 403 when user does not own podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-002',
      userId: 'user-different',
      status: 'PENDING',
      discovery: null,
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-002');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 400 when podcast is in READY status', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-003',
      userId: 'user-001',
      status: 'READY',
      discovery: null,
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-003');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toMatchObject({
      error: 'Podcast must be in PENDING, DISCOVERING, or FAILED status to generate',
    });
  });

  it('returns 403 when TTS provider not configured', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockCheckGenerationGate.mockResolvedValue({
      allowed: false,
      reason: 'no_provider',
      isByokUser: false,
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-noai');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('No voice provider available');
  });

  it('returns 429 when rate limited', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 3600000,
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-rl');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error).toContain('Rate limit exceeded');
  });

  it('successfully starts generation for PENDING podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-007',
      userId: 'user-001',
      status: 'PENDING',
      discovery: {
        id: 'disc-007',
        sourceUrl: 'https://example.com/article',
        sourceContent: null,
        durationTarget: null,
      },
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-007');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, message: 'Generation started' });
  });

  describe('import retry STT routing', () => {
    it('rejects import restart when no STT provider is persisted', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaPodcastFindUnique.mockResolvedValue({
        id: 'podcast-import',
        userId: 'user-001',
        status: 'PENDING',
        source: 'IMPORT',
        importedAudioKey: 'imports/podcast-import/original.mp3',
        sttProvider: null,
        sttModel: null,
        isHumanContent: false,
        title: 'Imported podcast',
        discovery: null,
      });

      const request = createMockRequest();
      const params = await createMockParams('podcast-import');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toMatchObject({ code: 'stt_provider_required' });
      expect(mockAddJob).not.toHaveBeenCalled();
    });

    it('queues import restart with the stored STT provider and model', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'sk-platform');
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaPodcastFindUnique.mockResolvedValue({
        id: 'podcast-import',
        userId: 'user-001',
        status: 'PENDING',
        source: 'IMPORT',
        importedAudioKey: 'imports/podcast-import/original.mp3',
        sttProvider: 'openai',
        sttModel: 'whisper-1',
        isHumanContent: false,
        title: 'Imported podcast',
        discovery: null,
      });

      const request = createMockRequest();
      const params = await createMockParams('podcast-import');
      const response = await POST(request, params);

      expect(response.status).toBe(200);
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'audio-import' },
        'import_audio',
        expect.objectContaining({
          podcastId: 'podcast-import',
          userId: 'user-001',
          sttProvider: 'openai',
          sttModel: 'whisper-1',
          sttApiKey: 'sk-platform',
        }),
        expect.objectContaining({ jobId: expect.stringMatching(/^import-podcast-import-\d+$/) })
      );
    });
  });

  it('returns 400 when duration exceeds limit', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaPodcastFindUnique.mockResolvedValue({
      id: 'podcast-dur',
      userId: 'user-001',
      status: 'PENDING',
      discovery: {
        id: 'disc-dur',
        sourceUrl: null,
        sourceContent: null,
        durationTarget: 60,
      },
    });

    const request = createMockRequest();
    const params = await createMockParams('podcast-dur');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('exceeds the maximum');
  });

  describe('smart resume for FAILED podcasts', () => {
    it('uses determineResumePoint to resume from EXTRACT_CONTENT', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaPodcastFindUnique.mockResolvedValue({
        id: 'podcast-f1',
        userId: 'user-001',
        status: 'FAILED',
        source: 'WEB',
        discovery: {
          id: 'disc-f1',
          sourceUrl: 'https://example.com',
          sourceContent: null,
          durationTarget: null,
        },
      });
      mockDetermineResumePoint.mockResolvedValue({ step: 'EXTRACT_CONTENT' });

      const request = createMockRequest();
      const params = await createMockParams('podcast-f1');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.resumedAt).toBe('EXTRACT_CONTENT');
    });

    it('uses determineResumePoint to resume from GENERATE_AUDIO with pending segments', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaPodcastFindUnique.mockResolvedValue({
        id: 'podcast-f2',
        userId: 'user-001',
        status: 'FAILED',
        source: 'WEB',
        discovery: { id: 'disc-f2', sourceUrl: null, sourceContent: null, durationTarget: null },
      });
      mockDetermineResumePoint.mockResolvedValue({
        step: 'GENERATE_AUDIO',
        pendingSegmentIds: ['seg-3', 'seg-5'],
      });
      mockPrismaSegmentFindMany.mockResolvedValue([
        { id: 'seg-3', speaker: 'HOST', text: 'Hello' },
        { id: 'seg-5', speaker: 'EXPERT', text: 'Hi' },
      ]);

      const request = createMockRequest();
      const params = await createMockParams('podcast-f2');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.resumedAt).toBe('GENERATE_AUDIO');
      expect(data.pendingSegments).toBe(2);
    });

    it('uses determineResumePoint to resume from STITCH_AUDIO', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaPodcastFindUnique.mockResolvedValue({
        id: 'podcast-f3',
        userId: 'user-001',
        status: 'FAILED',
        source: 'WEB',
        discovery: { id: 'disc-f3', sourceUrl: null, sourceContent: null, durationTarget: null },
      });
      mockDetermineResumePoint.mockResolvedValue({
        step: 'STITCH_AUDIO',
        segmentIds: ['seg-1', 'seg-2', 'seg-3'],
      });

      const request = createMockRequest();
      const params = await createMockParams('podcast-f3');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.resumedAt).toBe('STITCH_AUDIO');
      expect(mockAddJob).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'audio-stitching' }),
        'stitch_audio',
        expect.objectContaining({ segmentIds: ['seg-1', 'seg-2', 'seg-3'] }),
        { jobId: expect.stringMatching(/^stitch-podcast-f3-\d+$/) }
      );
    });

    it('uses determineResumePoint to resume from SCRIPT_READY', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaPodcastFindUnique.mockResolvedValue({
        id: 'podcast-f4',
        userId: 'user-001',
        status: 'FAILED',
        source: 'WEB',
        discovery: { id: 'disc-f4', sourceUrl: null, sourceContent: null, durationTarget: null },
      });
      mockDetermineResumePoint.mockResolvedValue({ step: 'SCRIPT_READY' });

      const request = createMockRequest();
      const params = await createMockParams('podcast-f4');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.resumedAt).toBe('SCRIPT_READY');
      // No job queued — user must approve script
      expect(mockAddJob).not.toHaveBeenCalled();
    });

    it('nukes everything and restarts when forceRestart=true', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaPodcastFindUnique.mockResolvedValue({
        id: 'podcast-fr',
        userId: 'user-001',
        status: 'FAILED',
        source: 'WEB',
        discovery: {
          id: 'disc-fr',
          sourceUrl: 'https://example.com',
          sourceContent: null,
          durationTarget: null,
        },
      });

      const request = createMockRequest({ forceRestart: 'true' });
      const params = await createMockParams('podcast-fr');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Generation started');
    });
  });

  describe('FAILED retry provider override', () => {
    const failedPodcast = {
      id: 'podcast-fail',
      userId: 'user-001',
      status: 'FAILED',
      source: 'WEB',
      discovery: { id: 'disc-fail', sourceUrl: null, sourceContent: null, durationTarget: null },
    };

    beforeEach(() => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaPodcastFindUnique.mockResolvedValue(failedPodcast);
      mockDetermineResumePoint.mockResolvedValue({
        step: 'GENERATE_AUDIO',
        pendingSegmentIds: ['seg-1'],
      });
      mockPrismaSegmentFindMany.mockResolvedValue([
        { id: 'seg-1', speaker: 'HOST', text: 'Hello' },
      ]);
    });

    it('writes provider override and deletes old voices when body has ttsProvider', async () => {
      const request = createMockRequest(undefined, { ttsProvider: 'openai', ttsModel: 'tts-1-hd' });
      const params = await createMockParams('podcast-fail');
      const response = await POST(request, params);

      expect(response.status).toBe(200);
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'podcast-fail' },
          data: { ttsProvider: 'openai', ttsModel: 'tts-1-hd' },
        })
      );
      expect(mockPrismaPodcastVoiceDeleteMany).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-fail' },
      });
    });

    it('preserves ttsProvider when no body is provided (bare retry)', async () => {
      const request = createMockRequest();
      const params = await createMockParams('podcast-fail');
      const response = await POST(request, params);

      expect(response.status).toBe(200);
      // Bare retry should NOT clear ttsProvider — keeps same voices on retry.
      // The queue failure handler clears ttsProvider for key invalidation errors.
      const updateCalls = mockPrismaPodcastUpdate.mock.calls.map(
        (c: unknown[]) => c[0] as { where?: { id?: string }; data?: { ttsProvider?: unknown } }
      );
      const providerClearCall = updateCalls.find(
        (c) => c.data?.ttsProvider === null && c.where?.id === 'podcast-fail'
      );
      expect(providerClearCall).toBeUndefined();
      expect(mockPrismaPodcastVoiceDeleteMany).not.toHaveBeenCalled();
    });

    it('clears ttsProvider/ttsModel and PodcastVoice on SCRIPT_READY resume', async () => {
      mockDetermineResumePoint.mockResolvedValue({ step: 'SCRIPT_READY' });

      const request = createMockRequest();
      const params = await createMockParams('podcast-fail');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.resumedAt).toBe('SCRIPT_READY');
      expect(mockPrismaPodcastUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'podcast-fail', status: 'FAILED' },
          data: expect.objectContaining({
            ttsProvider: null,
            ttsModel: null,
          }),
        })
      );
      // Stale voice assignments should be cleared on re-approval
      expect(mockPrismaPodcastVoiceDeleteMany).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-fail' },
      });
    });
  });

  describe('admin bypass', () => {
    it('admin can generate podcast owned by another user', async () => {
      mockRequireAdmin.mockResolvedValue('admin-user-id');
      mockAuthenticateRequest.mockResolvedValue({ userId: 'admin-user-id' });
      mockPrismaPodcastFindUnique.mockResolvedValue({
        id: 'podcast-other',
        userId: 'some-other-user',
        status: 'PENDING',
        discovery: { id: 'disc-other', sourceUrl: null, sourceContent: null, durationTarget: null },
      });

      const request = createMockRequest();
      const params = await createMockParams('podcast-other');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true, message: 'Generation started' });
    });

    it('admin skips rate limit', async () => {
      mockRequireAdmin.mockResolvedValue('admin-user-id');
      mockAuthenticateRequest.mockResolvedValue({ userId: 'admin-user-id' });
      mockCheckRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 3600000,
      });
      mockPrismaPodcastFindUnique.mockResolvedValue({
        id: 'podcast-rl-admin',
        userId: 'admin-user-id',
        status: 'PENDING',
        discovery: { id: 'disc-rl', sourceUrl: null, sourceContent: null, durationTarget: null },
      });

      const request = createMockRequest();
      const params = await createMockParams('podcast-rl-admin');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true, message: 'Generation started' });
      expect(mockCheckRateLimit).not.toHaveBeenCalled();
    });

    it('admin skips generation gate', async () => {
      mockRequireAdmin.mockResolvedValue('admin-user-id');
      mockAuthenticateRequest.mockResolvedValue({ userId: 'admin-user-id' });
      mockCheckGenerationGate.mockResolvedValue({
        allowed: false,
        reason: 'no_provider',
        isByokUser: false,
      });
      mockPrismaPodcastFindUnique.mockResolvedValue({
        id: 'podcast-gate-admin',
        userId: 'admin-user-id',
        status: 'PENDING',
        discovery: { id: 'disc-gate', sourceUrl: null, sourceContent: null, durationTarget: null },
      });

      const request = createMockRequest();
      const params = await createMockParams('podcast-gate-admin');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true, message: 'Generation started' });
      expect(mockCheckGenerationGate).not.toHaveBeenCalled();
    });
  });
});
