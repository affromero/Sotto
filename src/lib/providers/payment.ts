import { logger } from '../logger';

export interface TierLimits {
  creditsMonthly: number;
  maxRollover: number;
  maxDurationMinutes: number;
  interactionsPerPodcast: number;
  canDownload: boolean;
  canMakePrivate: boolean;
  voiceCount: number;
}

export interface CheckoutParams {
  userId: string;
  userEmail: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentProvider {
  getTierLimits(tier: string): TierLimits;
  createCheckoutSession(params: CheckoutParams): Promise<string>;
  createPortalSession(customerId: string, returnUrl: string): Promise<string>;
}

/**
 * Stripe provider — wraps existing stripe.ts.
 */
const TIER_LIMITS: Record<string, TierLimits> = {
  FREE: {
    creditsMonthly: 2,
    maxRollover: 0,
    maxDurationMinutes: 10,
    interactionsPerPodcast: 2,
    canDownload: false,
    canMakePrivate: false,
    voiceCount: 2,
  },
  STARTER: {
    creditsMonthly: 5,
    maxRollover: 2,
    maxDurationMinutes: 10,
    interactionsPerPodcast: 5,
    canDownload: true,
    canMakePrivate: false,
    voiceCount: 4,
  },
  PRO: {
    creditsMonthly: 15,
    maxRollover: 5,
    maxDurationMinutes: 10,
    interactionsPerPodcast: Infinity,
    canDownload: true,
    canMakePrivate: true,
    voiceCount: 6,
  },
  STUDIO: {
    creditsMonthly: 50,
    maxRollover: 20,
    maxDurationMinutes: 10,
    interactionsPerPodcast: Infinity,
    canDownload: true,
    canMakePrivate: true,
    voiceCount: 10,
  },
};

class StripeProvider implements PaymentProvider {
  private async getClient() {
    return import('../stripe');
  }

  getTierLimits(tier: string): TierLimits {
    return TIER_LIMITS[tier] || TIER_LIMITS.FREE;
  }

  async createCheckoutSession(params: CheckoutParams): Promise<string> {
    const stripe = await this.getClient();
    return stripe.createCheckoutSession(params);
  }

  async createPortalSession(customerId: string, returnUrl: string): Promise<string> {
    const stripe = await this.getClient();
    return stripe.createPortalSession(customerId, returnUrl);
  }
}

/**
 * NoOp provider — everything free, no payment integration.
 * Useful for development and MVP testing.
 */
class NoOpProvider implements PaymentProvider {
  getTierLimits(_tier: string): TierLimits {
    return {
      creditsMonthly: Infinity,
      maxRollover: Infinity,
      maxDurationMinutes: 30,
      interactionsPerPodcast: Infinity,
      canDownload: true,
      canMakePrivate: true,
      voiceCount: 10,
    };
  }

  async createCheckoutSession(_params: CheckoutParams): Promise<string> {
    logger.warn('Payment provider is "none" — checkout is disabled');
    return '';
  }

  async createPortalSession(_customerId: string, returnUrl: string): Promise<string> {
    logger.warn('Payment provider is "none" — portal is disabled');
    return returnUrl;
  }
}

export function createPaymentProvider(type?: string): PaymentProvider {
  const providerType = type || process.env.PAYMENT_PROVIDER || 'stripe';
  switch (providerType) {
    case 'stripe':
      return new StripeProvider();
    case 'none':
      return new NoOpProvider();
    default:
      logger.warn(`Unknown PAYMENT_PROVIDER "${providerType}", falling back to stripe`);
      return new StripeProvider();
  }
}
