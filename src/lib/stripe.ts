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
 * Free $0 / Starter $9 / Pro $24 / Studio $49
 * All tiers cap at 10 min — the sweet spot for focused, digestible content.
 * Each podcast generation costs 1 credit. Premium voices add a surcharge.
 */
export const TIER_LIMITS = {
  FREE: {
    creditsMonthly: 2,
    maxRollover: 0,
    maxDurationMinutes: 10,
    interactionsPerPodcast: 2,
    maxVoiceClones: 0,
    premiumVoiceSurcharge: 1,
    hasPremiumSfx: false,
    canDownload: false,
    canMakePrivate: false,
    canBrowseVoiceLibrary: false,
    canListOnMarketplace: false,
    canViewAnalytics: false,
    canExportPdf: false,
  },
  STARTER: {
    creditsMonthly: 5,
    maxRollover: 2,
    maxDurationMinutes: 10,
    interactionsPerPodcast: 5,
    maxVoiceClones: 1,
    premiumVoiceSurcharge: 1,
    hasPremiumSfx: false,
    canDownload: true,
    canMakePrivate: false,
    canBrowseVoiceLibrary: true,
    canListOnMarketplace: false,
    canViewAnalytics: false,
    canExportPdf: false,
  },
  PRO: {
    creditsMonthly: 15,
    maxRollover: 5,
    maxDurationMinutes: 10,
    interactionsPerPodcast: Infinity,
    maxVoiceClones: 3,
    premiumVoiceSurcharge: 1,
    hasPremiumSfx: false,
    canDownload: true,
    canMakePrivate: true,
    canBrowseVoiceLibrary: true,
    canListOnMarketplace: false,
    canViewAnalytics: true,
    canExportPdf: true,
  },
  STUDIO: {
    creditsMonthly: 50,
    maxRollover: 20,
    maxDurationMinutes: 10,
    interactionsPerPodcast: Infinity,
    maxVoiceClones: 10,
    premiumVoiceSurcharge: 0,
    hasPremiumSfx: true,
    canDownload: true,
    canMakePrivate: true,
    canBrowseVoiceLibrary: true,
    canListOnMarketplace: true,
    canViewAnalytics: true,
    canExportPdf: true,
  },
  ADMIN: {
    creditsMonthly: Infinity,
    maxRollover: Infinity,
    maxDurationMinutes: 60,
    interactionsPerPodcast: Infinity,
    maxVoiceClones: Infinity,
    premiumVoiceSurcharge: 0,
    hasPremiumSfx: true,
    canDownload: true,
    canMakePrivate: true,
    canBrowseVoiceLibrary: true,
    canListOnMarketplace: true,
    canViewAnalytics: true,
    canExportPdf: true,
  },
} as const;

export type TierName = keyof typeof TIER_LIMITS;

const TIER_LABELS: Record<TierName, string> = {
  FREE: 'Free',
  STARTER: 'Starter',
  PRO: 'Pro',
  STUDIO: 'Studio',
  ADMIN: 'Admin',
};

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
 */
export function canGenerate(
  creditsBalance: number,
  usePremiumVoice: boolean,
  tier: TierName,
  userRole?: string
): { allowed: boolean; cost: number; reason?: string } {
  const effectiveTier = getEffectiveTier(tier, userRole);
  const limits = TIER_LIMITS[effectiveTier];
  const cost = 1 + (usePremiumVoice ? limits.premiumVoiceSurcharge : 0);

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
 * Check interaction limits
 */
export function canInteract(
  tier: TierName,
  interactionCount: number,
  userRole?: string
): { allowed: boolean; reason?: string } {
  const effectiveTier = getEffectiveTier(tier, userRole);
  const limits = TIER_LIMITS[effectiveTier];
  if (interactionCount >= limits.interactionsPerPodcast) {
    return {
      allowed: false,
      reason: `${TIER_LABELS[effectiveTier]} tier allows ${limits.interactionsPerPodcast} interactions per podcast. Upgrade for more.`,
    };
  }
  return { allowed: true };
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
