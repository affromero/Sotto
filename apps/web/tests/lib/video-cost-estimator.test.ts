import { describe, it, expect, vi } from 'vitest';
import type { PipelineSegmentNode } from '@/types/pipeline';

vi.mock('pricetoken', () => ({
  PriceTokenClient: class {
    async getImagePricing() { return []; }
    async getVideoPricing() { return []; }
  },
  STATIC_IMAGE_PRICING: [],
  STATIC_VIDEO_PRICING: [],
}));

vi.mock('@/lib/providers/video-registry', () => ({
  getAllVideoProviderMeta: () => [
    {
      id: 'minimax',
      models: [
        { id: 'minimax-hailuo02-768p', displayName: 'Hailuo 02 768p', tier: 'standard' },
      ],
    },
  ],
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import type { ImageModelCostInfo, VideoModelCostInfo } from '@/lib/video-cost-estimator';
import { estimateSegmentCost, estimatePipelineCost, formatCost, getClipInfo } from '@/lib/video-cost-estimator';

const MOCK_IMAGE_MODELS: ImageModelCostInfo[] = [
  { modelId: 'fal-recraft-v3', pricePerImage: 0.02 },
  { modelId: 'fal-flux-2-pro', pricePerImage: 0.04 },
];

const MOCK_VIDEO_MODELS: VideoModelCostInfo[] = [
  { modelId: 'fal-wan2.5-480p', costPerMinute: 3, maxDuration: 5 },
  { modelId: 'fal-veo3-fast-1080p', costPerMinute: 6, maxDuration: 8 },
];

function makeSegment(overrides: Partial<PipelineSegmentNode> = {}): PipelineSegmentNode {
  return {
    segmentId: 'seg-1',
    order: 0,
    speaker: 'Host',
    text: 'Hello world',
    duration: 5,
    visualType: 'AI_ILLUSTRATION',
    visualMode: 'image',
    model: 'fal-flux-2-pro',
    prompt: 'A test prompt',
    metadata: null,
    estimatedCost: 0,
    ...overrides,
  };
}

describe('estimateSegmentCost', () => {
  it('returns 0 for programmatic segments', () => {
    const seg = makeSegment({ visualMode: 'programmatic', model: null, visualType: 'TEXT_CARD' });
    expect(estimateSegmentCost(seg, MOCK_IMAGE_MODELS, MOCK_VIDEO_MODELS)).toBe(0);
  });

  it('returns 0 when model is null', () => {
    const seg = makeSegment({ model: null });
    expect(estimateSegmentCost(seg, MOCK_IMAGE_MODELS, MOCK_VIDEO_MODELS)).toBe(0);
  });

  it('calculates image cost from model pricing', () => {
    const seg = makeSegment({ visualMode: 'image', model: 'fal-flux-2-pro' });
    expect(estimateSegmentCost(seg, MOCK_IMAGE_MODELS, MOCK_VIDEO_MODELS)).toBe(0.04);
  });

  it('calculates video cost proportional to duration', () => {
    const seg = makeSegment({ visualMode: 'video', model: 'fal-wan2.5-480p', duration: 5 });
    // 5s = 1 clip at maxDuration=5, cost = (5/60) * 3 = 0.25
    expect(estimateSegmentCost(seg, MOCK_IMAGE_MODELS, MOCK_VIDEO_MODELS)).toBeCloseTo(0.25);
  });

  it('charges full duration for chained video clips', () => {
    const seg = makeSegment({ visualMode: 'video', model: 'fal-wan2.5-480p', duration: 12 });
    // 12s / 5s max = 3 clips (5 + 5 + 2), total billed = 12s, cost = (12/60) * 3 = 0.60
    expect(estimateSegmentCost(seg, MOCK_IMAGE_MODELS, MOCK_VIDEO_MODELS)).toBeCloseTo(0.6);
  });

  it('returns 0 for unknown model ID', () => {
    const seg = makeSegment({ model: 'nonexistent-model-xyz' });
    expect(estimateSegmentCost(seg, MOCK_IMAGE_MODELS, MOCK_VIDEO_MODELS)).toBe(0);
  });
});

describe('estimatePipelineCost', () => {
  it('sums costs across mixed modes', () => {
    const imgSeg = makeSegment({ visualMode: 'image', model: 'fal-flux-2-pro' });
    const progSeg = makeSegment({ visualMode: 'programmatic', model: null, visualType: 'QUOTE' });
    const vidSeg = makeSegment({ visualMode: 'video', model: 'fal-wan2.5-480p', duration: 3 });

    const total = estimatePipelineCost([imgSeg, progSeg, vidSeg], MOCK_IMAGE_MODELS, MOCK_VIDEO_MODELS);
    const expectedImg = 0.04;
    const expectedVid = (3 / 60) * 3; // 3s, $3/min
    expect(total).toBeCloseTo(expectedImg + 0 + expectedVid);
  });
});

describe('getClipInfo', () => {
  it('returns 1 clip when duration fits in maxDuration', () => {
    const info = getClipInfo(4, 5);
    expect(info.clipCount).toBe(1);
    expect(info.totalDuration).toBe(4);
  });

  it('returns 1 clip when duration equals maxDuration', () => {
    const info = getClipInfo(5, 5);
    expect(info.clipCount).toBe(1);
    expect(info.totalDuration).toBe(5);
  });

  it('chains 2 clips when duration slightly exceeds maxDuration', () => {
    const info = getClipInfo(7, 5);
    expect(info.clipCount).toBe(2);
    expect(info.totalDuration).toBe(7);
  });

  it('chains 3 clips for 12s with 5s max', () => {
    const info = getClipInfo(12, 5);
    expect(info.clipCount).toBe(3);
    expect(info.totalDuration).toBe(12);
  });

  it('chains exact multiples correctly', () => {
    const info = getClipInfo(10, 5);
    expect(info.clipCount).toBe(2);
    expect(info.totalDuration).toBe(10);
  });
});

describe('formatCost', () => {
  it('returns "Free" for zero', () => {
    expect(formatCost(0)).toBe('Free');
  });

  it('formats small costs with 4 decimals', () => {
    expect(formatCost(0.0025)).toBe('$0.0025');
  });

  it('formats medium costs with 3 decimals', () => {
    expect(formatCost(0.04)).toBe('$0.040');
  });

  it('formats large costs with 2 decimals', () => {
    expect(formatCost(1.5)).toBe('$1.50');
  });
});
