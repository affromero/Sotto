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

  it('classifies segments and queues external asset jobs', async () => {
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
        { segmentId: 'seg-1', order: 0, visualType: 'AI_ILLUSTRATION', prompt: 'editorial style', metadata: null, endStatePrompt: 'scene after narration' },
        { segmentId: 'seg-2', order: 1, visualType: 'DATA_CHART', prompt: null, metadata: { chartType: 'bar' }, endStatePrompt: null },
      ],
      inputTokens: 100,
      outputTokens: 200,
      model: 'claude-haiku-4-5-20251001',
    });

    mockPrisma.segmentVisual.findMany.mockResolvedValue([
      { id: 'sv-1', segmentId: 'seg-1', visualType: 'AI_ILLUSTRATION', prompt: 'editorial style', metadata: null },
      { id: 'sv-2', segmentId: 'seg-2', visualType: 'DATA_CHART', prompt: null, metadata: { chartType: 'bar' } },
    ]);

    await processVisualClassification(makeJob(baseData));

    // Should create segment visuals
    expect(mockPrisma.segmentVisual.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ segmentId: 'seg-1', visualType: 'AI_ILLUSTRATION', status: 'pending', endStatePrompt: 'scene after narration' }),
        expect.objectContaining({ segmentId: 'seg-2', visualType: 'DATA_CHART', status: 'ready', endStatePrompt: null }),
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

  it('routes MAP_OVERLAY segments to place-enrichment instead of visual-generation', async () => {
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
          segmentId: 'seg-1',
          order: 0,
          visualType: 'MAP_OVERLAY',
          prompt: 'Ancient Rome city',
          metadata: { places: [{ name: 'Rome', yearHint: -753 }], preset: 'vintage' },
          endStatePrompt: null,
        },
      ],
      inputTokens: 80,
      outputTokens: 60,
      model: 'claude-haiku-4-5-20251001',
    });

    mockPrisma.segmentVisual.findMany.mockResolvedValue([
      {
        id: 'sv-1',
        segmentId: 'seg-1',
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

  it('skips to composition when all segments are programmatic', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValue({
      title: 'Test',
      topic: 'Test',
      segments: [
        { id: 'seg-1', order: 0, speaker: 'Host', text: 'Hello', startTime: 0, duration: 5 },
      ],
    });

    mockClassify.mockResolvedValue({
      classifications: [
        { segmentId: 'seg-1', order: 0, visualType: 'TEXT_CARD', prompt: null, metadata: { headline: 'Test' }, endStatePrompt: null },
      ],
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
