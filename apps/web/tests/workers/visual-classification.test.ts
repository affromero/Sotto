import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockPrisma,
  mockClassify,
  mockAddJob,
  mockGetAiKey,
  mockResolveAiModel,
  mockResolveMotionProvider,
} = vi.hoisted(() => ({
  mockPrisma: {
    videoGeneration: { update: vi.fn() },
    podcast: { findUniqueOrThrow: vi.fn() },
    segment: { findMany: vi.fn() },
    segmentVisual: { createMany: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    segmentTransition: { createMany: vi.fn() },
    user: { findUniqueOrThrow: vi.fn() },
    discovery: { findUnique: vi.fn() },
  },
  mockClassify: vi.fn(),
  mockAddJob: vi.fn(),
  mockGetAiKey: vi.fn(),
  mockResolveAiModel: vi.fn(),
  mockResolveMotionProvider: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: mockPrisma }));
vi.mock('@/lib/visual-classifier', () => ({
  classifySegmentVisuals: (...args: unknown[]) => mockClassify(...args),
}));
vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { GENERATE_VISUAL: 'generate_visual', COMPOSE_VIDEO: 'compose_video', PLACE_ENRICHMENT: 'place_enrichment' },
  visualGenerationQueue: { name: 'visual-generation' },
  placeEnrichmentQueue: { name: 'place-enrichment' },
  videoCompositionQueue: { name: 'video-composition' },
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));
vi.mock('@/lib/providers/ai-registry', () => ({
  resolveAiModelAndProvider: (...args: unknown[]) => mockResolveAiModel(...args),
}));
vi.mock('@/lib/auto-model-config', () => ({
  resolveMotionProvider: (...args: unknown[]) => mockResolveMotionProvider(...args),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processVisualClassification } from '@/workers/visual-classification.worker';

function makeJob(data: Record<string, unknown>) {
  return { data, updateProgress: vi.fn() } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAiKey.mockResolvedValue(null);
  mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ plan: 'FREE' });
  mockResolveAiModel.mockResolvedValue({ model: 'claude-haiku-4-5-20251001', provider: 'anthropic' });
  mockResolveMotionProvider.mockResolvedValue('remotion');
  mockPrisma.segmentVisual.count.mockResolvedValue(0);
  mockPrisma.discovery.findUnique.mockResolvedValue(null);
});

describe('visual-classification worker', () => {
  const baseData = { podcastId: 'pod-1', videoGenerationId: 'vg-1', userId: 'user-1' };

  it('classifies segments with sub-visuals and queues external asset jobs', async () => {
    mockPrisma.segmentVisual.count.mockResolvedValue(1); // 1 pending (AI_ILLUSTRATION)
    const segments = [
      { id: 'seg-1', order: 0, speaker: 'Host', text: 'Hello', startTime: 0, duration: 5 },
      { id: 'seg-2', order: 1, speaker: 'Expert', text: 'Data shows...', startTime: 5, duration: 8 },
    ];
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({
      title: 'Test Podcast',
      topic: 'Test topic',
      segments,
    });
    mockPrisma.segment.findMany.mockResolvedValue(segments);

    mockClassify.mockResolvedValue({
      classifications: [
        {
          segmentId: 'seg-1', order: 0,
          subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'AI_ILLUSTRATION', prompt: 'editorial style', metadata: null, endStatePrompt: 'scene after narration' }],
        },
        {
          segmentId: 'seg-2', order: 1,
          subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'DATA_CHART', prompt: null, metadata: { chartType: 'bar' }, endStatePrompt: null }],
        },
      ],
      transitionRecommendations: [],
      inputTokens: 100,
      outputTokens: 200,
      model: 'claude-haiku-4-5-20251001',
    });

    // findMany now queries only pending visuals — return only the external one
    mockPrisma.segmentVisual.findMany.mockResolvedValue([
      { id: 'sv-1', segmentId: 'seg-1', subOrder: 0, visualType: 'AI_ILLUSTRATION', prompt: 'editorial style', metadata: null },
    ]);

    await processVisualClassification(makeJob(baseData));

    // Should create segment visuals with subOrder/startOffset/subDuration
    expect(mockPrisma.segmentVisual.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ segmentId: 'seg-1', visualType: 'AI_ILLUSTRATION', status: 'pending', subOrder: 0, startOffset: 0, subDuration: 5, endStatePrompt: 'scene after narration', motionProvider: null }),
        expect.objectContaining({ segmentId: 'seg-2', visualType: 'DATA_CHART', status: 'ready', subOrder: 0, startOffset: 0, subDuration: 8, endStatePrompt: null, motionProvider: 'remotion' }),
      ]),
    });

    // Should only queue AI_ILLUSTRATION (external), not DATA_CHART (programmatic)
    expect(mockAddJob).toHaveBeenCalledTimes(1);
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'visual-generation' }),
      'generate_visual',
      expect.objectContaining({ segmentVisualId: 'sv-1', visualType: 'AI_ILLUSTRATION' }),
    );
  });

  it('creates multiple SegmentVisual records for multi-sub-visual segments', async () => {
    mockPrisma.segmentVisual.count.mockResolvedValue(1); // MAP_OVERLAY is pending
    const segments = [
      { id: 'seg-1', order: 0, speaker: 'Host', text: 'The Silk Road stretched from Xi\'an to Constantinople...', startTime: 0, duration: 30 },
    ];
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({
      title: 'Geography Podcast',
      topic: 'World places',
      segments,
    });
    mockPrisma.segment.findMany.mockResolvedValue(segments);

    mockClassify.mockResolvedValue({
      classifications: [
        {
          segmentId: 'seg-1', order: 0,
          subVisuals: [
            { subOrder: 0, startOffsetFraction: 0, durationFraction: 0.4, visualType: 'TEXT_CARD', prompt: null, metadata: { headline: 'The Silk Road' }, endStatePrompt: null },
            { subOrder: 1, startOffsetFraction: 0.4, durationFraction: 0.6, visualType: 'MAP_OVERLAY', prompt: 'Silk Road trade route', metadata: { places: [{ name: "Xi'an" }, { name: 'Constantinople' }], preset: 'vintage' }, endStatePrompt: null },
          ],
        },
      ],
      transitionRecommendations: [],
      inputTokens: 80,
      outputTokens: 120,
      model: 'claude-haiku-4-5-20251001',
    });

    // findMany queries only pending visuals — MAP_OVERLAY is pending, TEXT_CARD is ready
    mockPrisma.segmentVisual.findMany.mockResolvedValue([
      { id: 'sv-2', segmentId: 'seg-1', subOrder: 1, visualType: 'MAP_OVERLAY', prompt: 'Silk Road trade route', metadata: { places: [{ name: "Xi'an" }, { name: 'Constantinople' }], preset: 'vintage' } },
    ]);

    await processVisualClassification(makeJob(baseData));

    // Should create 2 records for the single segment
    expect(mockPrisma.segmentVisual.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ segmentId: 'seg-1', subOrder: 0, visualType: 'TEXT_CARD', startOffset: 0, subDuration: 12, status: 'ready', motionProvider: 'remotion' }),
        expect.objectContaining({ segmentId: 'seg-1', subOrder: 1, visualType: 'MAP_OVERLAY', startOffset: 12, subDuration: 18, status: 'pending', motionProvider: null }),
      ]),
    });
    expect(mockPrisma.segmentVisual.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it('routes MAP_OVERLAY sub-visuals to place-enrichment queue', async () => {
    mockPrisma.segmentVisual.count.mockResolvedValue(1); // MAP_OVERLAY is pending
    const segments = [
      { id: 'seg-1', order: 0, speaker: 'Host', text: 'Rome was founded...', startTime: 0, duration: 5 },
    ];
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({
      title: 'Ancient Rome',
      topic: 'History',
      segments,
    });
    mockPrisma.segment.findMany.mockResolvedValue(segments);

    mockClassify.mockResolvedValue({
      classifications: [
        {
          segmentId: 'seg-1', order: 0,
          subVisuals: [{
            subOrder: 0, startOffsetFraction: 0, durationFraction: 1,
            visualType: 'MAP_OVERLAY',
            prompt: 'Ancient Rome city',
            metadata: { places: [{ name: 'Rome', yearHint: -753 }], preset: 'vintage' },
            endStatePrompt: null,
          }],
        },
      ],
      transitionRecommendations: [],
      inputTokens: 80,
      outputTokens: 60,
      model: 'claude-haiku-4-5-20251001',
    });

    mockPrisma.segmentVisual.findMany.mockResolvedValue([
      {
        id: 'sv-1',
        segmentId: 'seg-1',
        subOrder: 0,
        visualType: 'MAP_OVERLAY',
        prompt: 'Ancient Rome city',
        metadata: { places: [{ name: 'Rome', yearHint: -753 }], preset: 'vintage' },
      },
    ]);

    await processVisualClassification(makeJob(baseData));

    // Should queue place-enrichment, NOT visual-generation
    expect(mockAddJob).toHaveBeenCalledTimes(1);
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'place-enrichment' }),
      'place_enrichment',
      expect.objectContaining({
        podcastId: 'pod-1',
        videoGenerationId: 'vg-1',
        segmentVisualId: 'sv-1',
        places: [{ name: 'Rome', yearHint: -753 }],
      }),
    );
  });

  it('treats DATA_TABLE as programmatic with ready status', async () => {
    mockPrisma.segmentVisual.count.mockResolvedValue(0); // no pending externals
    const segments = [
      { id: 'seg-1', order: 0, speaker: 'Host', text: 'Here are the rankings...', startTime: 0, duration: 10 },
    ];
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({
      title: 'Rankings',
      topic: 'Data',
      segments,
    });
    mockPrisma.segment.findMany.mockResolvedValue(segments);

    mockClassify.mockResolvedValue({
      classifications: [
        {
          segmentId: 'seg-1', order: 0,
          subVisuals: [{
            subOrder: 0, startOffsetFraction: 0, durationFraction: 1,
            visualType: 'DATA_TABLE',
            prompt: null,
            metadata: { headers: { title: 'Top Companies' }, columns: [{ key: 'name', label: 'Company' }], rows: [{ key: 'r1', values: { name: 'Acme' } }] },
            endStatePrompt: null,
          }],
        },
      ],
      transitionRecommendations: [],
      inputTokens: 50,
      outputTokens: 40,
      model: 'claude-haiku-4-5-20251001',
    });

    await processVisualClassification(makeJob(baseData));

    // DATA_TABLE is programmatic — should be created as 'ready' with motionProvider
    expect(mockPrisma.segmentVisual.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ segmentId: 'seg-1', visualType: 'DATA_TABLE', status: 'ready', motionProvider: 'remotion' }),
      ]),
    });

    // No external asset jobs — should skip to composition
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'video-composition' }),
      'compose_video',
      expect.objectContaining({ podcastId: 'pod-1', videoGenerationId: 'vg-1' }),
    );
  });

  it('skips to composition when all sub-visuals are programmatic', async () => {
    const segments = [
      { id: 'seg-1', order: 0, speaker: 'Host', text: 'Hello', startTime: 0, duration: 5 },
    ];
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({
      title: 'Test',
      topic: 'Test',
      segments,
    });
    mockPrisma.segment.findMany.mockResolvedValue(segments);

    mockClassify.mockResolvedValue({
      classifications: [
        {
          segmentId: 'seg-1', order: 0,
          subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'TEXT_CARD', prompt: null, metadata: { headline: 'Test' }, endStatePrompt: null }],
        },
      ],
      transitionRecommendations: [],
      inputTokens: 50,
      outputTokens: 30,
      model: 'claude-haiku-4-5-20251001',
    });

    await processVisualClassification(makeJob(baseData));

    // Should queue COMPOSE_VIDEO directly
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'video-composition' }),
      'compose_video',
      expect.objectContaining({ podcastId: 'pod-1', videoGenerationId: 'vg-1' }),
    );
  });
});
