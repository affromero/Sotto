import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockConstructEvent = vi.fn();
const mockUserUpdateMany = vi.fn();
const mockVoicePurchaseFindUnique = vi.fn();
const mockVoicePurchaseUpdate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      updateMany: (...args: unknown[]) => mockUserUpdateMany(...args),
    },
    voicePurchase: {
      findUnique: (...args: unknown[]) => mockVoicePurchaseFindUnique(...args),
      update: (...args: unknown[]) => mockVoicePurchaseUpdate(...args),
    },
  },
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: (...args: unknown[]) => mockConstructEvent(...args),
    },
  },
  LIMITS: { maxDurationMinutes: 40 },
  PLATFORM_FEE_PERCENT: 10,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/stripe/webhooks/route';

function createWebhookRequest(body: string, signature?: string): NextRequest {
  const url = new URL('http://localhost:3000/api/stripe/webhooks');
  const headers: Record<string, string> = { 'content-type': 'text/plain' };
  if (signature) {
    headers['stripe-signature'] = signature;
  }
  return new NextRequest(url, { method: 'POST', body, headers });
}

describe('POST /api/stripe/webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const request = createWebhookRequest('{}');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Missing signature' });
  });

  it('returns 503 when webhook secret is not configured', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const request = createWebhookRequest('{}', 'sig_test');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'Webhook secret not configured' });
  });

  it('returns 400 when signature verification fails', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    const request = createWebhookRequest('{}', 'sig_invalid');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid signature' });
  });

  it('handles account.updated event and syncs onboarding status', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_123',
          charges_enabled: true,
          payouts_enabled: true,
        },
      },
    });
    mockUserUpdateMany.mockResolvedValue({ count: 1 });

    const request = createWebhookRequest('{}', 'sig_valid');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(mockUserUpdateMany).toHaveBeenCalledWith({
      where: { stripeAccountId: 'acct_123' },
      data: { stripeOnboarded: true },
    });
  });

  it('handles payment_intent.payment_failed and cancels authorized purchase', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.payment_failed',
      data: {
        object: { id: 'pi_123' },
      },
    });
    mockVoicePurchaseFindUnique.mockResolvedValue({
      id: 'vp_1',
      status: 'authorized',
      stripePaymentIntent: 'pi_123',
    });
    mockVoicePurchaseUpdate.mockResolvedValue({});

    const request = createWebhookRequest('{}', 'sig_valid');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(mockVoicePurchaseUpdate).toHaveBeenCalledWith({
      where: { id: 'vp_1' },
      data: { status: 'cancelled' },
    });
  });

  it('skips cancellation when purchase is not in authorized state', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.payment_failed',
      data: {
        object: { id: 'pi_123' },
      },
    });
    mockVoicePurchaseFindUnique.mockResolvedValue({
      id: 'vp_1',
      status: 'captured',
      stripePaymentIntent: 'pi_123',
    });

    const request = createWebhookRequest('{}', 'sig_valid');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(mockVoicePurchaseUpdate).not.toHaveBeenCalled();
  });
});
