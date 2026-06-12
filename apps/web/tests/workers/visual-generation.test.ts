import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockPrisma,
  mockResolveImageProvider,
  mockResolveVideoProvider,
  mockSearchStockVideo,
  mockDownloadStockAsset,
  mockUploadFile,
  mockAddJob,
  mockFetchAllVideoModels,
} = vi.hoisted(() => ({
  mockPrisma: {
    segmentVisual: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    segment: { findUnique: vi.fn() },
    episode: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn() },
    videoGeneration: { findUnique: vi.fn(), update: vi.fn() },
    avatarOverlay: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    segmentTransition: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
  },
  mockResolveImageProvider: vi.fn(),
  mockResolveVideoProvider: vi.fn(),
  mockSearchStockVideo: vi.fn(),
  mockDownloadStockAsset: vi.fn(),
  mockUploadFile: vi.fn().mockResolvedValue('https://cdn.example.com/visual.png'),
  mockAddJob: vi.fn(),
  mockFetchAllVideoModels: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: mockPrisma }));
vi.mock('@/lib/providers/image', () => ({
  resolveImageProvider: (...args: unknown[]) => mockResolveImageProvider(...args),
}));
vi.mock('@/lib/providers/image-registry', () => ({
  getImageModelCost: () => 0.003,
}));
vi.mock('@/lib/stock-footage', () => ({
  searchStockVideo: (...args: unknown[]) => mockSearchStockVideo(...args),
  downloadStockAsset: (...args: unknown[]) => mockDownloadStockAsset(...args),
}));
vi.mock('@/lib/r2', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));
vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    COMPOSE_VIDEO: 'compose_video',
    GENERATE_AVATAR: 'generate_avatar',
    GENERATE_TRANSITION: 'generate_transition',
    SEND_NOTIFICATION: 'send_notification',
  },
  videoCompositionQueue: { name: 'video-composition' },
  avatarGenerationQueue: { name: 'avatar-generation' },
  transitionGenerationQueue: { name: 'transition-generation' },
  notificationQueue: { name: 'notifications' },
}));
vi.mock('@/lib/providers/video', () => ({
  resolveVideoProvider: (...args: unknown[]) => mockResolveVideoProvider(...args),
}));
vi.mock('@/lib/video-cost-estimator', () => ({
  fetchAllVideoModels: (...args: unknown[]) => mockFetchAllVideoModels(...args),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/hera', () => ({
  generateHeraMotionGraphic: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/hera-prompt-builder', () => ({
  buildHeraPrompt: vi.fn().mockReturnValue('mock hera prompt'),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processVisualGeneration } from '@/workers/visual-generation.worker';

function makeJob(data: Record<string, unknown>) {
  return { data, updateProgress: vi.fn() } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.videoGeneration.findUnique.mockResolvedValue({ zeroCostVideo: false });
});

describe('visual-generation worker', () => {
  const baseData = {
    episodeId: 'pod-1',
    videoGenerationId: 'vg-1',
    segmentVisualId: 'sv-1',
    visualType: 'AI_ILLUSTRATION',
    prompt: 'Editorial illustration of AI',
    metadata: {},
  };

  it('skips if asset already exists (idempotency)', async () => {
    mockPrisma.segmentVisual.findUnique.mockResolvedValue({
      assetUrl: 'https://existing.com/img.png',
      status: 'ready',
    });
    mockPrisma.segmentVisual.count.mockResolvedValue(0);
    mockPrisma.segmentVisual.findMany.mockResolvedValue([]);
    mockPrisma.videoGeneration.update.mockResolvedValue({});

    await processVisualGeneration(makeJob(baseData));

    expect(mockResolveImageProvider).not.toHaveBeenCalled();
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('generates AI illustration and uploads to R2', async () => {
    mockPrisma.segmentVisual.findUnique
      .mockResolvedValueOnce({ assetUrl: null, status: 'pending' })      // idempotency
      .mockResolvedValueOnce({ visualMode: 'image', videoModel: null }); // mode check
    mockPrisma.episode.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.episode.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.videoGeneration.findUnique
      .mockResolvedValueOnce({ zeroCostVideo: false })                    // zeroCostVideo check
      .mockResolvedValueOnce({ imageModel: 'fal-flux-1-schnell' });       // generateAiImage

    const mockProvider = {
      generateImage: vi.fn().mockResolvedValue(Buffer.from('fake-image')),
      getModelId: () => 'fal-flux-1-schnell',
      providerId: 'fal' as const,
    };
    mockResolveImageProvider.mockResolvedValue({
      provider: mockProvider,
      source: 'platform',
      providerId: 'fal',
    });

    // All visuals ready after this one
    mockPrisma.segmentVisual.count.mockResolvedValueOnce(0); // pending/generating count
    mockPrisma.segmentVisual.findMany.mockResolvedValueOnce([]); // failed visuals

    await processVisualGeneration(makeJob(baseData));

    expect(mockProvider.generateImage).toHaveBeenCalledWith({
      prompt: 'Editorial illustration of AI',
      width: 1280,
      height: 720,
    });
    expect(mockUploadFile).toHaveBeenCalledWith(
      'episodes/pod-1/visuals/sv-1.png',
      expect.any(Buffer),
      'image/png',
    );
    expect(mockPrisma.segmentVisual.update).toHaveBeenCalledWith({
      where: { id: 'sv-1' },
      data: expect.objectContaining({ status: 'ready', assetUrl: expect.any(String) }),
    });
  });

  it('falls back to AI illustration when no stock footage found', async () => {
    mockPrisma.segmentVisual.findUnique
      .mockResolvedValueOnce({ assetUrl: null, status: 'pending' })      // idempotency
      .mockResolvedValueOnce({ visualMode: 'image', videoModel: null }); // mode check
    mockSearchStockVideo.mockResolvedValue(null);
    mockPrisma.episode.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.episode.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.videoGeneration.findUnique
      .mockResolvedValueOnce({ zeroCostVideo: false })                    // zeroCostVideo check
      .mockResolvedValueOnce({ imageModel: 'fal-flux-1-schnell' });       // generateAiImage

    const mockProvider = {
      generateImage: vi.fn().mockResolvedValue(Buffer.from('fallback-image')),
      getModelId: () => 'fal-flux-1-schnell',
      providerId: 'fal' as const,
    };
    mockResolveImageProvider.mockResolvedValue({
      provider: mockProvider,
      source: 'platform',
      providerId: 'fal',
    });

    mockPrisma.segmentVisual.count.mockResolvedValueOnce(0); // pending/generating count
    mockPrisma.segmentVisual.findMany.mockResolvedValueOnce([]); // failed visuals

    const stockData = { ...baseData, visualType: 'STOCK_FOOTAGE', prompt: 'ocean waves' };
    await processVisualGeneration(makeJob(stockData));

    // Should generate an AI image, not render a text card
    expect(mockProvider.generateImage).toHaveBeenCalledWith({
      prompt: 'ocean waves',
      width: 1280,
      height: 720,
    });
    // Should update visualType to AI_ILLUSTRATION
    expect(mockPrisma.segmentVisual.update).toHaveBeenCalledWith({
      where: { id: 'sv-1' },
      data: { visualType: 'AI_ILLUSTRATION' },
    });
    // Should upload the generated image
    expect(mockUploadFile).toHaveBeenCalledWith(
      'episodes/pod-1/visuals/sv-1.png',
      expect.any(Buffer),
      'image/png',
    );
  });

  it('generates map image from pre-enriched place metadata', async () => {
    const mockGenerateMapImage = vi.fn().mockResolvedValue(Buffer.from('map-png'));
    vi.doMock('@/lib/map-image', () => ({
      generateMapImage: (...args: unknown[]) => mockGenerateMapImage(...args),
    }));

    mockPrisma.segmentVisual.findUnique
      .mockResolvedValueOnce({ assetUrl: null, status: 'pending' })      // idempotency
      .mockResolvedValueOnce({ visualMode: 'image', videoModel: null }); // mode check
    mockPrisma.segmentVisual.count.mockResolvedValueOnce(0); // pending/generating
    mockPrisma.segmentVisual.findMany.mockResolvedValueOnce([]); // failed visuals

    const mapData = {
      ...baseData,
      visualType: 'MAP_OVERLAY',
      prompt: 'Ancient Rome',
      metadata: {
        places: [{
          name: 'Rome',
          coordinates: [12.4964, 41.9028],
          aliases: ['Roma'],
          modernRegion: 'Lazio, Italy',
          historicalContext: [{ yearStart: -753, periodName: 'Roman Kingdom' }],
          source: 'whg',
          confidence: 0.95,
        }],
        preset: 'vintage',
      },
    };

    await processVisualGeneration(makeJob(mapData));

    expect(mockGenerateMapImage).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Rome', coordinates: [12.4964, 41.9028] }),
      'vintage',
    );
    expect(mockUploadFile).toHaveBeenCalledWith(
      'episodes/pod-1/visuals/sv-1.png',
      expect.any(Buffer),
      'image/png',
    );
  });

  it('falls back to AI illustration when no enriched place has coordinates', async () => {
    mockPrisma.segmentVisual.findUnique
      .mockResolvedValueOnce({ assetUrl: null, status: 'pending' })      // idempotency
      .mockResolvedValueOnce({ visualMode: 'image', videoModel: null }); // mode check
    mockPrisma.episode.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.episode.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.videoGeneration.findUnique
      .mockResolvedValueOnce({ zeroCostVideo: false })                    // zeroCostVideo check
      .mockResolvedValueOnce({ imageModel: 'flux-schnell' });             // generateAiImage

    const mockProvider = {
      generateImage: vi.fn().mockResolvedValue(Buffer.from('fallback')),
      getModelId: () => 'flux-schnell',
      providerId: 'fal' as const,
    };
    mockResolveImageProvider.mockResolvedValue({
      provider: mockProvider,
      source: 'platform',
      providerId: 'fal',
    });

    mockPrisma.segmentVisual.count.mockResolvedValueOnce(0); // pending/generating
    mockPrisma.segmentVisual.findMany.mockResolvedValueOnce([]); // failed visuals

    const mapData = {
      ...baseData,
      visualType: 'MAP_OVERLAY',
      prompt: 'Unknown place',
      metadata: {
        places: [{ name: 'Atlantis' }],
        preset: 'cinematic',
      },
    };

    await processVisualGeneration(makeJob(mapData));

    // Should fall back to AI illustration
    expect(mockProvider.generateImage).toHaveBeenCalled();
    expect(mockPrisma.segmentVisual.update).toHaveBeenCalledWith({
      where: { id: 'sv-1' },
      data: { visualType: 'AI_ILLUSTRATION' },
    });
  });

  it('generates first + last frame images and video for all video segments', async () => {
    mockPrisma.segmentVisual.findUnique
      .mockResolvedValueOnce({ assetUrl: null, status: 'pending' })                                                      // idempotency
      .mockResolvedValueOnce({ visualMode: 'video', videoModel: 'minimax-hailuo02-512p', endStatePrompt: 'scene ends' }) // mode check
      .mockResolvedValueOnce({ segmentId: 'seg-1', subDuration: null });                                                    // duration lookup
    mockPrisma.segment.findUnique.mockResolvedValue({ duration: 8 });
    mockPrisma.episode.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.episode.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.videoGeneration.findUnique
      .mockResolvedValueOnce({ zeroCostVideo: false })                    // zeroCostVideo check
      .mockResolvedValue({ imageModel: 'fal-flux-1-schnell' });           // generateAiImage (called multiple times for video)

    const mockImageProvider = {
      generateImage: vi.fn().mockResolvedValue(Buffer.from('frame-img')),
      getModelId: () => 'fal-flux-1-schnell',
      providerId: 'fal' as const,
    };
    mockResolveImageProvider.mockResolvedValue({
      provider: mockImageProvider,
      source: 'platform',
      providerId: 'fal',
    });

    const mockVideoProvider = {
      generateVideo: vi.fn().mockResolvedValue(Buffer.from('fake-video')),
    };
    mockResolveVideoProvider.mockResolvedValue({
      provider: mockVideoProvider,
      source: 'platform',
      providerId: 'minimax',
    });
    mockFetchAllVideoModels.mockResolvedValue([
      { modelId: 'minimax-hailuo02-512p', costPerMinute: 0.9, maxDuration: 10 },
    ]);
    mockUploadFile
      .mockResolvedValueOnce('https://cdn.example.com/first-frame.png')  // first-frame upload
      .mockResolvedValueOnce('https://cdn.example.com/last-frame.png')   // last-frame upload
      .mockResolvedValueOnce('https://cdn.example.com/visual.mp4');       // video upload

    mockPrisma.segmentVisual.count.mockResolvedValueOnce(0); // pending/generating
    mockPrisma.segmentVisual.findMany.mockResolvedValueOnce([]); // failed visuals

    await processVisualGeneration(makeJob(baseData));

    // Should generate 2 frame images (first + last)
    expect(mockImageProvider.generateImage).toHaveBeenCalledTimes(2);
    // First frame uses videoPrompt
    expect(mockImageProvider.generateImage).toHaveBeenNthCalledWith(1, {
      prompt: 'Editorial illustration of AI',
      width: 1280,
      height: 720,
    });
    // Last frame uses endStatePrompt
    expect(mockImageProvider.generateImage).toHaveBeenNthCalledWith(2, {
      prompt: 'scene ends',
      width: 1280,
      height: 720,
    });
    // Should upload both frames to R2
    expect(mockUploadFile).toHaveBeenCalledWith(
      'episodes/pod-1/visuals/sv-1-first-frame.png',
      expect.any(Buffer),
      'image/png',
    );
    expect(mockUploadFile).toHaveBeenCalledWith(
      'episodes/pod-1/visuals/sv-1-last-frame.png',
      expect.any(Buffer),
      'image/png',
    );
    // Should persist frame URLs on SegmentVisual
    expect(mockPrisma.segmentVisual.update).toHaveBeenCalledWith({
      where: { id: 'sv-1' },
      data: { firstFrameUrl: 'https://cdn.example.com/first-frame.png', lastFrameUrl: 'https://cdn.example.com/last-frame.png' },
    });
    // Should pass both frame URLs to the video provider
    expect(mockVideoProvider.generateVideo).toHaveBeenCalledWith({
      prompt: 'Editorial illustration of AI',
      duration: 8,
      firstFrameImage: 'https://cdn.example.com/first-frame.png',
      lastFrameImage: 'https://cdn.example.com/last-frame.png',
    });
  });

  it('queues video composition when all visuals ready', async () => {
    mockPrisma.segmentVisual.findUnique
      .mockResolvedValueOnce({ assetUrl: null, status: 'pending' })      // idempotency
      .mockResolvedValueOnce({ visualMode: 'image', videoModel: null }); // mode check
    mockPrisma.episode.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.episode.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.videoGeneration.findUnique
      .mockResolvedValueOnce({ zeroCostVideo: false })
      .mockResolvedValueOnce({ imageModel: null });

    mockResolveImageProvider.mockResolvedValue({
      provider: {
        generateImage: vi.fn().mockResolvedValue(Buffer.from('img')),
        getModelId: () => 'fal-flux-1-schnell',
        providerId: 'fal' as const,
      },
      source: 'platform',
      providerId: 'fal',
    });

    mockPrisma.segmentVisual.count.mockResolvedValueOnce(0); // pending/generating
    mockPrisma.segmentVisual.findMany.mockResolvedValueOnce([]); // failed visuals

    await processVisualGeneration(makeJob(baseData));

    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'video-composition' }),
      'compose_video',
      expect.objectContaining({ episodeId: 'pod-1', videoGenerationId: 'vg-1' }),
    );
  });

  it('sends exactly one VIDEO_FAILED notification when multiple visuals fail', async () => {
    // Visual already exists — triggers checkAllReady directly
    mockPrisma.segmentVisual.findUnique.mockResolvedValueOnce({
      assetUrl: 'https://existing.com/img.png',
      status: 'ready',
    });

    // checkAllReady: no pending/generating
    mockPrisma.segmentVisual.count.mockResolvedValueOnce(0);

    // Two failed visuals
    mockPrisma.segmentVisual.findMany.mockResolvedValueOnce([
      { order: 1, videoModel: 'minimax-hailuo02', failureReason: 'No video provider available' },
      { order: 2, videoModel: null, failureReason: 'timeout' },
    ]);

    // Episode lookup for notification
    mockPrisma.episode.findUnique.mockResolvedValue({ userId: 'user-1' });

    await processVisualGeneration(makeJob(baseData));

    // Exactly one notification job
    const notificationCalls = mockAddJob.mock.calls.filter(
      (call) => call[1] === 'send_notification',
    );
    expect(notificationCalls).toHaveLength(1);

    // The notification payload includes per-segment failure details
    const [, , payload] = notificationCalls[0];
    expect(payload.type).toBe('VIDEO_FAILED');
    expect(payload.message).toContain('Segment 1');
    expect(payload.message).toContain('Segment 2');
    expect(payload.message).toContain('No video provider available');
    expect(payload.message).toContain('timeout');
  });

  it('marks USAGE_LIMIT_REACHED as UnrecoverableError', async () => {
    mockPrisma.segmentVisual.findUnique
      .mockResolvedValueOnce({ assetUrl: null, status: 'pending' })      // idempotency
      .mockResolvedValueOnce({ visualMode: 'image', videoModel: null }); // mode check

    mockPrisma.episode.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.episode.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.videoGeneration.findUnique
      .mockResolvedValueOnce({ zeroCostVideo: false })
      .mockResolvedValueOnce({ imageModel: null });

    mockResolveImageProvider.mockRejectedValue(new Error('USAGE_LIMIT_REACHED'));

    // checkAllReady after marking failed
    mockPrisma.segmentVisual.count.mockResolvedValueOnce(0);
    mockPrisma.segmentVisual.findMany.mockResolvedValueOnce([]);

    const { UnrecoverableError } = await import('bullmq');
    await expect(processVisualGeneration(makeJob(baseData))).rejects.toThrow(UnrecoverableError);
  });

  it('passes avatarProvider, avatarImageUrl, avatarModelId when queuing avatar jobs', async () => {
    // Visual already exists — triggers checkAllReady directly
    mockPrisma.segmentVisual.findUnique.mockResolvedValueOnce({
      assetUrl: 'https://existing.com/img.png',
      status: 'ready',
    });

    // checkAllReady: no pending/generating
    mockPrisma.segmentVisual.count.mockResolvedValueOnce(0);
    // No failed visuals
    mockPrisma.segmentVisual.findMany.mockResolvedValueOnce([]);

    // No pending transitions
    mockPrisma.segmentTransition.count.mockResolvedValueOnce(0);

    // One pending avatar overlay
    mockPrisma.avatarOverlay.count.mockResolvedValueOnce(1);
    mockPrisma.episode.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.avatarOverlay.findMany.mockResolvedValueOnce([
      {
        id: 'ao-1',
        speaker: 'Host',
        avatarId: 'avatar_anna',
        avatarProvider: 'fal',
        avatarImageUrl: 'https://cdn.example.com/anna.png',
        avatarModelId: 'fal-lipsync-v1',
      },
    ]);

    await processVisualGeneration(makeJob(baseData));

    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'avatar-generation' }),
      'generate_avatar',
      expect.objectContaining({
        avatarProvider: 'fal',
        avatarImageUrl: 'https://cdn.example.com/anna.png',
        avatarModelId: 'fal-lipsync-v1',
      }),
    );
  });
});
