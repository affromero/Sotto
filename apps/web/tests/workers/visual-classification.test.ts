import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockPrisma,
  mockClassify,
  mockAddJob,
  mockGetAiKey,
  mockResolveAiModel,
} = vi.hoisted(() => ({
  mockPrisma: {
    videoGeneration: { update: vi.fn() },
    podcast: { findUniqueOrThrow: vi.fn() },
    segmentVisual: { createMany: vi.fn(), findMany: vi.fn() },
    segmentTransition: { createMany: vi.fn() },
    user: { findUniqueOrThrow: vi.fn() },
  },
  mockClassify: vi.fn(),
  mockAddJob: vi.fn(),
  mockGetAiKey: vi.fn(),
  mockResolveAiModel: vi.fn(),
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
});

describe('visual-classification worker', () => {
  const baseData = { podcastId: 'pod-1', videoGenerationId: 'vg-1', userId: 'user-1' };

  it('classifies segments with sub-visuals and queues external asset jobs', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({
      title: 'Test Podcast',
      topic: 'Test topic',
      segments: [
        { id: 'seg-1', order: 0, speaker: 'Host', text: 'Hello', startTime: 0, duration: 5 },
        { id: 'seg-2', order: 1, speaker: 'Expert', text: 'Data shows...', startTime: 5, duration: 8 },
      ],
    });

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

    mockPrisma.segmentVisual.findMany.mockResolvedValue([
      { id: 'sv-1', segmentId: 'seg-1', subOrder: 0, visualType: 'AI_ILLUSTRATION', prompt: 'editorial style', metadata: null },
      { id: 'sv-2', segmentId: 'seg-2', subOrder: 0, visualType: 'DATA_CHART', prompt: null, metadata: { chartType: 'bar' } },
    ]);

    await processVisualClassification(makeJob(baseData));

    // Should create segment visuals with subOrder/startOffset/subDuration
    expect(mockPrisma.segmentVisual.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ segmentId: 'seg-1', visualType: 'AI_ILLUSTRATION', status: 'pending', subOrder: 0, startOffset: 0, subDuration: 5, endStatePrompt: 'scene after narration' }),
        expect.objectContaining({ segmentId: 'seg-2', visualType: 'DATA_CHART', status: 'ready', subOrder: 0, startOffset: 0, subDuration: 8, endStatePrompt: null }),
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
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({
      title: 'Geography Podcast',
      topic: 'World places',
      segments: [
        { id: 'seg-1', order: 0, speaker: 'Host', text: 'The Silk Road stretched from Xi\'an to Constantinople...', startTime: 0, duration: 30 },
      ],
    });

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

    mockPrisma.segmentVisual.findMany.mockResolvedValue([
      { id: 'sv-1', segmentId: 'seg-1', subOrder: 0, visualType: 'TEXT_CARD', prompt: null, metadata: { headline: 'The Silk Road' } },
      { id: 'sv-2', segmentId: 'seg-1', subOrder: 1, visualType: 'MAP_OVERLAY', prompt: 'Silk Road trade route', metadata: { places: [{ name: "Xi'an" }, { name: 'Constantinople' }], preset: 'vintage' } },
    ]);

    await processVisualClassification(makeJob(baseData));

    // Should create 2 records for the single segment
    expect(mockPrisma.segmentVisual.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ segmentId: 'seg-1', subOrder: 0, visualType: 'TEXT_CARD', startOffset: 0, subDuration: 12, status: 'ready' }),
        expect.objectContaining({ segmentId: 'seg-1', subOrder: 1, visualType: 'MAP_OVERLAY', startOffset: 12, subDuration: 18, status: 'pending' }),
      ]),
    });
    expect(mockPrisma.segmentVisual.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it('routes MAP_OVERLAY sub-visuals to place-enrichment queue', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({
      title: 'Ancient Rome',
      topic: 'History',
      segments: [
        { id: 'seg-1', order: 0, speaker: 'Host', text: 'Rome was founded...', startTime: 0, duration: 5 },
      ],
    });

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

  it('skips to composition when all sub-visuals are programmatic', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({
      title: 'Test',
      topic: 'Test',
      segments: [
        { id: 'seg-1', order: 0, speaker: 'Host', text: 'Hello', startTime: 0, duration: 5 },
      ],
    });

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
