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
 *
 * Free $0 / Pro $14 / Creator $29
 * All tiers cap at 10 min — the sweet spot for focused, digestible content.
 * Default TTS is OpenAI (standard). Premium voice credits use ElevenLabs.
 */
export const TIER_LIMITS = {
  FREE: {
    podcastsPerMonth: 2,
    maxDurationMinutes: 10,
    interactionsPerPodcast: 2,
    premiumVoiceCredits: 0,
    maxVoiceClones: 0,
    hasPremiumSfx: false,
    canDownload: false,
    canMakePrivate: false,
    canBrowseVoiceLibrary: false,
    canListOnMarketplace: false,
    canViewAnalytics: false,
    canExportPdf: false,
  },
  PRO: {
    podcastsPerMonth: 8,
    maxDurationMinutes: 10,
    interactionsPerPodcast: 10,
    premiumVoiceCredits: 3,
    maxVoiceClones: 2,
    hasPremiumSfx: false,
    canDownload: true,
    canMakePrivate: true,
    canBrowseVoiceLibrary: true,
    canListOnMarketplace: false,
    canViewAnalytics: false,
    canExportPdf: true,
  },
  CREATOR: {
    podcastsPerMonth: 30,
    maxDurationMinutes: 10,
    interactionsPerPodcast: Infinity,
    premiumVoiceCredits: 10,
    maxVoiceClones: 5,
    hasPremiumSfx: true,
    canDownload: true,
    canMakePrivate: true,
    canBrowseVoiceLibrary: true,
    canListOnMarketplace: true,
    canViewAnalytics: true,
    canExportPdf: true,
  },
  ADMIN: {
    podcastsPerMonth: Infinity,
    maxDurationMinutes: 60,
    interactionsPerPodcast: Infinity,
    premiumVoiceCredits: Infinity,
    maxVoiceClones: Infinity,
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

/**
 * Get effective tier limits considering user role.
 * ADMIN role always gets ADMIN tier regardless of subscription.
 */
export function getEffectiveTier(subscriptionTier: TierName, userRole?: string): TierName {
  if (userRole === 'ADMIN') return 'ADMIN';
  return subscriptionTier;
}

/**
 * Check if user can create a new podcast
 */
export function canCreatePodcast(
  tier: TierName,
  podcastsUsed: number,
  userRole?: string
): { allowed: boolean; reason?: string } {
  const effectiveTier = getEffectiveTier(tier, userRole);
  const limits = TIER_LIMITS[effectiveTier];
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
  interactionCount: number,
  userRole?: string
): { allowed: boolean; reason?: string } {
  const effectiveTier = getEffectiveTier(tier, userRole);
  const limits = TIER_LIMITS[effectiveTier];
  if (interactionCount >= limits.interactionsPerPodcast) {
    return {
      allowed: false,
      reason: `${effectiveTier === 'FREE' ? 'Free' : effectiveTier === 'PRO' ? 'Pro' : 'Creator'} tier allows ${limits.interactionsPerPodcast} interactions per podcast. Upgrade for unlimited.`,
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
