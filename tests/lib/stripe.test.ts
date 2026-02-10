import { describe, it, expect } from 'vitest';
import { canGenerate, canInteract, TIER_LIMITS, INTERACTION_CREDIT_COST } from '@/lib/stripe';

describe('TIER_LIMITS', () => {
  it('FREE tier has correct limits', () => {
    expect(TIER_LIMITS.FREE.creditsMonthly).toBe(1);
    expect(TIER_LIMITS.FREE.maxRollover).toBe(0);
    expect(TIER_LIMITS.FREE.maxDurationMinutes).toBe(5);
    expect(TIER_LIMITS.FREE.maxVoiceClones).toBe(0);
    expect(TIER_LIMITS.FREE.premiumVoiceSurcharge).toBe(0);
    expect(TIER_LIMITS.FREE.sharedVoiceSurcharge).toBe(0);
    expect(TIER_LIMITS.FREE.canDownload).toBe(false);
    expect(TIER_LIMITS.FREE.canMakePrivate).toBe(false);
    expect(TIER_LIMITS.FREE.canBrowseVoiceLibrary).toBe(false);
    expect(TIER_LIMITS.FREE.canListOnMarketplace).toBe(false);
    expect(TIER_LIMITS.FREE.canViewAnalytics).toBe(false);
    expect(TIER_LIMITS.FREE.canExportPdf).toBe(false);
  });

  it('STARTER tier has correct limits', () => {
    expect(TIER_LIMITS.STARTER.creditsMonthly).toBe(3);
    expect(TIER_LIMITS.STARTER.maxRollover).toBe(1);
    expect(TIER_LIMITS.STARTER.maxDurationMinutes).toBe(10);
    expect(TIER_LIMITS.STARTER.maxVoiceClones).toBe(1);
    expect(TIER_LIMITS.STARTER.sharedVoiceSurcharge).toBe(1);
    expect(TIER_LIMITS.STARTER.canDownload).toBe(true);
    expect(TIER_LIMITS.STARTER.canMakePrivate).toBe(false);
  });

  it('PRO tier has correct limits', () => {
    expect(TIER_LIMITS.PRO.creditsMonthly).toBe(10);
    expect(TIER_LIMITS.PRO.maxRollover).toBe(3);
    expect(TIER_LIMITS.PRO.maxDurationMinutes).toBe(10);
    expect(TIER_LIMITS.PRO.maxVoiceClones).toBe(3);
    expect(TIER_LIMITS.PRO.sharedVoiceSurcharge).toBe(1);
    expect(TIER_LIMITS.PRO.canDownload).toBe(true);
    expect(TIER_LIMITS.PRO.canMakePrivate).toBe(true);
    expect(TIER_LIMITS.PRO.canBrowseVoiceLibrary).toBe(true);
    expect(TIER_LIMITS.PRO.canViewAnalytics).toBe(true);
    expect(TIER_LIMITS.PRO.canExportPdf).toBe(true);
  });

  it('STUDIO tier has correct limits', () => {
    expect(TIER_LIMITS.STUDIO.creditsMonthly).toBe(20);
    expect(TIER_LIMITS.STUDIO.maxRollover).toBe(8);
    expect(TIER_LIMITS.STUDIO.maxDurationMinutes).toBe(10);
    expect(TIER_LIMITS.STUDIO.maxVoiceClones).toBe(10);
    expect(TIER_LIMITS.STUDIO.premiumVoiceSurcharge).toBe(0);
    expect(TIER_LIMITS.STUDIO.sharedVoiceSurcharge).toBe(1);
    expect(TIER_LIMITS.STUDIO.canDownload).toBe(true);
    expect(TIER_LIMITS.STUDIO.canMakePrivate).toBe(true);
    expect(TIER_LIMITS.STUDIO.canBrowseVoiceLibrary).toBe(true);
    expect(TIER_LIMITS.STUDIO.canListOnMarketplace).toBe(true);
    expect(TIER_LIMITS.STUDIO.canViewAnalytics).toBe(true);
    expect(TIER_LIMITS.STUDIO.canExportPdf).toBe(true);
    expect(TIER_LIMITS.STUDIO.hasPremiumSfx).toBe(true);
  });

  it('ADMIN tier has zero sharedVoiceSurcharge', () => {
    expect(TIER_LIMITS.ADMIN.sharedVoiceSurcharge).toBe(0);
  });
});

describe('INTERACTION_CREDIT_COST', () => {
  it('is 0.25', () => {
    expect(INTERACTION_CREDIT_COST).toBe(0.25);
  });
});

describe('canGenerate', () => {
  describe('FREE tier', () => {
    it('allows generation when credits available (no premium)', () => {
      const result = canGenerate(2, false, 'FREE');
      expect(result.allowed).toBe(true);
      expect(result.cost).toBe(1);
    });

    it('allows generation with premium voice (no surcharge)', () => {
      const result = canGenerate(1, true, 'FREE');
      expect(result.allowed).toBe(true);
      expect(result.cost).toBe(1); // no surcharge — all tiers use ElevenLabs
    });

    it('blocks generation when zero credits', () => {
      const result = canGenerate(0, false, 'FREE');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('Insufficient credits');
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

  describe('shared voice surcharge', () => {
    it('adds 1 credit surcharge per shared voice on STUDIO tier', () => {
      const result = canGenerate(5, false, 'STUDIO', undefined, 1);
      expect(result.allowed).toBe(true);
      expect(result.cost).toBe(2);
    });

    it('adds 2 credit surcharge for 2 shared voices on STUDIO tier', () => {
      const result = canGenerate(5, false, 'STUDIO', undefined, 2);
      expect(result.allowed).toBe(true);
      expect(result.cost).toBe(3);
    });

    it('blocks when insufficient credits for shared voice surcharge', () => {
      const result = canGenerate(1, false, 'PRO', undefined, 2);
      expect(result.allowed).toBe(false);
      expect(result.cost).toBe(3);
    });

    it('no surcharge for shared voices on FREE tier', () => {
      const result = canGenerate(1, false, 'FREE', undefined, 1);
      expect(result.allowed).toBe(true);
      expect(result.cost).toBe(1);
    });

    it('no surcharge for shared voices for ADMIN role', () => {
      const result = canGenerate(1, false, 'FREE', 'ADMIN', 2);
      expect(result.allowed).toBe(true);
      expect(result.cost).toBe(1);
    });

    it('combines premium and shared voice surcharges', () => {
      const result = canGenerate(5, true, 'STUDIO', undefined, 1);
      expect(result.allowed).toBe(true);
      expect(result.cost).toBe(2); // premium surcharge is 0, shared is 1
    });

    it('defaults to 0 shared voices when omitted', () => {
      const result = canGenerate(1, false, 'STUDIO');
      expect(result.allowed).toBe(true);
      expect(result.cost).toBe(1);
    });
  });
});

describe('canInteract', () => {
  it('allows interaction when sufficient credits', () => {
    const result = canInteract(1);
    expect(result.allowed).toBe(true);
    expect(result.cost).toBe(0.25);
  });

  it('allows interaction with exactly 0.25 credits', () => {
    const result = canInteract(0.25);
    expect(result.allowed).toBe(true);
    expect(result.cost).toBe(0.25);
  });

  it('blocks interaction when insufficient credits', () => {
    const result = canInteract(0.1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('Insufficient credits');
  });

  it('blocks interaction when zero credits', () => {
    const result = canInteract(0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('0.25');
  });

  it('always allows interaction for ADMIN role', () => {
    const result = canInteract(0, 'ADMIN');
    expect(result.allowed).toBe(true);
    expect(result.cost).toBe(0.25);
  });
});
