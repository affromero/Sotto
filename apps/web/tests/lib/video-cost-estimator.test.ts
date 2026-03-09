import { describe, it, expect, vi } from 'vitest';
import type { PipelineSegmentNode, PipelineTransition } from '@/types/pipeline';

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
import { estimateSegmentCost, estimatePipelineCost, estimateTransitionCost, estimateAllTransitionsCost, formatCost, getClipInfo } from '@/lib/video-cost-estimator';

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
    endStatePrompt: null,
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

  it('calculates video cost proportional to duration plus frame costs', () => {
    const seg = makeSegment({ visualMode: 'video', model: 'fal-wan2.5-480p', duration: 5 });
    // 5s = 1 clip at maxDuration=5, video cost = (5/60) * 3 = 0.25
    // Frame cost = cheapest image ($0.02) × 2 = 0.04
    expect(estimateSegmentCost(seg, MOCK_IMAGE_MODELS, MOCK_VIDEO_MODELS)).toBeCloseTo(0.29);
  });

  it('charges full duration for chained video clips plus frame costs', () => {
    const seg = makeSegment({ visualMode: 'video', model: 'fal-wan2.5-480p', duration: 12 });
    // 12s / 5s max = 3 clips, video cost = (12/60) * 3 = 0.60
    // Frame cost = cheapest image ($0.02) × 2 = 0.04
    expect(estimateSegmentCost(seg, MOCK_IMAGE_MODELS, MOCK_VIDEO_MODELS)).toBeCloseTo(0.64);
  });

  it('returns 0 for unknown model ID', () => {
    const seg = makeSegment({ model: 'nonexistent-model-xyz' });
    expect(estimateSegmentCost(seg, MOCK_IMAGE_MODELS, MOCK_VIDEO_MODELS)).toBe(0);
  });
});

function makeTransition(overrides: Partial<PipelineTransition> = {}): PipelineTransition {
  return {
    fromSegmentOrder: 0,
    toSegmentOrder: 1,
    fromSegmentId: 'seg-0',
    toSegmentId: 'seg-1',
    enabled: true,
    recommended: true,
    transitionModel: 'fal-veo3-fast-1080p',
    durationSeconds: 1,
    estimatedCost: 0,
    ...overrides,
  };
}

describe('estimateTransitionCost', () => {
  it('returns cost based on duration and model cost per minute', () => {
    const t = makeTransition({ transitionModel: 'fal-veo3-fast-1080p', durationSeconds: 1 });
    // 1s / 60 * $6/min = $0.10
    expect(estimateTransitionCost(t, MOCK_VIDEO_MODELS)).toBeCloseTo(0.1);
  });

  it('returns 0 for disabled transitions', () => {
    const t = makeTransition({ enabled: false });
    expect(estimateTransitionCost(t, MOCK_VIDEO_MODELS)).toBe(0);
  });

  it('returns 0 for null model', () => {
    const t = makeTransition({ transitionModel: null });
    expect(estimateTransitionCost(t, MOCK_VIDEO_MODELS)).toBe(0);
  });

  it('returns 0 for unknown model', () => {
    const t = makeTransition({ transitionModel: 'nonexistent-model' });
    expect(estimateTransitionCost(t, MOCK_VIDEO_MODELS)).toBe(0);
  });
});

describe('estimateAllTransitionsCost', () => {
  it('sums enabled transition costs', () => {
    const transitions = [
      makeTransition({ durationSeconds: 1 }),
      makeTransition({ durationSeconds: 2, fromSegmentOrder: 1, toSegmentOrder: 2 }),
    ];
    // (1/60)*6 + (2/60)*6 = 0.1 + 0.2
    expect(estimateAllTransitionsCost(transitions, MOCK_VIDEO_MODELS)).toBeCloseTo(0.3);
  });

  it('skips disabled transitions', () => {
    const transitions = [
      makeTransition({ durationSeconds: 1 }),
      makeTransition({ enabled: false, durationSeconds: 2, fromSegmentOrder: 1, toSegmentOrder: 2 }),
    ];
    expect(estimateAllTransitionsCost(transitions, MOCK_VIDEO_MODELS)).toBeCloseTo(0.1);
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
    const expectedFrames = 0.02 * 2; // cheapest image × 2 for video segment
    expect(total).toBeCloseTo(expectedImg + 0 + expectedVid + expectedFrames);
  });

  it('includes transition costs when provided', () => {
    const imgSeg = makeSegment({ visualMode: 'image', model: 'fal-flux-2-pro' });
    const transitions = [makeTransition({ durationSeconds: 1 })];

    const withoutTransitions = estimatePipelineCost([imgSeg], MOCK_IMAGE_MODELS, MOCK_VIDEO_MODELS);
    const withTransitions = estimatePipelineCost([imgSeg], MOCK_IMAGE_MODELS, MOCK_VIDEO_MODELS, transitions);

    expect(withTransitions).toBeGreaterThan(withoutTransitions);
    expect(withTransitions - withoutTransitions).toBeCloseTo(0.1); // (1/60)*6
  });

  it('returns same cost when transitions is undefined', () => {
    const imgSeg = makeSegment({ visualMode: 'image', model: 'fal-flux-2-pro' });
    const cost1 = estimatePipelineCost([imgSeg], MOCK_IMAGE_MODELS, MOCK_VIDEO_MODELS);
    const cost2 = estimatePipelineCost([imgSeg], MOCK_IMAGE_MODELS, MOCK_VIDEO_MODELS, undefined);
    expect(cost1).toBe(cost2);
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
