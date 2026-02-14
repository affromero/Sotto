import { describe, it, expect } from 'vitest';
import { canGenerate, canInteract, TIER_LIMITS, INTERACTION_CREDIT_COST } from '@/lib/stripe';

describe('TIER_LIMITS', () => {
  it('tiers have increasing credits: FREE < STARTER < PRO < STUDIO', () => {
    expect(TIER_LIMITS.FREE.creditsMonthly).toBeLessThan(TIER_LIMITS.STARTER.creditsMonthly);
    expect(TIER_LIMITS.STARTER.creditsMonthly).toBeLessThan(TIER_LIMITS.PRO.creditsMonthly);
    expect(TIER_LIMITS.PRO.creditsMonthly).toBeLessThan(TIER_LIMITS.STUDIO.creditsMonthly);
  });

  it('tiers have increasing rollover: FREE < STARTER < PRO < STUDIO', () => {
    expect(TIER_LIMITS.FREE.maxRollover).toBeLessThan(TIER_LIMITS.STARTER.maxRollover);
    expect(TIER_LIMITS.STARTER.maxRollover).toBeLessThan(TIER_LIMITS.PRO.maxRollover);
    expect(TIER_LIMITS.PRO.maxRollover).toBeLessThan(TIER_LIMITS.STUDIO.maxRollover);
  });

  it('FREE tier has no rollover', () => {
    expect(TIER_LIMITS.FREE.maxRollover).toBe(0);
  });

  it('FREE tier has shorter max duration than paid tiers', () => {
    expect(TIER_LIMITS.FREE.maxDurationMinutes).toBeLessThan(TIER_LIMITS.STARTER.maxDurationMinutes);
    expect(TIER_LIMITS.FREE.maxDurationMinutes).toBeLessThan(TIER_LIMITS.PRO.maxDurationMinutes);
    expect(TIER_LIMITS.FREE.maxDurationMinutes).toBeLessThan(TIER_LIMITS.STUDIO.maxDurationMinutes);
  });

  it('tiers have increasing voice clones: FREE < STARTER < PRO < STUDIO', () => {
    expect(TIER_LIMITS.FREE.maxVoiceClones).toBeLessThan(TIER_LIMITS.STARTER.maxVoiceClones);
    expect(TIER_LIMITS.STARTER.maxVoiceClones).toBeLessThan(TIER_LIMITS.PRO.maxVoiceClones);
    expect(TIER_LIMITS.PRO.maxVoiceClones).toBeLessThan(TIER_LIMITS.STUDIO.maxVoiceClones);
  });

  it('FREE tier has no premium features', () => {
    expect(TIER_LIMITS.FREE.canDownload).toBe(false);
    expect(TIER_LIMITS.FREE.canMakePrivate).toBe(false);
    expect(TIER_LIMITS.FREE.canBrowseVoiceLibrary).toBe(false);
    expect(TIER_LIMITS.FREE.canListOnMarketplace).toBe(false);
    expect(TIER_LIMITS.FREE.canViewAnalytics).toBe(false);
    expect(TIER_LIMITS.FREE.canExportPdf).toBe(false);
  });

  it('paid tiers can download', () => {
    expect(TIER_LIMITS.STARTER.canDownload).toBe(true);
    expect(TIER_LIMITS.PRO.canDownload).toBe(true);
    expect(TIER_LIMITS.STUDIO.canDownload).toBe(true);
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
