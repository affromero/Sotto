import { describe, it, expect } from 'vitest';
import { canCreatePodcast, canInteract, TIER_LIMITS } from '@/lib/stripe';

describe('TIER_LIMITS', () => {
  it('FREE tier has correct limits', () => {
    expect(TIER_LIMITS.FREE.podcastsPerMonth).toBe(2);
    expect(TIER_LIMITS.FREE.maxDurationMinutes).toBe(10);
    expect(TIER_LIMITS.FREE.interactionsPerPodcast).toBe(2);
    expect(TIER_LIMITS.FREE.premiumVoiceCredits).toBe(0);
    expect(TIER_LIMITS.FREE.maxVoiceClones).toBe(0);
    expect(TIER_LIMITS.FREE.canDownload).toBe(false);
    expect(TIER_LIMITS.FREE.canMakePrivate).toBe(false);
    expect(TIER_LIMITS.FREE.canBrowseVoiceLibrary).toBe(false);
    expect(TIER_LIMITS.FREE.canListOnMarketplace).toBe(false);
    expect(TIER_LIMITS.FREE.canViewAnalytics).toBe(false);
    expect(TIER_LIMITS.FREE.canExportPdf).toBe(false);
  });

  it('PRO tier has correct limits', () => {
    expect(TIER_LIMITS.PRO.podcastsPerMonth).toBe(15);
    expect(TIER_LIMITS.PRO.maxDurationMinutes).toBe(10);
    expect(TIER_LIMITS.PRO.interactionsPerPodcast).toBe(10);
    expect(TIER_LIMITS.PRO.premiumVoiceCredits).toBe(5);
    expect(TIER_LIMITS.PRO.maxVoiceClones).toBe(3);
    expect(TIER_LIMITS.PRO.canDownload).toBe(true);
    expect(TIER_LIMITS.PRO.canMakePrivate).toBe(true);
    expect(TIER_LIMITS.PRO.canBrowseVoiceLibrary).toBe(true);
    expect(TIER_LIMITS.PRO.canListOnMarketplace).toBe(false);
    expect(TIER_LIMITS.PRO.canViewAnalytics).toBe(false);
    expect(TIER_LIMITS.PRO.canExportPdf).toBe(true);
  });

  it('CREATOR tier has correct limits', () => {
    expect(TIER_LIMITS.CREATOR.podcastsPerMonth).toBe(Infinity);
    expect(TIER_LIMITS.CREATOR.maxDurationMinutes).toBe(10);
    expect(TIER_LIMITS.CREATOR.interactionsPerPodcast).toBe(Infinity);
    expect(TIER_LIMITS.CREATOR.premiumVoiceCredits).toBe(20);
    expect(TIER_LIMITS.CREATOR.maxVoiceClones).toBe(10);
    expect(TIER_LIMITS.CREATOR.canDownload).toBe(true);
    expect(TIER_LIMITS.CREATOR.canMakePrivate).toBe(true);
    expect(TIER_LIMITS.CREATOR.canBrowseVoiceLibrary).toBe(true);
    expect(TIER_LIMITS.CREATOR.canListOnMarketplace).toBe(true);
    expect(TIER_LIMITS.CREATOR.canViewAnalytics).toBe(true);
    expect(TIER_LIMITS.CREATOR.canExportPdf).toBe(true);
  });
});

describe('canCreatePodcast', () => {
  describe('FREE tier', () => {
    it('allows creation when under limit', () => {
      const result = canCreatePodcast('FREE', 0);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows creation at 1 podcast used (under limit of 2)', () => {
      const result = canCreatePodcast('FREE', 1);
      expect(result.allowed).toBe(true);
    });

    it('blocks creation when at limit (2 used)', () => {
      const result = canCreatePodcast('FREE', 2);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('2');
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

    it('allows creation at 14 podcasts used (under limit of 15)', () => {
      const result = canCreatePodcast('PRO', 14);
      expect(result.allowed).toBe(true);
    });

    it('blocks creation when at limit (15 used)', () => {
      const result = canCreatePodcast('PRO', 15);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe('CREATOR tier', () => {
    it('allows creation with zero podcasts', () => {
      const result = canCreatePodcast('CREATOR', 0);
      expect(result.allowed).toBe(true);
    });

    it('allows creation with many podcasts (unlimited)', () => {
      const result = canCreatePodcast('CREATOR', 1000);
      expect(result.allowed).toBe(true);
    });

    it('allows creation with very high count (unlimited)', () => {
      const result = canCreatePodcast('CREATOR', 999999);
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

    it('allows interaction at 1 interaction (under limit of 2)', () => {
      const result = canInteract('FREE', 1);
      expect(result.allowed).toBe(true);
    });

    it('blocks interaction when at limit (2 used)', () => {
      const result = canInteract('FREE', 2);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('2');
    });

    it('blocks interaction when over limit', () => {
      const result = canInteract('FREE', 5);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Upgrade');
    });

    it('returns descriptive reason message', () => {
      const result = canInteract('FREE', 2);
      expect(result.reason).toContain('Free tier');
      expect(result.reason).toContain('interactions');
    });
  });

  describe('PRO tier', () => {
    it('allows interaction with zero count', () => {
      const result = canInteract('PRO', 0);
      expect(result.allowed).toBe(true);
    });

    it('allows interaction at 9 (under limit of 10)', () => {
      const result = canInteract('PRO', 9);
      expect(result.allowed).toBe(true);
    });

    it('blocks interaction when at limit (10 used)', () => {
      const result = canInteract('PRO', 10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('Pro tier');
    });
  });

  describe('CREATOR tier', () => {
    it('allows interaction with zero count', () => {
      const result = canInteract('CREATOR', 0);
      expect(result.allowed).toBe(true);
    });

    it('allows interaction with high count (unlimited)', () => {
      const result = canInteract('CREATOR', 100);
      expect(result.allowed).toBe(true);
    });

    it('allows interaction with very high count (unlimited)', () => {
      const result = canInteract('CREATOR', 999999);
      expect(result.allowed).toBe(true);
    });
  });
});
