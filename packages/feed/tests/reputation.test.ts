import { describe, it, expect } from 'vitest';
import { computeCreatorReputation } from '../src/reputation.js';

describe('computeCreatorReputation', () => {
  it('returns 0-100 range', () => {
    const score = computeCreatorReputation({
      followerCount: 100,
      totalPodcasts: 10,
      avgCompletionRate: 75,
      avgQualityScore: 0.7,
      verifiedReferenceRate: 0.8,
      accountAgeDays: 180,
      totalListeners: 50,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('scores new accounts lower', () => {
    const newAccount = computeCreatorReputation({
      followerCount: 0,
      totalPodcasts: 0,
      avgCompletionRate: 0,
      avgQualityScore: 0,
      verifiedReferenceRate: 0,
      accountAgeDays: 1,
      totalListeners: 0,
    });
    expect(newAccount).toBeLessThan(5);
  });

  it('scores established creators higher', () => {
    const established = computeCreatorReputation({
      followerCount: 5000,
      totalPodcasts: 40,
      avgCompletionRate: 85,
      avgQualityScore: 0.9,
      verifiedReferenceRate: 0.95,
      accountAgeDays: 365,
      totalListeners: 3000,
    });
    expect(established).toBeGreaterThan(70);
  });

  it('penalizes inflated follower counts', () => {
    const genuine = computeCreatorReputation({
      followerCount: 1000,
      totalPodcasts: 20,
      avgCompletionRate: 70,
      avgQualityScore: 0.7,
      verifiedReferenceRate: 0.8,
      accountAgeDays: 200,
      totalListeners: 500,
    });
    const inflated = computeCreatorReputation({
      followerCount: 1000,
      totalPodcasts: 20,
      avgCompletionRate: 70,
      avgQualityScore: 0.7,
      verifiedReferenceRate: 0.8,
      accountAgeDays: 200,
      totalListeners: 5, // suspicious: 1000 followers but only 5 listeners
    });
    expect(inflated).toBeLessThan(genuine);
  });

  it('returns integer', () => {
    const score = computeCreatorReputation({
      followerCount: 123,
      totalPodcasts: 7,
      avgCompletionRate: 62.5,
      avgQualityScore: 0.55,
      verifiedReferenceRate: 0.3,
      accountAgeDays: 90,
      totalListeners: 45,
    });
    expect(Number.isInteger(score)).toBe(true);
  });
});
