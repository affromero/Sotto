import { describe, it, expect } from 'vitest';
import { canGenerate, canInteract, TIER_LIMITS } from '@/lib/stripe';

describe('TIER_LIMITS', () => {
  it('FREE tier has correct limits', () => {
    expect(TIER_LIMITS.FREE.creditsMonthly).toBe(2);
    expect(TIER_LIMITS.FREE.maxRollover).toBe(0);
    expect(TIER_LIMITS.FREE.maxDurationMinutes).toBe(10);
    expect(TIER_LIMITS.FREE.interactionsPerPodcast).toBe(2);
    expect(TIER_LIMITS.FREE.maxVoiceClones).toBe(0);
    expect(TIER_LIMITS.FREE.premiumVoiceSurcharge).toBe(1);
    expect(TIER_LIMITS.FREE.canDownload).toBe(false);
    expect(TIER_LIMITS.FREE.canMakePrivate).toBe(false);
    expect(TIER_LIMITS.FREE.canBrowseVoiceLibrary).toBe(false);
    expect(TIER_LIMITS.FREE.canListOnMarketplace).toBe(false);
    expect(TIER_LIMITS.FREE.canViewAnalytics).toBe(false);
    expect(TIER_LIMITS.FREE.canExportPdf).toBe(false);
  });

  it('STARTER tier has correct limits', () => {
    expect(TIER_LIMITS.STARTER.creditsMonthly).toBe(5);
    expect(TIER_LIMITS.STARTER.maxRollover).toBe(2);
    expect(TIER_LIMITS.STARTER.maxDurationMinutes).toBe(10);
    expect(TIER_LIMITS.STARTER.interactionsPerPodcast).toBe(5);
    expect(TIER_LIMITS.STARTER.maxVoiceClones).toBe(1);
    expect(TIER_LIMITS.STARTER.canDownload).toBe(true);
    expect(TIER_LIMITS.STARTER.canMakePrivate).toBe(false);
  });

  it('PRO tier has correct limits', () => {
    expect(TIER_LIMITS.PRO.creditsMonthly).toBe(15);
    expect(TIER_LIMITS.PRO.maxRollover).toBe(5);
    expect(TIER_LIMITS.PRO.maxDurationMinutes).toBe(10);
    expect(TIER_LIMITS.PRO.interactionsPerPodcast).toBe(Infinity);
    expect(TIER_LIMITS.PRO.maxVoiceClones).toBe(3);
    expect(TIER_LIMITS.PRO.canDownload).toBe(true);
    expect(TIER_LIMITS.PRO.canMakePrivate).toBe(true);
    expect(TIER_LIMITS.PRO.canBrowseVoiceLibrary).toBe(true);
    expect(TIER_LIMITS.PRO.canViewAnalytics).toBe(true);
    expect(TIER_LIMITS.PRO.canExportPdf).toBe(true);
  });

  it('STUDIO tier has correct limits', () => {
    expect(TIER_LIMITS.STUDIO.creditsMonthly).toBe(50);
    expect(TIER_LIMITS.STUDIO.maxRollover).toBe(20);
    expect(TIER_LIMITS.STUDIO.maxDurationMinutes).toBe(10);
    expect(TIER_LIMITS.STUDIO.interactionsPerPodcast).toBe(Infinity);
    expect(TIER_LIMITS.STUDIO.maxVoiceClones).toBe(10);
    expect(TIER_LIMITS.STUDIO.premiumVoiceSurcharge).toBe(0);
    expect(TIER_LIMITS.STUDIO.canDownload).toBe(true);
    expect(TIER_LIMITS.STUDIO.canMakePrivate).toBe(true);
    expect(TIER_LIMITS.STUDIO.canBrowseVoiceLibrary).toBe(true);
    expect(TIER_LIMITS.STUDIO.canListOnMarketplace).toBe(true);
    expect(TIER_LIMITS.STUDIO.canViewAnalytics).toBe(true);
    expect(TIER_LIMITS.STUDIO.canExportPdf).toBe(true);
    expect(TIER_LIMITS.STUDIO.hasPremiumSfx).toBe(true);
  });
});

describe('canGenerate', () => {
  describe('FREE tier', () => {
    it('allows generation when credits available (no premium)', () => {
      const result = canGenerate(2, false, 'FREE');
      expect(result.allowed).toBe(true);
      expect(result.cost).toBe(1);
    });

    it('allows generation with premium voice when enough credits', () => {
      const result = canGenerate(2, true, 'FREE');
      expect(result.allowed).toBe(true);
      expect(result.cost).toBe(2); // 1 + 1 surcharge
    });

    it('blocks generation when zero credits', () => {
      const result = canGenerate(0, false, 'FREE');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('Insufficient credits');
    });

    it('blocks premium voice when only 1 credit left', () => {
      const result = canGenerate(1, true, 'FREE');
      expect(result.allowed).toBe(false);
      expect(result.cost).toBe(2);
    });
  });

  describe('STUDIO tier', () => {
    it('no surcharge for premium voice', () => {
      const result = canGenerate(1, true, 'STUDIO');
      expect(result.allowed).toBe(true);
      expect(result.cost).toBe(1); // 0 surcharge
    });
  });

  describe('ADMIN role override', () => {
    it('always allows generation for ADMIN role', () => {
      const result = canGenerate(0, true, 'FREE', 'ADMIN');
      // ADMIN tier has Infinity credits concept — cost is 1 (0 surcharge)
      expect(result.cost).toBe(1);
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
      expect(result.reason).toContain('Free');
      expect(result.reason).toContain('interactions');
    });
  });

  describe('PRO tier', () => {
    it('allows interaction with any count (unlimited)', () => {
      const result = canInteract('PRO', 0);
      expect(result.allowed).toBe(true);
    });

    it('allows interaction with high count (unlimited)', () => {
      const result = canInteract('PRO', 999999);
      expect(result.allowed).toBe(true);
    });
  });

  describe('STUDIO tier', () => {
    it('allows interaction with zero count', () => {
      const result = canInteract('STUDIO', 0);
      expect(result.allowed).toBe(true);
    });

    it('allows interaction with high count (unlimited)', () => {
      const result = canInteract('STUDIO', 100);
      expect(result.allowed).toBe(true);
    });
  });

  describe('ADMIN role override', () => {
    it('always allows interaction for ADMIN role', () => {
      const result = canInteract('FREE', 999, 'ADMIN');
      expect(result.allowed).toBe(true);
    });
  });
});
