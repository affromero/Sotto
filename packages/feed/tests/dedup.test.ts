import { describe, it, expect } from 'vitest';
import { applyDedupPenalty } from '../src/dedup.js';

describe('applyDedupPenalty', () => {
  it('returns original score for unseen content', () => {
    expect(applyDedupPenalty(0.8, false)).toBe(0.8);
  });

  it('applies penalty for seen content', () => {
    const result = applyDedupPenalty(0.8, true);
    // default seenPenalty = 0.5 → 0.8 * (1 - 0.5) = 0.4
    expect(result).toBeCloseTo(0.4);
  });

  it('returns original score when disabled', () => {
    expect(applyDedupPenalty(0.8, true, { enabled: false, seenPenalty: 0.5 })).toBe(0.8);
  });

  it('respects custom penalty', () => {
    const result = applyDedupPenalty(1.0, true, { enabled: true, seenPenalty: 0.3 });
    expect(result).toBeCloseTo(0.7);
  });
});
