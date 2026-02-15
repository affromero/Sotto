/**
 * Flat feature limits — all features free for everyone.
 * Replaces the old credit-based TIER_LIMITS system.
 * File kept as stripe.ts to avoid breaking imports; will rename in a later phase.
 */

export const LIMITS = {
  maxDurationMinutes: 40,
  maxVoiceClones: 10,
  canDownload: true,
  canMakePrivate: true,
  canExportPdf: true,
  hasPremiumSfx: true,
} as const;

export type TierName = 'FREE';

export const TIER_LIMITS: Record<TierName, typeof LIMITS & { premiumVoiceSurcharge: number }> = {
  FREE: { ...LIMITS, premiumVoiceSurcharge: 0 },
};
