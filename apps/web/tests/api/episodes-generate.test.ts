import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuthenticateRequest = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

const mockPrismaEpisodeFindUnique = vi.fn();
const mockPrismaEpisodeUpdate = vi.fn().mockResolvedValue({});
const mockPrismaEpisodeUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockPrismaJobUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaEpisodeVersionSegmentDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaEpisodeVersionDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaSegmentDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaSegmentFindMany = vi.fn().mockResolvedValue([]);
const mockPrismaScriptDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaReferenceDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrismaDiscoveryFindUniqueOrThrow = vi.fn().mockResolvedValue({
  id: 'discovery-001',
  sourceContent: null,
});

const mockPrismaEpisodeVoiceDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    episode: {
      findUnique: (...args: unknown[]) => mockPrismaEpisodeFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaEpisodeUpdate(...args),
      updateMany: (...args: unknown[]) => mockPrismaEpisodeUpdateMany(...args),
    },
    job: {
      updateMany: (...args: unknown[]) => mockPrismaJobUpdateMany(...args),
    },
    episodeVersionSegment: {
      deleteMany: (...args: unknown[]) => mockPrismaEpisodeVersionSegmentDeleteMany(...args),
    },
    episodeVersion: {
      deleteMany: (...args: unknown[]) => mockPrismaEpisodeVersionDeleteMany(...args),
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
    episodeVoice: {
      deleteMany: (...args: unknown[]) => mockPrismaEpisodeVoiceDeleteMany(...args),
    },
    $transaction: vi.fn(),
  };
  _mockPrisma.$transaction.mockImplementation(
    async (operations: Array<Promise<unknown>> | ((tx: typeof _mockPrisma) => Promise<unknown>)) =>
      typeof operations === 'function' ? operations(_mockPrisma) : Promise.all(operations)
  );
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockAddJob = vi.fn();

vi.mock('@/lib/queue', () => ({
  contentExtractionQueue: { name: 'content-extraction' },
  scriptGenerationQueue: { name: 'script-generation' },
  audioGenerationQueue: { name: 'audio-generation' },
  audioStitchingQueue: { name: 'audio-stitching' },
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    EXTRACT_CONTENT: 'extract_content',
    GENERATE_SCRIPT: 'generate_script',
    GENERATE_AUDIO: 'generate_audio',
    STITCH_AUDIO: 'stitch_audio',
  },
}));

const mockDetermineResumePoint = vi.fn();

vi.mock('@/lib/pipeline-resume', () => ({
  determineResumePoint: (...args: unknown[]) => mockDetermineResumePoint(...args),
}));

const mockRestartExistingSegmentAudio = vi.fn().mockResolvedValue(2);

vi.mock('@/lib/segment-creator', () => ({
  restartExistingSegmentAudio: (...args: unknown[]) => mockRestartExistingSegmentAudio(...args),
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: vi.fn().mockResolvedValue(null),
  getByokKey: vi.fn().mockResolvedValue(null),
  hasByokKey: vi.fn().mockResolvedValue(true),
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
  }),
  getJobPriority: vi.fn().mockReturnValue(1),
}));

const mockIsUserAdmin = vi.fn();

vi.mock('@/lib/auth-guards', () => ({
  isUserAdmin: (...args: unknown[]) => mockIsUserAdmin(...args),
}));

// ---- Import under test ----
import { POST } from '@/app/api/v1/episodes/[episodeId]/generate/route';

// ---- Helpers ----

function createMockRequest(
  searchParams?: Record<string, string>,
  body?: Record<string, unknown>
): NextRequest {
  const url = new URL('http://localhost/api/v1/episodes/p/generate');
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

async function createMockParams(episodeId: string) {
  return { params: Promise.resolve({ episodeId }) };
}

// ---- Tests ----

describe('POST /api/v1/episodes/[episodeId]/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsUserAdmin.mockResolvedValue(false); // non-admin by default
    mockPrismaEpisodeUpdate.mockResolvedValue({});
    mockPrismaEpisodeUpdateMany.mockResolvedValue({ count: 1 });
    mockAddJob.mockResolvedValue({ id: 'job-1' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 for unauthenticated request', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('episode-001');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when episode does not exist', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaEpisodeFindUnique.mockResolvedValue(null);

    const request = createMockRequest();
    const params = await createMockParams('episode-nonexistent');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toMatchObject({ error: 'Episode not found' });
  });

  it('returns 403 when user does not own episode', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      id: 'episode-002',
      userId: 'user-different',
      status: 'PENDING',
      discovery: null,
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-002');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 400 when episode is in READY status', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      id: 'episode-003',
      userId: 'user-001',
      status: 'READY',
      discovery: null,
    });

    const request = createMockRequest();
    const params = await createMockParams('episode-003');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toMatchObject({
      error: 'Episode must be in PENDING, DISCOVERING, or FAILED status to generate',
    });
  });

  it('successfully starts generation for PENDING episode', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      id: 'episode-007',
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
    const params = await createMockParams('episode-007');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, message: 'Generation started' });
  });

  it('returns 400 when duration exceeds limit', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      id: 'episode-dur',
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
    const params = await createMockParams('episode-dur');
    const response = await POST(request, params);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('exceeds the maximum');
  });

  describe('smart resume for FAILED episodes', () => {
    it('uses determineResumePoint to resume from EXTRACT_CONTENT', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaEpisodeFindUnique.mockResolvedValue({
        id: 'episode-f1',
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
      const params = await createMockParams('episode-f1');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.resumedAt).toBe('EXTRACT_CONTENT');
    });

    it('restarts every segment as one coherent GENERATE_AUDIO attempt', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaEpisodeFindUnique.mockResolvedValue({
        id: 'episode-f2',
        userId: 'user-001',
        status: 'FAILED',
        source: 'WEB',
        discovery: { id: 'disc-f2', sourceUrl: null, sourceContent: null, durationTarget: null },
      });
      mockDetermineResumePoint.mockResolvedValue({
        step: 'GENERATE_AUDIO',
        pendingSegmentIds: ['seg-3', 'seg-5'],
      });
      const request = createMockRequest();
      const params = await createMockParams('episode-f2');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.resumedAt).toBe('GENERATE_AUDIO');
      expect(data.segments).toBe(2);
      expect(mockRestartExistingSegmentAudio).toHaveBeenCalledWith(
        'episode-f2',
        expect.stringMatching(/^[a-f0-9-]{36}$/)
      );
    });

    it('uses determineResumePoint to resume from STITCH_AUDIO', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaEpisodeFindUnique.mockResolvedValue({
        id: 'episode-f3',
        userId: 'user-001',
        status: 'FAILED',
        source: 'WEB',
        discovery: { id: 'disc-f3', sourceUrl: null, sourceContent: null, durationTarget: null },
      });
      mockDetermineResumePoint.mockResolvedValue({
        step: 'STITCH_AUDIO',
        segmentIds: ['seg-1', 'seg-2', 'seg-3'],
      });
      mockPrismaSegmentFindMany.mockResolvedValue([
        { id: 'seg-1', version: 1, audioUrl: 'audio-1.mp3' },
        { id: 'seg-2', version: 1, audioUrl: 'audio-2.mp3' },
        { id: 'seg-3', version: 1, audioUrl: 'audio-3.mp3' },
      ]);

      const request = createMockRequest();
      const params = await createMockParams('episode-f3');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.resumedAt).toBe('STITCH_AUDIO');
      expect(mockAddJob).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'audio-stitching' }),
        'stitch_audio',
        expect.objectContaining({ segmentIds: ['seg-1', 'seg-2', 'seg-3'] }),
        { jobId: expect.stringMatching(/^stitch-episode-f3-[a-f0-9]{24}$/) }
      );
    });

    it('uses determineResumePoint to resume from SCRIPT_READY', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaEpisodeFindUnique.mockResolvedValue({
        id: 'episode-f4',
        userId: 'user-001',
        status: 'FAILED',
        source: 'WEB',
        discovery: { id: 'disc-f4', sourceUrl: null, sourceContent: null, durationTarget: null },
      });
      mockDetermineResumePoint.mockResolvedValue({ step: 'SCRIPT_READY' });

      const request = createMockRequest();
      const params = await createMockParams('episode-f4');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.resumedAt).toBe('SCRIPT_READY');
      // No job queued — user must approve script
      expect(mockAddJob).not.toHaveBeenCalled();
    });

    it('nukes everything and restarts when forceRestart=true', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaEpisodeFindUnique.mockResolvedValue({
        id: 'episode-fr',
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
      const params = await createMockParams('episode-fr');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Generation started');
    });
  });

  describe('FAILED retry provider override', () => {
    const failedEpisode = {
      id: 'episode-fail',
      userId: 'user-001',
      status: 'FAILED',
      source: 'WEB',
      discovery: { id: 'disc-fail', sourceUrl: null, sourceContent: null, durationTarget: null },
    };

    beforeEach(() => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaEpisodeFindUnique.mockResolvedValue(failedEpisode);
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
      const params = await createMockParams('episode-fail');
      const response = await POST(request, params);

      expect(response.status).toBe(200);
      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'episode-fail' },
          data: { ttsProvider: 'openai', ttsModel: 'tts-1-hd' },
        })
      );
      expect(mockPrismaEpisodeVoiceDeleteMany).toHaveBeenCalledWith({
        where: { episodeId: 'episode-fail' },
      });
    });

    it('preserves ttsProvider when no body is provided (bare retry)', async () => {
      const request = createMockRequest();
      const params = await createMockParams('episode-fail');
      const response = await POST(request, params);

      expect(response.status).toBe(200);
      // Bare retry should NOT clear ttsProvider — keeps same voices on retry.
      // The queue failure handler clears ttsProvider for key invalidation errors.
      const updateCalls = mockPrismaEpisodeUpdate.mock.calls.map(
        (c: unknown[]) => c[0] as { where?: { id?: string }; data?: { ttsProvider?: unknown } }
      );
      const providerClearCall = updateCalls.find(
        (c) => c.data?.ttsProvider === null && c.where?.id === 'episode-fail'
      );
      expect(providerClearCall).toBeUndefined();
      expect(mockPrismaEpisodeVoiceDeleteMany).not.toHaveBeenCalled();
    });

    it('clears ttsProvider/ttsModel and EpisodeVoice on SCRIPT_READY resume', async () => {
      mockDetermineResumePoint.mockResolvedValue({ step: 'SCRIPT_READY' });

      const request = createMockRequest();
      const params = await createMockParams('episode-fail');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.resumedAt).toBe('SCRIPT_READY');
      expect(mockPrismaEpisodeUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'episode-fail', status: 'FAILED' },
          data: expect.objectContaining({
            ttsProvider: null,
            ttsModel: null,
          }),
        })
      );
      // Stale voice assignments should be cleared on re-approval
      expect(mockPrismaEpisodeVoiceDeleteMany).toHaveBeenCalledWith({
        where: { episodeId: 'episode-fail' },
      });
    });
  });

  describe('admin bypass', () => {
    it('admin can generate episode owned by another user', async () => {
      mockIsUserAdmin.mockResolvedValue(true);
      mockAuthenticateRequest.mockResolvedValue({ userId: 'admin-user-id' });
      mockPrismaEpisodeFindUnique.mockResolvedValue({
        id: 'episode-other',
        userId: 'some-other-user',
        status: 'PENDING',
        discovery: { id: 'disc-other', sourceUrl: null, sourceContent: null, durationTarget: null },
      });

      const request = createMockRequest();
      const params = await createMockParams('episode-other');
      const response = await POST(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true, message: 'Generation started' });
    });
  });
});
