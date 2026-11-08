import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { DurableDeliveryPendingError } from '@/lib/sidedoor/jobs/core/durable-queue';

// ---- Mocks ----

const mockAuthenticateRequest = vi.fn();
const mockRequireOriginalAdmission = vi.fn();

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
    $queryRaw: vi.fn().mockResolvedValue([]),
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

vi.mock('@/lib/sidedoor/access/core/request-identity', () => ({
  requireOriginalSottoAdmission: (...args: unknown[]) => mockRequireOriginalAdmission(...args),
}));
vi.mock('@/lib/learning/classes/progress/listening-attachment-fence', () => ({
  requireListeningAttachmentFence: async () => {},
}));

const mockEnqueueDurableJob = vi.fn();

vi.mock('@/lib/queue', () => ({
  contentExtractionQueue: { name: 'content-extraction' },
  scriptGenerationQueue: { name: 'script-generation' },
  audioGenerationQueue: { name: 'audio-generation' },
  audioStitchingQueue: { name: 'audio-stitching' },
  admitDurableJob: (...args: unknown[]) => mockEnqueueDurableJob(...args),
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
    mockRequireOriginalAdmission.mockReset().mockResolvedValue(undefined);
    mockIsUserAdmin.mockResolvedValue(false); // non-admin by default
    mockPrismaEpisodeUpdate.mockResolvedValue({});
    mockPrismaEpisodeUpdateMany.mockResolvedValue({ count: 1 });
    mockEnqueueDurableJob.mockResolvedValue({ id: 'job-1' });
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

  it.each(['PENDING', 'FAILED'])(
    'does not generate assessment audio in %s state',
    async (status) => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaEpisodeFindUnique.mockResolvedValue({
        id: 'episode-assessment',
        userId: 'user-001',
        status,
        assessmentSection: { id: 'assessment-section' },
        discovery: null,
      });
      const response = await POST(
        createMockRequest({ forceRestart: 'true' }),
        await createMockParams('episode-assessment')
      );
      expect(response.status).toBe(404);
      expect(mockPrismaJobUpdateMany).not.toHaveBeenCalled();
      expect(mockPrismaEpisodeUpdateMany).not.toHaveBeenCalled();
      expect(mockEnqueueDurableJob).not.toHaveBeenCalled();
    }
  );

  it('rejects a retry if the episode becomes assessment material before failed jobs are changed', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    const episode = { id: 'episode-race', userId: 'user-001', status: 'FAILED', discovery: null };
    mockPrismaEpisodeFindUnique
      .mockResolvedValueOnce(episode)
      .mockResolvedValueOnce({ ...episode, assessmentSection: { id: 'assessment-section' } });
    const response = await POST(createMockRequest(), await createMockParams(episode.id));
    expect(response.status).toBe(409);
    expect(mockPrismaJobUpdateMany).not.toHaveBeenCalled();
    expect(mockDetermineResumePoint).not.toHaveBeenCalled();
  });

  it('does not generate audio carrying an assessment marker without a loaded section', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPrismaEpisodeFindUnique.mockResolvedValue({
      id: 'episode-assessment',
      userId: 'user-001',
      status: 'PENDING',
      assessmentSection: null,
      assessmentAudioAssessmentId: 'assessment',
      discovery: null,
    });
    const response = await POST(createMockRequest(), await createMockParams('episode-assessment'));
    expect(response.status).toBe(404);
    expect(mockEnqueueDurableJob).not.toHaveBeenCalled();
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
        expect.stringMatching(/^[a-f0-9-]{36}$/),
        expect.objectContaining({ authorize: expect.any(Function) })
      );
    });

    it('limits a failed audio queue cleanup to the attempt that failed', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaEpisodeFindUnique.mockResolvedValue({
        id: 'episode-failed-queue',
        userId: 'user-001',
        status: 'FAILED',
        discovery: null,
      });
      mockDetermineResumePoint.mockResolvedValue({
        step: 'GENERATE_AUDIO',
        pendingSegmentIds: ['seg'],
      });
      let admissionCount = 0;
      mockRequireOriginalAdmission.mockImplementation(async () => {
        admissionCount += 1;
        if (admissionCount > 2) throw new Error('identity revoked');
      });
      mockRestartExistingSegmentAudio.mockRejectedValueOnce(new Error('queue unavailable'));
      await expect(
        POST(createMockRequest(), await createMockParams('episode-failed-queue'))
      ).rejects.toThrow('queue unavailable');
      expect(mockPrismaJobUpdateMany).not.toHaveBeenCalled();
      const claim = mockPrismaEpisodeUpdateMany.mock.calls.find(
        ([input]) => input.data.status === 'GENERATING_AUDIO'
      )?.[0];
      expect(claim.data.audioGenerationKey).toEqual(expect.any(String));
      expect(mockPrismaEpisodeUpdateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            id: 'episode-failed-queue',
            status: 'GENERATING_AUDIO',
            audioGenerationKey: claim.data.audioGenerationKey,
          },
          data: expect.objectContaining({ status: 'FAILED' }),
        })
      );
    });

    it('keeps an admitted audio generation active when delivery is pending', async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
      mockPrismaEpisodeFindUnique.mockResolvedValue({
        id: 'episode-pending',
        userId: 'user-001',
        status: 'FAILED',
        discovery: null,
      });
      mockDetermineResumePoint.mockResolvedValue({
        step: 'GENERATE_AUDIO',
        pendingSegmentIds: ['seg'],
      });
      mockRestartExistingSegmentAudio.mockRejectedValueOnce(
        new DurableDeliveryPendingError('operation-1', new Error('Delivery interrupted'))
      );
      const response = await POST(createMockRequest(), await createMockParams('episode-pending'));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ success: false, deliveryPending: true });
      expect(
        mockPrismaEpisodeUpdateMany.mock.calls.some(([input]) => input.data.status === 'FAILED')
      ).toBe(false);
    });

    it('rejects stitching resume without its original generation identity', async () => {
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
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: 'The audio generation identity is missing',
      });
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
      expect(mockEnqueueDurableJob).not.toHaveBeenCalled();
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

    it('does not delete material if a learning association appears before the restart claim', async () => {
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
      await POST(createMockRequest({ forceRestart: 'true' }), await createMockParams('episode-fr'));
      const admission = mockEnqueueDurableJob.mock.calls[0][3];
      const removeScript = vi.fn();
      const updateJobs = vi.fn();
      const database = {
        episode: {
          updateMany: async ({ where }: { where: { classSection?: unknown } }) => ({
            count: where.classSection ? 0 : 1,
          }),
        },
        script: { deleteMany: removeScript },
        job: { updateMany: updateJobs },
      };
      await expect(admission.mutate(database, 'operation')).rejects.toThrow(
        'Episode is no longer in the expected pipeline state'
      );
      expect(removeScript).not.toHaveBeenCalled();
      expect(updateJobs).not.toHaveBeenCalled();
    });
  });

  describe('FAILED retry provider override', () => {
    it.each(['explicit', 'persisted'])(
      'leaves failed audio unchanged while %s Fish selection is awaiting activation',
      async (selection) => {
        vi.stubEnv('SOTTO_PROVIDER_ACTIVATION_FILE', '/missing-fish-activation.json');
        if (selection === 'persisted')
          mockPrismaEpisodeFindUnique.mockResolvedValue({ ...failedEpisode, ttsProvider: 'fish' });
        const response = await POST(
          createMockRequest(
            undefined,
            selection === 'explicit' ? { ttsProvider: 'fish' } : undefined
          ),
          await createMockParams('episode-fail')
        );
        expect(response.status).toBe(409);
        expect((await response.json()).error).toContain('being enabled');
        expect(mockPrismaEpisodeUpdateMany).not.toHaveBeenCalled();
        expect(mockPrismaEpisodeUpdate).not.toHaveBeenCalled();
        expect(mockPrismaEpisodeVoiceDeleteMany).not.toHaveBeenCalled();
      }
    );

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
      mockRestartExistingSegmentAudio.mockImplementationOnce(async (_episode, key, options) => {
        await options.onPrepared(
          {
            episode: { update: mockPrismaEpisodeUpdate },
            episodeVoice: { deleteMany: mockPrismaEpisodeVoiceDeleteMany },
            job: { updateMany: mockPrismaJobUpdateMany },
          },
          key
        );
        return 2;
      });
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

    it('keeps the old provider and voices if replacement audio cannot be admitted', async () => {
      mockRestartExistingSegmentAudio.mockRejectedValueOnce(new Error('No segments to queue'));
      await expect(
        POST(
          createMockRequest(undefined, { ttsProvider: 'openai', ttsModel: 'tts-1-hd' }),
          await createMockParams('episode-fail')
        )
      ).rejects.toThrow('No segments to queue');
      expect(mockPrismaEpisodeUpdate).not.toHaveBeenCalled();
      expect(mockPrismaEpisodeVoiceDeleteMany).not.toHaveBeenCalled();
      expect(mockPrismaJobUpdateMany).not.toHaveBeenCalled();
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
