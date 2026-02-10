import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockConstructEvent = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();
const mockSubscriptionFindFirst = vi.fn();
const mockSubscriptionFindUnique = vi.fn();
const mockSubscriptionUpsert = vi.fn();
const mockSubscriptionUpdate = vi.fn();
const mockSubscriptionUpdateMany = vi.fn();
const mockSubscriptionEventCreate = vi.fn();
const mockUserUpdate = vi.fn();
const mockResetMonthlyUsage = vi.fn();
const mockAddPurchasedCredits = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerDebug = vi.fn();

let mockStripeValue = {
  webhooks: {
    constructEvent: (...args: unknown[]) => mockConstructEvent(...args),
  },
  subscriptions: {
    retrieve: (...args: unknown[]) => mockSubscriptionsRetrieve(...args),
  },
};

vi.mock('@/lib/stripe', () => ({
  get stripe() {
    return mockStripeValue;
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    subscription: {
      findFirst: (...args: unknown[]) => mockSubscriptionFindFirst(...args),
      findUnique: (...args: unknown[]) => mockSubscriptionFindUnique(...args),
      upsert: (...args: unknown[]) => mockSubscriptionUpsert(...args),
      update: (...args: unknown[]) => mockSubscriptionUpdate(...args),
      updateMany: (...args: unknown[]) => mockSubscriptionUpdateMany(...args),
    },
    subscriptionEvent: {
      create: (...args: unknown[]) => mockSubscriptionEventCreate(...args),
    },
    user: {
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
  },
}));

vi.mock('@/lib/subscription', () => ({
  resetMonthlyUsage: (...args: unknown[]) => mockResetMonthlyUsage(...args),
}));

vi.mock('@/lib/credits', () => ({
  addPurchasedCredits: (...args: unknown[]) => mockAddPurchasedCredits(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    debug: (...args: unknown[]) => mockLoggerDebug(...args),
  },
}));

process.env.STRIPE_PRICE_ID_STARTER = 'price_starter_789';
process.env.STRIPE_PRICE_ID_PRO = 'price_pro_123';
process.env.STRIPE_PRICE_ID_STUDIO = 'price_studio_456';

import { POST } from '@/app/api/webhooks/stripe/route';

const WEBHOOK_SECRET = 'whsec_test_secret';

function createRequest(body: string, signature: string | null = 'valid_sig'): NextRequest {
  const url = new URL('http://localhost:3000/api/webhooks/stripe');
  const headers: Record<string, string> = {};
  if (signature !== null) {
    headers['stripe-signature'] = signature;
  }
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body,
  });
}

describe('POST /api/webhooks/stripe', () => {
  const originalEnv = {
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_ID_STARTER: process.env.STRIPE_PRICE_ID_STARTER,
    STRIPE_PRICE_ID_PRO: process.env.STRIPE_PRICE_ID_PRO,
    STRIPE_PRICE_ID_STUDIO: process.env.STRIPE_PRICE_ID_STUDIO,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserUpdate.mockResolvedValue({});
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.STRIPE_PRICE_ID_STARTER = 'price_starter_789';
    process.env.STRIPE_PRICE_ID_PRO = 'price_pro_123';
    process.env.STRIPE_PRICE_ID_STUDIO = 'price_studio_456';
  });

  afterEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = originalEnv.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_PRICE_ID_STARTER = originalEnv.STRIPE_PRICE_ID_STARTER;
    process.env.STRIPE_PRICE_ID_PRO = originalEnv.STRIPE_PRICE_ID_PRO;
    process.env.STRIPE_PRICE_ID_STUDIO = originalEnv.STRIPE_PRICE_ID_STUDIO;
  });

  describe('signature verification', () => {
    it('returns 400 when stripe-signature header is missing', async () => {
      const request = createRequest('{}', null);
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: 'Missing signature' });
      expect(mockConstructEvent).not.toHaveBeenCalled();
    });

    it('returns 400 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;

      const request = createRequest('{}', 'sig_123');
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: 'Missing signature' });
    });

    it('returns 400 when signature verification fails', async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error('Signature verification failed');
      });

      const request = createRequest('{}', 'invalid_sig');
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: 'Invalid signature' });
      expect(mockLoggerError).toHaveBeenCalledWith('Stripe webhook signature verification failed');
    });

    it('verifies signature with correct parameters', async () => {
      mockConstructEvent.mockReturnValue({
        type: 'unknown.event',
        id: 'evt_123',
        data: { object: {} },
      });

      const rawBody = '{"type":"unknown.event"}';
      const signature = 'sig_valid';
      const request = createRequest(rawBody, signature);
      await POST(request);

      expect(mockConstructEvent).toHaveBeenCalledWith(rawBody, signature, WEBHOOK_SECRET);
    });
  });

  describe('checkout.session.completed', () => {
    it('creates subscription when checkout session has userId metadata', async () => {
      const event = {
        id: 'evt_checkout_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            customer: 'cus_123',
            subscription: 'sub_123',
            metadata: { userId: 'user-1' },
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionsRetrieve.mockResolvedValue({
        id: 'sub_123',
        items: { data: [{ price: { id: 'price_pro_123' } }] },
        current_period_start: 1704067200,
        current_period_end: 1706745600,
      });
      mockSubscriptionUpsert.mockResolvedValue({});
      mockSubscriptionEventCreate.mockResolvedValue({});

      const request = createRequest(JSON.stringify(event), 'sig_123');
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true });

      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_123');
      expect(mockSubscriptionUpsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: {
          userId: 'user-1',
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_123',
          stripePriceId: 'price_pro_123',
          status: 'ACTIVE',
          tier: 'PRO',
          currentPeriodStart: new Date(1704067200 * 1000),
          currentPeriodEnd: new Date(1706745600 * 1000),
        },
        update: {
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_123',
          stripePriceId: 'price_pro_123',
          status: 'ACTIVE',
          tier: 'PRO',
          currentPeriodStart: new Date(1704067200 * 1000),
          currentPeriodEnd: new Date(1706745600 * 1000),
        },
      });

      expect(mockSubscriptionEventCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'checkout.session.completed',
          stripeEventId: 'evt_checkout_123',
          data: event.data.object,
        },
      });

      expect(mockLoggerInfo).toHaveBeenCalledWith('Subscription created via checkout', {
        userId: 'user-1',
        tier: 'PRO',
      });
    });

    it('maps STUDIO price ID to STUDIO tier and auto-grants CREATOR role', async () => {
      const event = {
        id: 'evt_checkout_456',
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: 'cus_456',
            subscription: 'sub_456',
            metadata: { userId: 'user-2' },
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionsRetrieve.mockResolvedValue({
        id: 'sub_456',
        items: { data: [{ price: { id: 'price_studio_456' } }] },
        current_period_start: 1704067200,
        current_period_end: 1706745600,
      });
      mockSubscriptionUpsert.mockResolvedValue({});
      mockSubscriptionEventCreate.mockResolvedValue({});

      await POST(createRequest(JSON.stringify(event), 'sig_123'));

      expect(mockSubscriptionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ tier: 'STUDIO' }),
          update: expect.objectContaining({ tier: 'STUDIO' }),
        })
      );
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { role: 'CREATOR' },
      });
    });

    it('defaults to FREE tier for unknown price ID', async () => {
      const event = {
        id: 'evt_checkout_789',
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: 'cus_789',
            subscription: 'sub_789',
            metadata: { userId: 'user-3' },
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionsRetrieve.mockResolvedValue({
        id: 'sub_789',
        items: { data: [{ price: { id: 'price_unknown' } }] },
        current_period_start: 1704067200,
        current_period_end: 1706745600,
      });
      mockSubscriptionUpsert.mockResolvedValue({});
      mockSubscriptionEventCreate.mockResolvedValue({});

      await POST(createRequest(JSON.stringify(event), 'sig_123'));

      expect(mockSubscriptionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ tier: 'FREE' }),
        })
      );
    });

    it('does nothing when userId is missing from metadata', async () => {
      const event = {
        id: 'evt_checkout_no_user',
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: 'cus_123',
            subscription: 'sub_123',
            metadata: {},
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);

      const response = await POST(createRequest(JSON.stringify(event), 'sig_123'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true });
      expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();
      expect(mockSubscriptionUpsert).not.toHaveBeenCalled();
    });

    it('does nothing when subscription is missing from session', async () => {
      const event = {
        id: 'evt_checkout_no_sub',
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: 'cus_123',
            metadata: { userId: 'user-1' },
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);

      const response = await POST(createRequest(JSON.stringify(event), 'sig_123'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true });
      expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();
    });
  });

  describe('customer.subscription.updated', () => {
    it('updates existing subscription status to ACTIVE', async () => {
      const event = {
        id: 'evt_sub_updated',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_123',
            status: 'active',
            items: { data: [{ price: { id: 'price_pro_123' } }] },
            current_period_start: 1706745600,
            current_period_end: 1709337600,
            cancel_at_period_end: false,
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionFindFirst.mockResolvedValueOnce(null);
      mockSubscriptionFindFirst.mockResolvedValueOnce({
        id: 'subscription-db-1',
        userId: 'user-1',
        currentPeriodEnd: new Date(1706745600 * 1000),
      });
      mockSubscriptionUpdate.mockResolvedValue({});

      const response = await POST(createRequest(JSON.stringify(event), 'sig_123'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true });

      expect(mockSubscriptionFindFirst).toHaveBeenCalledWith({
        where: { voiceCreatorAddonStripeSubscriptionId: 'sub_123' },
      });
      expect(mockSubscriptionFindFirst).toHaveBeenCalledWith({
        where: { stripeSubscriptionId: 'sub_123' },
      });

      expect(mockSubscriptionUpdate).toHaveBeenCalledWith({
        where: { id: 'subscription-db-1' },
        data: {
          stripePriceId: 'price_pro_123',
          tier: 'PRO',
          status: 'ACTIVE',
          currentPeriodStart: new Date(1706745600 * 1000),
          currentPeriodEnd: new Date(1709337600 * 1000),
          cancelAtPeriodEnd: false,
        },
      });

      expect(mockLoggerInfo).toHaveBeenCalledWith('Subscription updated', {
        subscriptionId: 'sub_123',
        tier: 'PRO',
      });
    });

    it('updates subscription status to PAST_DUE and auto-grants CREATOR role for STUDIO tier', async () => {
      const event = {
        id: 'evt_past_due',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_456',
            status: 'past_due',
            items: { data: [{ price: { id: 'price_studio_456' } }] },
            current_period_start: 1706745600,
            current_period_end: 1709337600,
            cancel_at_period_end: false,
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionFindFirst.mockResolvedValueOnce(null);
      mockSubscriptionFindFirst.mockResolvedValueOnce({
        id: 'subscription-db-2',
        userId: 'user-2',
        currentPeriodEnd: new Date(1706745600 * 1000),
      });
      mockSubscriptionUpdate.mockResolvedValue({});

      await POST(createRequest(JSON.stringify(event), 'sig_123'));

      expect(mockSubscriptionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PAST_DUE',
            tier: 'STUDIO',
          }),
        })
      );
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { role: 'CREATOR' },
      });
    });

    it('updates subscription status to CANCELED when Stripe status is canceled', async () => {
      const event = {
        id: 'evt_canceled',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_789',
            status: 'canceled',
            items: { data: [{ price: { id: 'price_pro_123' } }] },
            current_period_start: 1706745600,
            current_period_end: 1709337600,
            cancel_at_period_end: false,
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionFindFirst.mockResolvedValueOnce(null);
      mockSubscriptionFindFirst.mockResolvedValueOnce({
        id: 'subscription-db-3',
        userId: 'user-3',
        currentPeriodEnd: new Date(1706745600 * 1000),
      });
      mockSubscriptionUpdate.mockResolvedValue({});

      await POST(createRequest(JSON.stringify(event), 'sig_123'));

      expect(mockSubscriptionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CANCELED',
          }),
        })
      );
    });

    it('sets cancelAtPeriodEnd flag correctly', async () => {
      const event = {
        id: 'evt_cancel_scheduled',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_cancel',
            status: 'active',
            items: { data: [{ price: { id: 'price_pro_123' } }] },
            current_period_start: 1706745600,
            current_period_end: 1709337600,
            cancel_at_period_end: true,
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionFindFirst.mockResolvedValueOnce(null);
      mockSubscriptionFindFirst.mockResolvedValueOnce({
        id: 'subscription-db-4',
        userId: 'user-4',
        currentPeriodEnd: new Date(1706745600 * 1000),
      });
      mockSubscriptionUpdate.mockResolvedValue({});

      await POST(createRequest(JSON.stringify(event), 'sig_123'));

      expect(mockSubscriptionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelAtPeriodEnd: true,
          }),
        })
      );
    });

    it('resets monthly usage when period is renewed', async () => {
      const event = {
        id: 'evt_renewal',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_renewal',
            status: 'active',
            items: { data: [{ price: { id: 'price_pro_123' } }] },
            current_period_start: 1709337600,
            current_period_end: 1711929600,
            cancel_at_period_end: false,
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionFindFirst.mockResolvedValueOnce(null);
      mockSubscriptionFindFirst.mockResolvedValueOnce({
        id: 'subscription-db-5',
        userId: 'user-5',
        currentPeriodEnd: new Date(1706745600 * 1000),
      });
      mockSubscriptionUpdate.mockResolvedValue({});
      mockResetMonthlyUsage.mockResolvedValue(undefined);

      await POST(createRequest(JSON.stringify(event), 'sig_123'));

      expect(mockResetMonthlyUsage).toHaveBeenCalledWith('user-5');
      expect(mockLoggerInfo).toHaveBeenCalledWith('Monthly usage reset on period renewal', {
        userId: 'user-5',
      });
    });

    it('does not reset usage when period has not renewed', async () => {
      const event = {
        id: 'evt_same_period',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_same',
            status: 'active',
            items: { data: [{ price: { id: 'price_pro_123' } }] },
            current_period_start: 1706745600,
            current_period_end: 1709337600,
            cancel_at_period_end: false,
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionFindFirst.mockResolvedValueOnce(null);
      mockSubscriptionFindFirst.mockResolvedValueOnce({
        id: 'subscription-db-6',
        userId: 'user-6',
        currentPeriodEnd: new Date(1709337600 * 1000),
      });
      mockSubscriptionUpdate.mockResolvedValue({});

      await POST(createRequest(JSON.stringify(event), 'sig_123'));

      expect(mockResetMonthlyUsage).not.toHaveBeenCalled();
    });

    it('does nothing when subscription is not found in database', async () => {
      const event = {
        id: 'evt_not_found',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_not_found',
            status: 'active',
            items: { data: [{ price: { id: 'price_pro_123' } }] },
            current_period_start: 1706745600,
            current_period_end: 1709337600,
            cancel_at_period_end: false,
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionFindFirst.mockResolvedValueOnce(null);
      mockSubscriptionFindFirst.mockResolvedValueOnce(null);

      const response = await POST(createRequest(JSON.stringify(event), 'sig_123'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true });
      expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
      expect(mockResetMonthlyUsage).not.toHaveBeenCalled();
    });
  });

  describe('customer.subscription.deleted', () => {
    it('sets subscription status to CANCELED and tier to FREE', async () => {
      const event = {
        id: 'evt_deleted',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_deleted',
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionUpdateMany.mockResolvedValue({ count: 1 });

      const response = await POST(createRequest(JSON.stringify(event), 'sig_123'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true });

      expect(mockSubscriptionUpdateMany).toHaveBeenCalledWith({
        where: { stripeSubscriptionId: 'sub_deleted' },
        data: { status: 'CANCELED', tier: 'FREE' },
      });

      expect(mockLoggerInfo).toHaveBeenCalledWith('Subscription deleted', {
        subscriptionId: 'sub_deleted',
      });
    });

    it('handles deletion of non-existent subscription gracefully', async () => {
      const event = {
        id: 'evt_deleted_none',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_none',
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionUpdateMany.mockResolvedValue({ count: 0 });

      const response = await POST(createRequest(JSON.stringify(event), 'sig_123'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true });
      expect(mockLoggerInfo).toHaveBeenCalled();
    });
  });

  describe('unknown event types', () => {
    it('logs debug message for unhandled event types', async () => {
      const event = {
        id: 'evt_unknown',
        type: 'invoice.payment_succeeded',
        data: {
          object: {},
        },
      };

      mockConstructEvent.mockReturnValue(event);

      const response = await POST(createRequest(JSON.stringify(event), 'sig_123'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true });
      expect(mockLoggerDebug).toHaveBeenCalledWith('Unhandled Stripe event', {
        type: 'invoice.payment_succeeded',
      });
    });

    it('returns success for invoice.payment_failed event', async () => {
      const event = {
        id: 'evt_payment_failed',
        type: 'invoice.payment_failed',
        data: {
          object: {},
        },
      };

      mockConstructEvent.mockReturnValue(event);

      const response = await POST(createRequest(JSON.stringify(event), 'sig_123'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true });
      expect(mockLoggerDebug).toHaveBeenCalledWith('Unhandled Stripe event', {
        type: 'invoice.payment_failed',
      });
    });

    it('handles any unknown event type gracefully', async () => {
      const event = {
        id: 'evt_random',
        type: 'payment_method.attached',
        data: {
          object: {},
        },
      };

      mockConstructEvent.mockReturnValue(event);

      const response = await POST(createRequest(JSON.stringify(event), 'sig_123'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true });
    });
  });

  describe('voice creator addon lifecycle', () => {
    it('activates addon on checkout.session.completed with type voice_creator_addon', async () => {
      const event = {
        id: 'evt_addon_checkout',
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: 'cus_addon',
            subscription: 'sub_addon_123',
            metadata: { userId: 'user-addon', type: 'voice_creator_addon' },
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionUpdate.mockResolvedValue({});

      const response = await POST(createRequest(JSON.stringify(event), 'sig_123'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true });
      expect(mockSubscriptionUpdate).toHaveBeenCalledWith({
        where: { userId: 'user-addon' },
        data: {
          voiceCreatorAddonActive: true,
          voiceCreatorAddonStripeSubscriptionId: 'sub_addon_123',
        },
      });
      expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();
    });

    it('updates addon active status on subscription.updated', async () => {
      const event = {
        id: 'evt_addon_updated',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_addon_123',
            status: 'active',
            items: { data: [{ price: { id: 'price_addon' } }] },
            current_period_start: 1706745600,
            current_period_end: 1709337600,
            cancel_at_period_end: false,
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionFindFirst.mockResolvedValueOnce({
        id: 'subscription-addon-db',
        userId: 'user-addon',
      });
      mockSubscriptionUpdate.mockResolvedValue({});

      const response = await POST(createRequest(JSON.stringify(event), 'sig_123'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true });
      expect(mockSubscriptionUpdate).toHaveBeenCalledWith({
        where: { id: 'subscription-addon-db' },
        data: { voiceCreatorAddonActive: true },
      });
    });

    it('deactivates addon on subscription.deleted', async () => {
      const event = {
        id: 'evt_addon_deleted',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_addon_123',
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);
      mockSubscriptionFindFirst.mockResolvedValueOnce({
        id: 'subscription-addon-db',
        userId: 'user-addon',
      });
      mockSubscriptionUpdate.mockResolvedValue({});

      const response = await POST(createRequest(JSON.stringify(event), 'sig_123'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ received: true });
      expect(mockSubscriptionUpdate).toHaveBeenCalledWith({
        where: { id: 'subscription-addon-db' },
        data: {
          voiceCreatorAddonActive: false,
          voiceCreatorAddonStripeSubscriptionId: null,
        },
      });
      expect(mockSubscriptionUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('Stripe not configured', () => {
    it('returns 500 when stripe client is null', async () => {
      const originalStripe = mockStripeValue;
      mockStripeValue = null as unknown as typeof mockStripeValue;

      const request = createRequest('{}', 'sig_123');
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({ error: 'Stripe not configured' });

      mockStripeValue = originalStripe;
    });
  });
});
