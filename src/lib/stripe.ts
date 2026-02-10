import Stripe from 'stripe';
import { logger } from './logger';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  logger.warn('STRIPE_SECRET_KEY is not set — billing features will not work');
}

export const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion })
  : null;

/**
 * Credit-based pricing tiers
 *
 * Free $0 / Starter $14 / Pro $34 / Studio $69 / Power $9 (BYOK)
 * All tiers use ElevenLabs TTS (no OpenAI fallback — quality is the product).
 * Free caps at 5 min. All paid tiers cap at 10 min.
 * Each podcast generation costs 1 credit. Imports cost 0.5 credits.
 * Each interaction costs 0.25 credits.
 */
export const INTERACTION_CREDIT_COST = 0.25;
export const IMPORT_CREDIT_COST = 0.5;
export const TIER_LIMITS = {
  FREE: {
    creditsMonthly: 3,
    maxRollover: 0,
    maxDurationMinutes: 5,
    maxVoiceClones: 0,
    premiumVoiceSurcharge: 0,
    sharedVoiceSurcharge: 0,
    hasPremiumSfx: false,
    canDownload: false,
    canMakePrivate: false,
    canBrowseVoiceLibrary: false,
    canListOnMarketplace: false,
    canViewAnalytics: false,
    canExportPdf: false,
    requiresByok: false,
  },
  STARTER: {
    creditsMonthly: 5,
    maxRollover: 1,
    maxDurationMinutes: 10,
    maxVoiceClones: 1,
    premiumVoiceSurcharge: 0,
    sharedVoiceSurcharge: 1,
    hasPremiumSfx: false,
    canDownload: true,
    canMakePrivate: false,
    canBrowseVoiceLibrary: true,
    canListOnMarketplace: false,
    canViewAnalytics: false,
    canExportPdf: false,
    requiresByok: false,
  },
  PRO: {
    creditsMonthly: 10,
    maxRollover: 3,
    maxDurationMinutes: 10,
    maxVoiceClones: 3,
    premiumVoiceSurcharge: 0,
    sharedVoiceSurcharge: 1,
    hasPremiumSfx: false,
    canDownload: true,
    canMakePrivate: true,
    canBrowseVoiceLibrary: true,
    canListOnMarketplace: false,
    canViewAnalytics: true,
    canExportPdf: true,
    requiresByok: false,
  },
  STUDIO: {
    creditsMonthly: 20,
    maxRollover: 8,
    maxDurationMinutes: 10,
    maxVoiceClones: 10,
    premiumVoiceSurcharge: 0,
    sharedVoiceSurcharge: 1,
    hasPremiumSfx: true,
    canDownload: true,
    canMakePrivate: true,
    canBrowseVoiceLibrary: true,
    canListOnMarketplace: true,
    canViewAnalytics: true,
    canExportPdf: true,
    requiresByok: false,
  },
  POWER: {
    creditsMonthly: 50,
    maxRollover: 10,
    maxDurationMinutes: 10,
    maxVoiceClones: 10,
    premiumVoiceSurcharge: 0,
    sharedVoiceSurcharge: 1,
    hasPremiumSfx: true,
    canDownload: true,
    canMakePrivate: true,
    canBrowseVoiceLibrary: true,
    canListOnMarketplace: true,
    canViewAnalytics: true,
    canExportPdf: true,
    requiresByok: true,
  },
  ADMIN: {
    creditsMonthly: Infinity,
    maxRollover: Infinity,
    maxDurationMinutes: 60,
    maxVoiceClones: Infinity,
    premiumVoiceSurcharge: 0,
    sharedVoiceSurcharge: 0,
    hasPremiumSfx: true,
    canDownload: true,
    canMakePrivate: true,
    canBrowseVoiceLibrary: true,
    canListOnMarketplace: true,
    canViewAnalytics: true,
    canExportPdf: true,
    requiresByok: false,
  },
} as const;

export type TierName = keyof typeof TIER_LIMITS;

/**
 * Get effective tier limits considering user role.
 * ADMIN role always gets ADMIN tier regardless of subscription.
 */
export function getEffectiveTier(subscriptionTier: TierName, userRole?: string): TierName {
  if (userRole === 'ADMIN') return 'ADMIN';
  return subscriptionTier;
}

/**
 * Check if user can generate a podcast (has sufficient credits).
 * sharedVoiceCount: number of voice slots (host/expert) using another user's shared voice clone.
 */
export function canGenerate(
  creditsBalance: number,
  usePremiumVoice: boolean,
  tier: TierName,
  userRole?: string,
  sharedVoiceCount: number = 0
): { allowed: boolean; cost: number; reason?: string } {
  const effectiveTier = getEffectiveTier(tier, userRole);
  const limits = TIER_LIMITS[effectiveTier];
  const cost =
    1 +
    (usePremiumVoice ? limits.premiumVoiceSurcharge : 0) +
    sharedVoiceCount * limits.sharedVoiceSurcharge;

  if (creditsBalance < cost) {
    return {
      allowed: false,
      cost,
      reason: `Insufficient credits: need ${cost}, have ${creditsBalance}. Buy more credits or upgrade your plan.`,
    };
  }
  return { allowed: true, cost };
}

/**
 * Check if user can interact (has sufficient credits for 0.25 cost).
 * ADMIN role always allowed.
 */
export function canInteract(
  creditsBalance: number,
  userRole?: string
): { allowed: boolean; cost: number; reason?: string } {
  if (userRole === 'ADMIN') {
    return { allowed: true, cost: INTERACTION_CREDIT_COST };
  }

  if (creditsBalance < INTERACTION_CREDIT_COST) {
    return {
      allowed: false,
      cost: INTERACTION_CREDIT_COST,
      reason: `Insufficient credits: interactions cost ${INTERACTION_CREDIT_COST} credits, you have ${creditsBalance}. Buy more credits or upgrade your plan.`,
    };
  }
  return { allowed: true, cost: INTERACTION_CREDIT_COST };
}

/**
 * Create Stripe checkout session.
 * Supports both subscription mode and one-time payment mode (credit packs).
 */
export async function createCheckoutSession(params: {
  userId: string;
  userEmail: string;
  priceId?: string;
  successUrl: string;
  cancelUrl: string;
  mode?: 'subscription' | 'payment';
  unitAmount?: number;
  productName?: string;
  metadata?: Record<string, string>;
}): Promise<string> {
  if (!stripe) {
    throw new Error('Stripe not configured');
  }

  const mode = params.mode ?? 'subscription';

  if (mode === 'payment') {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: params.userEmail,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: params.unitAmount!,
            product_data: { name: params.productName ?? 'Sotto Credits' },
          },
          quantity: 1,
        },
      ],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { userId: params.userId, ...params.metadata },
    });
    return session.url || '';
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: params.userEmail,
    line_items: [{ price: params.priceId!, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: { userId: params.userId, ...params.metadata },
  });

  return session.url || '';
}

/**
 * Create Stripe billing portal session
 */
export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  if (!stripe) {
    throw new Error('Stripe not configured');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}
