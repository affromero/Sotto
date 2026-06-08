import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockSubscriptionFindUnique = vi.fn();
const mockPortalSessionsCreate = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    subscription: {
      findUnique: (...args: unknown[]) => mockSubscriptionFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    billingPortal: {
      sessions: {
        create: (...args: unknown[]) => mockPortalSessionsCreate(...args),
      },
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/billing/portal/route';

function createRequest(body?: object): NextRequest {
  const url = new URL('http://localhost:3000/api/billing/portal');
  return new NextRequest(url, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

describe('POST /api/billing/portal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
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

  it('returns 404 when no subscription record exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockSubscriptionFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toContain('No subscription found');
  });

  it('returns 404 when subscription has no stripeCustomerId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockSubscriptionFindUnique.mockResolvedValue({ stripeCustomerId: null });

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toContain('No subscription found');
  });

  it('creates portal session and returns url', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockSubscriptionFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_test_123' });
    mockPortalSessionsCreate.mockResolvedValue({
      url: 'https://billing.stripe.com/session/test_portal',
    });

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe('https://billing.stripe.com/session/test_portal');
  });

  it('passes stripeCustomerId to Stripe portal create call', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockSubscriptionFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_abc_789' });
    mockPortalSessionsCreate.mockResolvedValue({
      url: 'https://billing.stripe.com/session/abc',
    });

    await POST(createRequest());

    expect(mockPortalSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_abc_789' })
    );
  });

  it('uses custom returnUrl from request body', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockSubscriptionFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_test_123' });
    mockPortalSessionsCreate.mockResolvedValue({
      url: 'https://billing.stripe.com/session/custom',
    });

    await POST(createRequest({ returnUrl: 'https://selfhost.example.com/settings' }));

    expect(mockPortalSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ return_url: 'https://selfhost.example.com/settings' })
    );
  });

  it('falls back to default returnUrl when body is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockSubscriptionFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_test_123' });
    mockPortalSessionsCreate.mockResolvedValue({
      url: 'https://billing.stripe.com/session/default',
    });

    await POST(createRequest());

    const callArgs = mockPortalSessionsCreate.mock.calls[0][0];
    expect(callArgs.return_url).toContain('/billing');
  });

  it('returns 500 when Stripe portal create throws', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockSubscriptionFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_test_123' });
    mockPortalSessionsCreate.mockRejectedValue(new Error('Stripe error'));

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: 'Failed to create portal session' });
  });
});
