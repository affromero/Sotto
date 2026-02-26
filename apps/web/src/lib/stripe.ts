import Stripe from 'stripe';

/** Max podcast duration for free tier users (minutes) */
export const FREE_TIER_MAX_DURATION_MINUTES = 5;

/**
 * Flat feature limits — all features free for everyone.
 */
export const LIMITS = {
  maxDurationMinutes: 40,
  maxVoiceClones: 10,
  canMakePrivate: true,
  canExportPdf: true,
  hasPremiumSfx: true,
} as const;

export type TierName = 'FREE';

export const TIER_LIMITS: Record<TierName, typeof LIMITS & { premiumVoiceSurcharge: number }> = {
  FREE: { ...LIMITS, premiumVoiceSurcharge: 0 },
};

/** Platform fee percentage taken from voice sales */
export const PLATFORM_FEE_PERCENT = 10;

/** Stripe SDK client — null if STRIPE_SECRET_KEY is not set */
export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;
