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
 * Pricing tiers and limits
 */
export const TIER_LIMITS = {
  FREE: {
    podcastsPerMonth: 3,
    maxDurationMinutes: 10,
    interactionsPerPodcast: 3,
    canDownload: false,
    canMakePrivate: false,
    voiceCount: 2,
  },
  PRO: {
    podcastsPerMonth: 20,
    maxDurationMinutes: 30,
    interactionsPerPodcast: Infinity,
    canDownload: true,
    canMakePrivate: true,
    voiceCount: 6,
  },
  TEAM: {
    podcastsPerMonth: Infinity,
    maxDurationMinutes: 30,
    interactionsPerPodcast: Infinity,
    canDownload: true,
    canMakePrivate: true,
    voiceCount: 6,
  },
} as const;

export type TierName = keyof typeof TIER_LIMITS;

/**
 * Check if user can create a new podcast
 */
export function canCreatePodcast(
  tier: TierName,
  podcastsUsed: number
): { allowed: boolean; reason?: string } {
  const limits = TIER_LIMITS[tier];
  if (podcastsUsed >= limits.podcastsPerMonth) {
    return {
      allowed: false,
      reason: `You've used all ${limits.podcastsPerMonth} podcasts this month. Upgrade to create more.`,
    };
  }
  return { allowed: true };
}

/**
 * Check interaction limits
 */
export function canInteract(
  tier: TierName,
  interactionCount: number
): { allowed: boolean; reason?: string } {
  const limits = TIER_LIMITS[tier];
  if (interactionCount >= limits.interactionsPerPodcast) {
    return {
      allowed: false,
      reason: `Free tier allows ${limits.interactionsPerPodcast} interactions per podcast. Upgrade for unlimited.`,
    };
  }
  return { allowed: true };
}

/**
 * Create Stripe checkout session
 */
export async function createCheckoutSession(params: {
  userId: string;
  userEmail: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  if (!stripe) {
    throw new Error('Stripe not configured');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: params.userEmail,
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: { userId: params.userId },
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
