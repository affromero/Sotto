import { describe, it, expect } from 'vitest';
import { canCreatePodcast, canInteract, TIER_LIMITS } from '@/lib/stripe';

describe('TIER_LIMITS', () => {
  it('FREE tier has correct limits', () => {
    expect(TIER_LIMITS.FREE.podcastsPerMonth).toBe(3);
    expect(TIER_LIMITS.FREE.maxDurationMinutes).toBe(10);
    expect(TIER_LIMITS.FREE.interactionsPerPodcast).toBe(3);
    expect(TIER_LIMITS.FREE.canDownload).toBe(false);
    expect(TIER_LIMITS.FREE.canMakePrivate).toBe(false);
    expect(TIER_LIMITS.FREE.voiceCount).toBe(2);
  });

  it('PRO tier has correct limits', () => {
    expect(TIER_LIMITS.PRO.podcastsPerMonth).toBe(20);
    expect(TIER_LIMITS.PRO.maxDurationMinutes).toBe(30);
    expect(TIER_LIMITS.PRO.interactionsPerPodcast).toBe(Infinity);
    expect(TIER_LIMITS.PRO.canDownload).toBe(true);
    expect(TIER_LIMITS.PRO.canMakePrivate).toBe(true);
    expect(TIER_LIMITS.PRO.voiceCount).toBe(6);
  });

  it('TEAM tier has correct limits', () => {
    expect(TIER_LIMITS.TEAM.podcastsPerMonth).toBe(Infinity);
    expect(TIER_LIMITS.TEAM.maxDurationMinutes).toBe(30);
    expect(TIER_LIMITS.TEAM.interactionsPerPodcast).toBe(Infinity);
    expect(TIER_LIMITS.TEAM.canDownload).toBe(true);
    expect(TIER_LIMITS.TEAM.canMakePrivate).toBe(true);
    expect(TIER_LIMITS.TEAM.voiceCount).toBe(6);
  });
});

describe('canCreatePodcast', () => {
  describe('FREE tier', () => {
    it('allows creation when under limit', () => {
      const result = canCreatePodcast('FREE', 0);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows creation at 2 podcasts used (under limit of 3)', () => {
      const result = canCreatePodcast('FREE', 2);
      expect(result.allowed).toBe(true);
    });

    it('blocks creation when at limit (3 used)', () => {
      const result = canCreatePodcast('FREE', 3);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('3');
    });

    it('blocks creation when over limit', () => {
      const result = canCreatePodcast('FREE', 5);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Upgrade');
    });
  });

  describe('PRO tier', () => {
    it('allows creation when under limit', () => {
      const result = canCreatePodcast('PRO', 10);
      expect(result.allowed).toBe(true);
    });

    it('allows creation at 19 podcasts used (under limit of 20)', () => {
      const result = canCreatePodcast('PRO', 19);
      expect(result.allowed).toBe(true);
    });

    it('blocks creation when at limit (20 used)', () => {
      const result = canCreatePodcast('PRO', 20);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe('TEAM tier', () => {
    it('allows creation with zero podcasts', () => {
      const result = canCreatePodcast('TEAM', 0);
      expect(result.allowed).toBe(true);
    });

    it('allows creation with many podcasts (unlimited)', () => {
      const result = canCreatePodcast('TEAM', 1000);
      expect(result.allowed).toBe(true);
    });

    it('allows creation with very high count (unlimited)', () => {
      const result = canCreatePodcast('TEAM', 999999);
      expect(result.allowed).toBe(true);
    });
  });
});

describe('canInteract', () => {
  describe('FREE tier', () => {
    it('allows interaction when under limit', () => {
      const result = canInteract('FREE', 0);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows interaction at 2 interactions (under limit of 3)', () => {
      const result = canInteract('FREE', 2);
      expect(result.allowed).toBe(true);
    });

    it('blocks interaction when at limit (3 used)', () => {
      const result = canInteract('FREE', 3);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('3');
    });

    it('blocks interaction when over limit', () => {
      const result = canInteract('FREE', 5);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Upgrade');
    });

    it('returns descriptive reason message', () => {
      const result = canInteract('FREE', 3);
      expect(result.reason).toContain('Free tier');
      expect(result.reason).toContain('interactions');
    });
  });

  describe('PRO tier', () => {
    it('allows interaction with zero count', () => {
      const result = canInteract('PRO', 0);
      expect(result.allowed).toBe(true);
    });

    it('allows interaction with high count (unlimited)', () => {
      const result = canInteract('PRO', 100);
      expect(result.allowed).toBe(true);
    });

    it('allows interaction with very high count (unlimited)', () => {
      const result = canInteract('PRO', 999999);
      expect(result.allowed).toBe(true);
    });
  });

  describe('TEAM tier', () => {
    it('allows interaction with zero count', () => {
      const result = canInteract('TEAM', 0);
      expect(result.allowed).toBe(true);
    });

    it('allows interaction with high count (unlimited)', () => {
      const result = canInteract('TEAM', 100);
      expect(result.allowed).toBe(true);
    });

    it('allows interaction with very high count (unlimited)', () => {
      const result = canInteract('TEAM', 999999);
      expect(result.allowed).toBe(true);
    });
  });
});
