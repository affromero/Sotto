import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockCheckoutSessionsCreate = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: {
      sessions: {
        create: (...args: unknown[]) => mockCheckoutSessionsCreate(...args),
      },
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/billing/checkout/route';

function createRequest(body?: object): NextRequest {
  const url = new URL('http://localhost:3000/api/billing/checkout');
  return new NextRequest(url, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

describe('POST /api/billing/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_PRO_PRICE_ID = 'price_test_123';
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://sotto.fm');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 503 when pro price is not configured', async () => {
    delete process.env.STRIPE_PRO_PRICE_ID;
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ error: 'Pro price not configured' });
  });

  it('returns 400 when user is already on Pro', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({
      email: 'user@example.com',
      plan: 'PRO',
      subscription: null,
    });

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Already subscribed to Pro' });
  });

  it('creates checkout session and returns url for free user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({
      email: 'user@example.com',
      plan: 'FREE',
      subscription: null,
    });
    mockCheckoutSessionsCreate.mockResolvedValue({
      id: 'cs_test_abc',
      url: 'https://checkout.stripe.com/pay/cs_test_abc',
    });

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe('https://checkout.stripe.com/pay/cs_test_abc');
  });

  it('reuses existing stripeCustomerId when subscription record exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({
      email: 'user@example.com',
      plan: 'FREE',
      subscription: { stripeCustomerId: 'cus_existing_123' },
    });
    mockCheckoutSessionsCreate.mockResolvedValue({
      id: 'cs_test_def',
      url: 'https://checkout.stripe.com/pay/cs_test_def',
    });

    await POST(createRequest());

    const callArgs = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(callArgs.customer).toBe('cus_existing_123');
    expect(callArgs.customer_email).toBeUndefined();
  });

  it('sets customer_email when no stripeCustomerId exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({
      email: 'new@example.com',
      plan: 'FREE',
      subscription: null,
    });
    mockCheckoutSessionsCreate.mockResolvedValue({
      id: 'cs_test_ghi',
      url: 'https://checkout.stripe.com/pay/cs_test_ghi',
    });

    await POST(createRequest());

    const callArgs = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(callArgs.customer).toBeUndefined();
    expect(callArgs.customer_email).toBe('new@example.com');
  });

  it('accepts custom successUrl and cancelUrl from request body', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({
      email: 'user@example.com',
      plan: 'FREE',
      subscription: null,
    });
    mockCheckoutSessionsCreate.mockResolvedValue({
      id: 'cs_test_jkl',
      url: 'https://checkout.stripe.com/pay/cs_test_jkl',
    });

    await POST(
      createRequest({
        successUrl: 'https://sotto.fm/success',
        cancelUrl: 'https://sotto.fm/cancel',
      })
    );

    const callArgs = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(callArgs.success_url).toBe('https://sotto.fm/success');
    expect(callArgs.cancel_url).toBe('https://sotto.fm/cancel');
  });

  it('embeds userId in session metadata', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-42' } });
    mockUserFindUnique.mockResolvedValue({
      email: 'user@example.com',
      plan: 'FREE',
      subscription: null,
    });
    mockCheckoutSessionsCreate.mockResolvedValue({
      id: 'cs_test_mno',
      url: 'https://checkout.stripe.com/pay/cs_test_mno',
    });

    await POST(createRequest());

    const callArgs = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(callArgs.metadata?.userId).toBe('user-42');
    expect(callArgs.client_reference_id).toBe('user-42');
  });

  it('returns 500 when Stripe throws', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({
      email: 'user@example.com',
      plan: 'FREE',
      subscription: null,
    });
    mockCheckoutSessionsCreate.mockRejectedValue(new Error('Stripe is down'));

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: 'Failed to create checkout session' });
  });
});
