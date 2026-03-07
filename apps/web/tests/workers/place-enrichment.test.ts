import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockPrisma,
  mockAddJob,
  mockResolve,
  mockResolveHistorical,
} = vi.hoisted(() => ({
  mockPrisma: {
    segmentVisual: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  },
  mockAddJob: vi.fn(),
  mockResolve: vi.fn(),
  mockResolveHistorical: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: mockPrisma }));
vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { GENERATE_VISUAL: 'generate_visual' },
  visualGenerationQueue: { name: 'visual-generation' },
}));
vi.mock('@sotto/maps', () => ({
  PlaceResolver: class {
    resolve(...args: unknown[]) { return mockResolve(...args); }
    resolveHistorical(...args: unknown[]) { return mockResolveHistorical(...args); }
  },
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
    podcastId: 'pod-1',
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
        podcastId: 'pod-1',
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
});
