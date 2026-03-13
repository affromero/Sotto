import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({
  prismaUnfiltered: {
    avatarOverlay: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    segment: { findMany: vi.fn() },
    videoGeneration: { update: vi.fn() },
  },
}));

vi.mock('@/lib/r2', () => ({
  uploadFile: vi.fn().mockResolvedValue('https://r2.example.com/uploaded'),
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: vi.fn(),
}));

vi.mock('@/lib/pricing', () => ({
  getAiCost: vi.fn().mockReturnValue(0),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderIdsWithPricing: vi.fn().mockReturnValue([]),
}));

vi.mock('@/lib/heygen', () => ({
  submitAvatarVideo: vi.fn().mockResolvedValue('heygen_vid_123'),
  pollAvatarVideo: vi.fn().mockResolvedValue({ videoUrl: 'https://heygen.com/result.mp4' }),
  isNonRetryableHeyGenError: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/runway', () => ({
  isNonRetryableRunwayError: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/avatar-audio-concat', () => ({
  concatenateSpeakerAudio: vi.fn().mockResolvedValue({ durationSeconds: 120 }),
}));

vi.mock('@/lib/queue', () => ({
  addJob: vi.fn(),
  JobType: { COMPOSE_VIDEO: 'compose_video' },
  videoCompositionQueue: {},
}));

import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { submitAvatarVideo } from '@/lib/heygen';
import { isNonRetryableHeyGenError } from '@/lib/heygen';
import { concatenateSpeakerAudio } from '@/lib/avatar-audio-concat';
import { processAvatarGeneration } from '@/workers/avatar-generation.worker';

const mockJob = {
  data: {
    podcastId: 'pod_1',
    videoGenerationId: 'vg_1',
    avatarOverlayId: 'ao_1',
    speaker: 'Host',
    avatarId: 'avatar_anna',
  },
  updateProgress: vi.fn(),
} as never;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  process.env.HEYGEN_API_KEY = 'test-heygen-key';

  // Default mocks for happy path
  vi.mocked(prisma.avatarOverlay.findUnique).mockResolvedValue({
    id: 'ao_1',
    videoGenerationId: 'vg_1',
    speaker: 'Host',
    avatarId: 'avatar_anna',
    avatarName: null,
    previewImageUrl: null,
    heygenVideoId: null,
    videoUrl: null,
    concatAudioUrl: null,
    status: 'pending',
    failureReason: null,
    durationSeconds: null,
    avatarProvider: null,
    avatarImageUrl: null,
    avatarModelId: null,
    falRequestId: null,
    falChunkIndex: null,
    falTotalChunks: null,
    maskShape: null,
    runwaySessionId: null,
    runwayChunkIndex: null,
    runwayTotalChunks: null,
    chunkVideoUrl: null,
    chunkDurationSeconds: null,
    enabledSegmentIds: [],
    voiceTrackId: null,
    posX: 0.02,
    posY: 0.55,
    width: 0.25,
    height: 0.35,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  vi.mocked(prisma.avatarOverlay.update).mockResolvedValue({} as never);

  vi.mocked(prisma.segment.findMany).mockResolvedValue([
    { id: 'seg_1', order: 1, audioUrl: 'https://r2/seg1.mp3' },
    { id: 'seg_3', order: 3, audioUrl: 'https://r2/seg3.mp3' },
  ] as never);

  // Mock fs, child_process, os
  vi.doMock('child_process', () => ({
    execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: null, result: { stdout: string }) => void) => {
      if (typeof _opts === 'function') {
        _opts(null, { stdout: '120.5\n' });
      } else if (cb) {
        cb(null, { stdout: '120.5\n' });
      }
    }),
  }));

  vi.doMock('fs/promises', () => ({
    mkdtemp: vi.fn().mockResolvedValue('/tmp/avatar-test'),
    readFile: vi.fn().mockResolvedValue(Buffer.from('fake-video')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  }));

  vi.doMock('os', () => ({
    tmpdir: vi.fn().mockReturnValue('/tmp'),
  }));

  vi.doMock('path', () => ({
    join: (...args: string[]) => args.join('/'),
    dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  }));

  // Mock fetch for downloading HeyGen video
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
  }));

  // Default: all avatars ready after this one
  vi.mocked(prisma.avatarOverlay.count).mockResolvedValue(0);
});

describe('processAvatarGeneration', () => {
  it('skips if overlay already has videoUrl (idempotency)', async () => {
    vi.mocked(prisma.avatarOverlay.findUnique).mockResolvedValue({
      id: 'ao_1',
      videoUrl: 'https://r2/existing.webm',
      status: 'ready',
    } as never);

    await processAvatarGeneration(mockJob);

    expect(prisma.avatarOverlay.update).not.toHaveBeenCalled();
  });

  it('skips if overlay not found', async () => {
    vi.mocked(prisma.avatarOverlay.findUnique).mockResolvedValue(null);

    await processAvatarGeneration(mockJob);

    expect(prisma.segment.findMany).not.toHaveBeenCalled();
  });

  it('throws if HEYGEN_API_KEY is not set', async () => {
    delete process.env.HEYGEN_API_KEY;

    await expect(processAvatarGeneration(mockJob)).rejects.toThrow('HEYGEN_API_KEY');
  });

  it('marks overlay failed on error and checks all avatars', async () => {
    vi.mocked(prisma.segment.findMany).mockResolvedValue([]);

    await expect(processAvatarGeneration(mockJob)).rejects.toThrow('No segments found');

    expect(prisma.avatarOverlay.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ao_1' },
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('skips concat when concatAudioUrl already exists (retry checkpoint)', async () => {
    vi.mocked(prisma.avatarOverlay.findUnique).mockResolvedValue({
      id: 'ao_1',
      videoGenerationId: 'vg_1',
      speaker: 'Host',
      avatarId: 'avatar_anna',
      avatarName: null,
      previewImageUrl: null,
      heygenVideoId: null,
      videoUrl: null,
      concatAudioUrl: 'https://r2/existing-concat.mp3',
      status: 'submitting',
      failureReason: null,
      durationSeconds: 120,
      posX: 0.02,
      posY: 0.55,
      width: 0.25,
      height: 0.35,
      avatarProvider: null,
      avatarImageUrl: null,
      avatarModelId: null,
      falRequestId: null,
      falChunkIndex: null,
      falTotalChunks: null,
      maskShape: null,
      runwaySessionId: null,
      runwayChunkIndex: null,
      runwayTotalChunks: null,
      chunkVideoUrl: null,
      chunkDurationSeconds: null,
      enabledSegmentIds: [],
      voiceTrackId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await processAvatarGeneration(mockJob);

    expect(concatenateSpeakerAudio).not.toHaveBeenCalled();
    expect(submitAvatarVideo).toHaveBeenCalled();
  });

  it('skips HeyGen submission when heygenVideoId already exists (retry checkpoint)', async () => {
    vi.mocked(prisma.avatarOverlay.findUnique).mockResolvedValue({
      id: 'ao_1',
      videoGenerationId: 'vg_1',
      speaker: 'Host',
      avatarId: 'avatar_anna',
      avatarName: null,
      previewImageUrl: null,
      heygenVideoId: 'existing_heygen_vid',
      videoUrl: null,
      concatAudioUrl: 'https://r2/existing-concat.mp3',
      status: 'processing',
      failureReason: null,
      durationSeconds: 120,
      posX: 0.02,
      posY: 0.55,
      width: 0.25,
      height: 0.35,
      avatarProvider: null,
      avatarImageUrl: null,
      avatarModelId: null,
      falRequestId: null,
      falChunkIndex: null,
      falTotalChunks: null,
      maskShape: null,
      runwaySessionId: null,
      runwayChunkIndex: null,
      runwayTotalChunks: null,
      chunkVideoUrl: null,
      chunkDurationSeconds: null,
      enabledSegmentIds: [],
      voiceTrackId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await processAvatarGeneration(mockJob);

    expect(concatenateSpeakerAudio).not.toHaveBeenCalled();
    expect(submitAvatarVideo).not.toHaveBeenCalled();
  });

  it('throws UnrecoverableError for billing/credit errors', async () => {
    vi.mocked(prisma.segment.findMany).mockResolvedValue([]);
    vi.mocked(isNonRetryableHeyGenError).mockReturnValue(true);

    const err = await processAvatarGeneration(mockJob).catch((e: Error) => e);
    expect(err).toBeDefined();
    expect(err!.constructor.name).toBe('UnrecoverableError');
  });
});

describe('provider dispatch', () => {
  it('dispatches to HeyGen when avatarProvider is undefined', async () => {
    // Default mockJob has no avatarProvider — should use HeyGen path
    await processAvatarGeneration(mockJob);

    // HeyGen path calls submitAvatarVideo
    expect(submitAvatarVideo).toHaveBeenCalled();
  });

  it('dispatches to HeyGen when avatarProvider is heygen', async () => {
    const heygenJob = {
      data: {
        podcastId: 'pod_1',
        videoGenerationId: 'vg_1',
        avatarOverlayId: 'ao_1',
        speaker: 'Host',
        avatarId: 'avatar_anna',
        avatarProvider: 'heygen' as const,
      },
      updateProgress: vi.fn(),
    } as never;

    await processAvatarGeneration(heygenJob);

    expect(submitAvatarVideo).toHaveBeenCalled();
  });

  it('dispatches to Runway when avatarProvider is runway', async () => {
    process.env.RUNWAY_API_KEY = 'test-runway-key';

    const runwayJob = {
      data: {
        podcastId: 'pod_1',
        videoGenerationId: 'vg_1',
        avatarOverlayId: 'ao_1',
        speaker: 'Host',
        avatarId: 'avatar_anna',
        avatarProvider: 'runway' as const,
        isPreset: true,
      },
      updateProgress: vi.fn(),
    } as never;

    // Runway path will fail trying to fetch concat audio, which proves dispatch worked
    await expect(processAvatarGeneration(runwayJob)).rejects.toThrow();

    // Should NOT have called HeyGen
    expect(submitAvatarVideo).not.toHaveBeenCalled();
  });
});

describe('checkAllAvatarsReady', () => {
  it('reverts videoGeneration to READY when avatars fail (non-critical)', async () => {
    // Avatar failure should NOT hide the existing working video
    vi.mocked(prisma.avatarOverlay.count)
      .mockResolvedValueOnce(0) // pending count = 0
      .mockResolvedValueOnce(1); // failed count = 1

    vi.mocked(prisma.segment.findMany).mockResolvedValue([]);

    await expect(processAvatarGeneration(mockJob)).rejects.toThrow();

    expect(prisma.videoGeneration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'READY' },
      }),
    );
  });

  it('marks videoGeneration READY when all avatars succeed and export disabled', async () => {
    delete process.env.ENABLE_VIDEO_EXPORT;

    // Simulate: overlay found → idempotent (already has videoUrl)
    vi.mocked(prisma.avatarOverlay.findUnique).mockResolvedValue({
      id: 'ao_1',
      videoUrl: 'https://r2/avatar.webm',
      status: 'ready',
    } as never);

    // checkAllAvatarsReady: no pending, no failed
    vi.mocked(prisma.avatarOverlay.count)
      .mockResolvedValueOnce(0) // pending
      .mockResolvedValueOnce(0); // failed

    await processAvatarGeneration(mockJob);

    expect(prisma.videoGeneration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'READY' },
      }),
    );
  });
});
