import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockPrisma,
  mockAddJob,
  mockResolve,
  mockResolveHistorical,
  mockFindHistoricalMaps,
} = vi.hoisted(() => ({
  mockPrisma: {
    segmentVisual: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  },
  mockAddJob: vi.fn(),
  mockResolve: vi.fn(),
  mockResolveHistorical: vi.fn(),
  mockFindHistoricalMaps: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: mockPrisma }));
vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { GENERATE_VISUAL: 'generate_visual' },
  visualGenerationQueue: { name: 'visual-generation' },
}));
vi.mock('@sotto/maps/server', () => ({
  PlaceResolver: class {
    resolve(...args: unknown[]) { return mockResolve(...args); }
    resolveHistorical(...args: unknown[]) { return mockResolveHistorical(...args); }
  },
  findHistoricalMaps: (...args: unknown[]) => mockFindHistoricalMaps(...args),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processPlaceEnrichment } from '@/workers/place-enrichment.worker';

function makeJob(data: Record<string, unknown>) {
  return { data, updateProgress: vi.fn() } as never;
}

const mockPlace = {
  name: 'Constantinople',
  aliases: ['Istanbul', 'Byzantium'],
  coordinates: [28.9784, 41.0082] as [number, number],
  modernRegion: 'Istanbul, Turkey',
  historicalContext: [{ yearStart: 330, yearEnd: 1453, periodName: 'Byzantine Empire' }],
  source: 'whg' as const,
  sourceId: 'whg-12345',
  confidence: 0.92,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('place-enrichment worker', () => {
  const baseData = {
    segmentVisualId: 'sv-1',
    episodeId: 'pod-1',
    videoGenerationId: 'vg-1',
    places: [{ name: 'Constantinople', yearHint: 1200 }],
  };

  it('uses resolveHistorical when yearHint is present', async () => {
    mockResolveHistorical.mockResolvedValue(mockPlace);
    mockPrisma.segmentVisual.findUniqueOrThrow.mockResolvedValue({
      visualType: 'MAP_OVERLAY',
      prompt: 'Constantinople map',
      metadata: { places: [{ name: 'Constantinople', yearHint: 1200 }], preset: 'vintage' },
    });

    await processPlaceEnrichment(makeJob(baseData));

    expect(mockResolveHistorical).toHaveBeenCalledWith('Constantinople', 1200);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('uses resolve when no yearHint is present', async () => {
    mockResolve.mockResolvedValue(mockPlace);
    const data = { ...baseData, places: [{ name: 'Paris' }] };
    mockPrisma.segmentVisual.findUniqueOrThrow.mockResolvedValue({
      visualType: 'MAP_OVERLAY',
      prompt: 'Paris map',
      metadata: { places: [{ name: 'Paris' }], preset: 'satellite' },
    });

    await processPlaceEnrichment(makeJob(data));

    expect(mockResolve).toHaveBeenCalledWith('Paris');
    expect(mockResolveHistorical).not.toHaveBeenCalled();
  });

  it('merges enriched places into existing metadata preserving preset', async () => {
    mockResolveHistorical.mockResolvedValue(mockPlace);
    mockPrisma.segmentVisual.findUniqueOrThrow.mockResolvedValue({
      visualType: 'MAP_OVERLAY',
      prompt: 'Constantinople map',
      metadata: { places: [{ name: 'Constantinople', yearHint: 1200 }], preset: 'cinematic' },
    });

    await processPlaceEnrichment(makeJob(baseData));

    // Should merge — preset preserved, places replaced with enriched data
    expect(mockPrisma.segmentVisual.update).toHaveBeenCalledWith({
      where: { id: 'sv-1' },
      data: {
        metadata: expect.objectContaining({
          preset: 'cinematic',
          places: [expect.objectContaining({ name: 'Constantinople', coordinates: [28.9784, 41.0082] })],
        }),
      },
    });
  });

  it('queues visual-generation after enrichment', async () => {
    mockResolveHistorical.mockResolvedValue(mockPlace);
    mockPrisma.segmentVisual.findUniqueOrThrow.mockResolvedValue({
      visualType: 'MAP_OVERLAY',
      prompt: 'Constantinople map',
      metadata: { places: [{ name: 'Constantinople', yearHint: 1200 }], preset: 'vintage' },
    });

    await processPlaceEnrichment(makeJob(baseData));

    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'visual-generation' }),
      'generate_visual',
      expect.objectContaining({
        episodeId: 'pod-1',
        videoGenerationId: 'vg-1',
        segmentVisualId: 'sv-1',
        visualType: 'MAP_OVERLAY',
        prompt: 'Constantinople map',
      }),
    );
  });

  it('still queues visual-generation when no places resolve (AI illustration fallback)', async () => {
    mockResolveHistorical.mockResolvedValue(null);
    mockPrisma.segmentVisual.findUniqueOrThrow.mockResolvedValue({
      visualType: 'MAP_OVERLAY',
      prompt: 'Lost city of Atlantis',
      metadata: { places: [{ name: 'Atlantis', yearHint: -9000 }], preset: 'parchment' },
    });

    const data = { ...baseData, places: [{ name: 'Atlantis', yearHint: -9000 }] };
    await processPlaceEnrichment(makeJob(data));

    // Metadata updated with empty places array
    expect(mockPrisma.segmentVisual.update).toHaveBeenCalledWith({
      where: { id: 'sv-1' },
      data: {
        metadata: expect.objectContaining({ preset: 'parchment', places: [] }),
      },
    });

    // Still queues visual-generation — it will fall back to AI illustration
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'visual-generation' }),
      'generate_visual',
      expect.objectContaining({ segmentVisualId: 'sv-1', visualType: 'MAP_OVERLAY' }),
    );
  });

  it('searches Rumsey historical maps when yearHint is present and stores results', async () => {
    const rumseyResults = [
      { title: 'Constantinople 1422', date: '1422', thumbnailUrl: 'https://rumsey.example/thumb.jpg', viewUrl: 'https://rumsey.example/view' },
    ];
    mockResolveHistorical.mockResolvedValue(mockPlace);
    mockFindHistoricalMaps.mockResolvedValue(rumseyResults);
    mockPrisma.segmentVisual.findUniqueOrThrow.mockResolvedValue({
      visualType: 'MAP_OVERLAY',
      prompt: 'Constantinople map',
      metadata: { places: [{ name: 'Constantinople', yearHint: 1200 }], preset: 'vintage' },
    });

    await processPlaceEnrichment(makeJob(baseData));

    expect(mockFindHistoricalMaps).toHaveBeenCalledWith('Constantinople', 3);
    expect(mockPrisma.segmentVisual.update).toHaveBeenCalledWith({
      where: { id: 'sv-1' },
      data: {
        metadata: expect.objectContaining({
          historicalMaps: rumseyResults,
        }),
      },
    });
  });

  it('completes enrichment when Rumsey API fails', async () => {
    mockResolveHistorical.mockResolvedValue(mockPlace);
    mockFindHistoricalMaps.mockRejectedValue(new Error('Rumsey API down'));
    mockPrisma.segmentVisual.findUniqueOrThrow.mockResolvedValue({
      visualType: 'MAP_OVERLAY',
      prompt: 'Constantinople map',
      metadata: { places: [{ name: 'Constantinople', yearHint: 1200 }], preset: 'vintage' },
    });

    await processPlaceEnrichment(makeJob(baseData));

    // Should still complete — no historicalMaps in metadata
    expect(mockPrisma.segmentVisual.update).toHaveBeenCalledWith({
      where: { id: 'sv-1' },
      data: {
        metadata: expect.not.objectContaining({ historicalMaps: expect.anything() }),
      },
    });
    expect(mockAddJob).toHaveBeenCalled();
  });

  it('does not search Rumsey when no yearHint and no historical context', async () => {
    const placeWithoutHistory = { ...mockPlace, name: 'Paris', historicalContext: [] };
    mockResolve.mockResolvedValue(placeWithoutHistory);
    mockPrisma.segmentVisual.findUniqueOrThrow.mockResolvedValue({
      visualType: 'MAP_OVERLAY',
      prompt: 'Paris map',
      metadata: { places: [{ name: 'Paris' }], preset: 'satellite' },
    });

    const data = { ...baseData, places: [{ name: 'Paris' }] };
    await processPlaceEnrichment(makeJob(data));

    expect(mockFindHistoricalMaps).not.toHaveBeenCalled();
  });
});
