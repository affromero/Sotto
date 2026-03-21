import { describe, it, expect } from 'vitest';
import { computeFatigueMultiplier } from '../src/fatigue.js';

describe('computeFatigueMultiplier', () => {
  const now = new Date('2026-03-21T12:00:00Z');

  it('returns 1.0 with no fatigue entries', () => {
    expect(computeFatigueMultiplier([], 'creator-1', undefined, now)).toBe(1);
  });

  it('returns 1.0 for unrelated creator entries', () => {
    const entries = [
      { creatorId: 'creator-other', action: 'skip' as const, timestamp: now },
    ];
    expect(computeFatigueMultiplier(entries, 'creator-1', undefined, now)).toBe(1);
  });

  it('applies penalty for recent skips', () => {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const entries = [
      { creatorId: 'creator-1', action: 'skip' as const, timestamp: oneHourAgo },
    ];
    const result = computeFatigueMultiplier(entries, 'creator-1', undefined, now);
    expect(result).toBeLessThan(1);
    expect(result).toBeGreaterThan(0);
  });

  it('increases penalty with more skips', () => {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneSkip = computeFatigueMultiplier(
      [{ creatorId: 'c1', action: 'skip', timestamp: oneHourAgo }],
      'c1',
      undefined,
      now
    );
    const threeSkips = computeFatigueMultiplier(
      [
        { creatorId: 'c1', action: 'skip', timestamp: oneHourAgo },
        { creatorId: 'c1', action: 'skip', timestamp: oneHourAgo },
        { creatorId: 'c1', action: 'skip', timestamp: oneHourAgo },
      ],
      'c1',
      undefined,
      now
    );
    expect(threeSkips).toBeLessThan(oneSkip);
  });

  it('decays penalty over time', () => {
    const recent = computeFatigueMultiplier(
      [{ creatorId: 'c1', action: 'skip', timestamp: new Date(now.getTime() - 60 * 60 * 1000) }],
      'c1',
      undefined,
      now
    );
    const older = computeFatigueMultiplier(
      [{ creatorId: 'c1', action: 'skip', timestamp: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) }],
      'c1',
      undefined,
      now
    );
    expect(older).toBeGreaterThan(recent);
  });

  it('ignores entries older than decayDays', () => {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const result = computeFatigueMultiplier(
      [{ creatorId: 'c1', action: 'skip', timestamp: thirtyDaysAgo }],
      'c1',
      { enabled: true, decayDays: 14, maxPenalty: 0.8, penaltyPerAction: 0.15 },
      now
    );
    expect(result).toBe(1);
  });

  it('caps penalty at maxPenalty', () => {
    const entries = Array.from({ length: 20 }, () => ({
      creatorId: 'c1',
      action: 'skip' as const,
      timestamp: now,
    }));
    const result = computeFatigueMultiplier(
      entries,
      'c1',
      { enabled: true, decayDays: 14, maxPenalty: 0.8, penaltyPerAction: 0.15 },
      now
    );
    expect(result).toBeCloseTo(0.2); // 1 - 0.8
  });

  it('returns 1.0 when disabled', () => {
    const result = computeFatigueMultiplier(
      [{ creatorId: 'c1', action: 'skip', timestamp: now }],
      'c1',
      { enabled: false, decayDays: 14, maxPenalty: 0.8, penaltyPerAction: 0.15 },
      now
    );
    expect(result).toBe(1);
  });
});
