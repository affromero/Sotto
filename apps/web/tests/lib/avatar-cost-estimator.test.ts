import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/pricing', () => ({
  getAiCost: vi.fn().mockReturnValue(0),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderIdsWithPricing: vi.fn().mockReturnValue([]),
}));

import { estimateAvatarCost, formatAvatarCost } from '@/lib/avatar-cost-estimator';

describe('estimateAvatarCost', () => {
  it('calculates cost for 1 speaker at default rate', () => {
    // 5 min × $0.10/min = $0.50
    const cost = estimateAvatarCost(300, 1);
    expect(cost).toBeCloseTo(0.50, 2);
  });

  it('scales linearly with speaker count', () => {
    const oneSpeaker = estimateAvatarCost(300, 1);
    const twoSpeakers = estimateAvatarCost(300, 2);
    expect(twoSpeakers).toBeCloseTo(oneSpeaker * 2, 4);
  });

  it('accepts custom cost per minute', () => {
    const cost = estimateAvatarCost(60, 1, 0.50); // $0.50/min, 1 minute
    expect(cost).toBeCloseTo(0.50, 2);
  });

  it('handles zero duration', () => {
    const cost = estimateAvatarCost(0, 2);
    expect(cost).toBe(0);
  });
});

describe('formatAvatarCost', () => {
  it('formats zero as Free', () => {
    expect(formatAvatarCost(0)).toBe('Free');
  });

  it('formats small costs with 4 decimals', () => {
    expect(formatAvatarCost(0.005)).toBe('$0.0050');
  });

  it('formats normal costs with 2 decimals', () => {
    expect(formatAvatarCost(1.50)).toBe('$1.50');
  });
});
