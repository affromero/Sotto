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
    segmentVisual: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    segment: { findUnique: vi.fn() },
    podcast: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn() },
    videoGeneration: { findUnique: vi.fn(), update: vi.fn() },
    avatarOverlay: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
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
  JobType: { COMPOSE_VIDEO: 'compose_video', GENERATE_AVATAR: 'generate_avatar' },
  videoCompositionQueue: { name: 'video-composition' },
  avatarGenerationQueue: { name: 'avatar-generation' },
}));
vi.mock('@/lib/providers/video', () => ({
  resolveVideoProvider: (...args: unknown[]) => mockResolveVideoProvider(...args),
}));
vi.mock('@/lib/video-cost-estimator', () => ({
  fetchAllVideoModels: (...args: unknown[]) => mockFetchAllVideoModels(...args),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processVisualGeneration } from '@/workers/visual-generation.worker';

function makeJob(data: Record<string, unknown>) {
  return { data, updateProgress: vi.fn() } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('visual-generation worker', () => {
  const baseData = {
    podcastId: 'pod-1',
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
    mockPrisma.videoGeneration.update.mockResolvedValue({});

    await processVisualGeneration(makeJob(baseData));

    expect(mockResolveImageProvider).not.toHaveBeenCalled();
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('generates AI illustration and uploads to R2', async () => {
    mockPrisma.segmentVisual.findUnique
      .mockResolvedValueOnce({ assetUrl: null, status: 'pending' })      // idempotency
      .mockResolvedValueOnce({ visualMode: 'image', videoModel: null }); // mode check
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.videoGeneration.findUnique.mockResolvedValue({ imageModel: 'fal-flux-1-schnell' });

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
    mockPrisma.segmentVisual.count
      .mockResolvedValueOnce(0)  // pending/generating count
      .mockResolvedValueOnce(0); // failed count

    await processVisualGeneration(makeJob(baseData));

    expect(mockProvider.generateImage).toHaveBeenCalledWith({
      prompt: 'Editorial illustration of AI',
      width: 1280,
      height: 720,
    });
    expect(mockUploadFile).toHaveBeenCalledWith(
      'podcasts/pod-1/visuals/sv-1.png',
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
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.videoGeneration.findUnique.mockResolvedValue({ imageModel: 'fal-flux-1-schnell' });

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

    mockPrisma.segmentVisual.count
      .mockResolvedValueOnce(0)  // pending/generating count
      .mockResolvedValueOnce(0); // failed count

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
      'podcasts/pod-1/visuals/sv-1.png',
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
    mockPrisma.segmentVisual.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

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
      'podcasts/pod-1/visuals/sv-1.png',
      expect.any(Buffer),
      'image/png',
    );
  });

  it('falls back to AI illustration when no enriched place has coordinates', async () => {
    mockPrisma.segmentVisual.findUnique
      .mockResolvedValueOnce({ assetUrl: null, status: 'pending' })      // idempotency
      .mockResolvedValueOnce({ visualMode: 'image', videoModel: null }); // mode check
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.videoGeneration.findUnique.mockResolvedValue({ imageModel: 'flux-schnell' });

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

    mockPrisma.segmentVisual.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

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

  it('generates AI video when visualMode is video, regardless of visualType', async () => {
    mockPrisma.segmentVisual.findUnique
      .mockResolvedValueOnce({ assetUrl: null, status: 'pending' })                        // idempotency
      .mockResolvedValueOnce({ visualMode: 'video', videoModel: 'minimax-hailuo-02-512p' }) // mode check
      .mockResolvedValueOnce({ segmentId: 'seg-1' });                                       // duration lookup
    mockPrisma.segment.findUnique.mockResolvedValue({ duration: 39.9 });
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });

    const mockVideoProvider = {
      generateVideo: vi.fn().mockResolvedValue(Buffer.from('fake-video')),
    };
    mockResolveVideoProvider.mockResolvedValue({
      provider: mockVideoProvider,
      source: 'platform',
      providerId: 'minimax',
    });
    mockFetchAllVideoModels.mockResolvedValue([
      { modelId: 'minimax-hailuo-02-512p', costPerMinute: 0.9, maxDuration: 10 },
    ]);

    mockPrisma.segmentVisual.count
      .mockResolvedValueOnce(0)  // pending/generating
      .mockResolvedValueOnce(0); // failed

    // Use AI_ILLUSTRATION type but video mode — should generate video, not image
    await processVisualGeneration(makeJob(baseData));

    expect(mockVideoProvider.generateVideo).toHaveBeenCalledWith({
      prompt: 'Editorial illustration of AI',
      duration: 10, // capped from 39.9s to maxDuration 10s
    });
    expect(mockResolveImageProvider).not.toHaveBeenCalled();
    expect(mockUploadFile).toHaveBeenCalledWith(
      'podcasts/pod-1/visuals/sv-1.mp4',
      expect.any(Buffer),
      'video/mp4',
    );
  });

  it('marks generation READY when all visuals ready (client-side rendering)', async () => {
    mockPrisma.segmentVisual.findUnique
      .mockResolvedValueOnce({ assetUrl: null, status: 'pending' })      // idempotency
      .mockResolvedValueOnce({ visualMode: 'image', videoModel: null }); // mode check
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.podcast.findUnique.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.videoGeneration.findUnique.mockResolvedValue({ imageModel: null });

    mockResolveImageProvider.mockResolvedValue({
      provider: {
        generateImage: vi.fn().mockResolvedValue(Buffer.from('img')),
        getModelId: () => 'fal-flux-1-schnell',
        providerId: 'fal' as const,
      },
      source: 'platform',
      providerId: 'fal',
    });

    mockPrisma.segmentVisual.count
      .mockResolvedValueOnce(0)  // pending/generating
      .mockResolvedValueOnce(0); // failed

    await processVisualGeneration(makeJob(baseData));

    // Default: client-side rendering — marks READY directly, no composition queue
    expect(mockPrisma.videoGeneration.update).toHaveBeenCalledWith({
      where: { id: 'vg-1' },
      data: { status: 'READY' },
    });
    expect(mockAddJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'video-composition' }),
      expect.anything(),
      expect.anything(),
    );
  });
});
