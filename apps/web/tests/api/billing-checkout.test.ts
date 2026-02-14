import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockCreateCheckoutSession = vi.fn();

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
  createCheckoutSession: (...args: unknown[]) => mockCreateCheckoutSession(...args),
}));

import { POST } from '@/app/api/billing/checkout/route';

function createRequest(body: Record<string, unknown>): NextRequest {
  const url = new URL('http://localhost:3000/api/billing/checkout');
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/billing/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest({ type: 'subscription', tier: 'pro' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when session exists but user.id is missing', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createRequest({ type: 'subscription', tier: 'pro' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when type discriminator is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const request = createRequest({});
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when tier is invalid', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const request = createRequest({ type: 'subscription', tier: 'free' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when tier is not a string', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const request = createRequest({ type: 'subscription', tier: 123 });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when tier is an empty string', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const request = createRequest({ type: 'subscription', tier: '' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when user email is not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue(null);

    const request = createRequest({ type: 'subscription', tier: 'pro' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'User email not found' });
  });

  it('returns 400 when user exists but email is null', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({ email: null });

    const request = createRequest({ type: 'subscription', tier: 'pro' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'User email not found' });
  });

  it('successfully creates checkout session for PRO tier', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({ email: 'user@example.com' });
    mockCreateCheckoutSession.mockResolvedValue('https://checkout.stripe.com/pay/session_123');

    const request = createRequest({ type: 'subscription', tier: 'pro' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ url: 'https://checkout.stripe.com/pay/session_123' });
  });

  it('successfully creates checkout session for STARTER tier', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });
    mockUserFindUnique.mockResolvedValue({ email: 'starter@example.com' });
    mockCreateCheckoutSession.mockResolvedValue('https://checkout.stripe.com/pay/session_456');

    const request = createRequest({ type: 'subscription', tier: 'starter' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ url: 'https://checkout.stripe.com/pay/session_456' });
  });

  it('successfully creates checkout session for STUDIO tier', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-3' } });
    mockUserFindUnique.mockResolvedValue({ email: 'studio@example.com' });
    mockCreateCheckoutSession.mockResolvedValue('https://checkout.stripe.com/pay/session_789');

    const request = createRequest({ type: 'subscription', tier: 'studio' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ url: 'https://checkout.stripe.com/pay/session_789' });
  });

  it('successfully creates checkout session for 3-credit pack', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-4' } });
    mockUserFindUnique.mockResolvedValue({ email: 'user@example.com' });
    mockCreateCheckoutSession.mockResolvedValue('https://checkout.stripe.com/pay/session_credits');

    const request = createRequest({ type: 'credit_pack', credits: 3 });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ url: 'https://checkout.stripe.com/pay/session_credits' });
  });

  it('successfully creates checkout session for 10-credit pack', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-5' } });
    mockUserFindUnique.mockResolvedValue({ email: 'user@example.com' });
    mockCreateCheckoutSession.mockResolvedValue(
      'https://checkout.stripe.com/pay/session_credits_10'
    );

    const request = createRequest({ type: 'credit_pack', credits: 10 });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ url: 'https://checkout.stripe.com/pay/session_credits_10' });
  });

  it('successfully creates checkout session for 25-credit pack', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-6' } });
    mockUserFindUnique.mockResolvedValue({ email: 'user@example.com' });
    mockCreateCheckoutSession.mockResolvedValue(
      'https://checkout.stripe.com/pay/session_credits_25'
    );

    const request = createRequest({ type: 'credit_pack', credits: 25 });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ url: 'https://checkout.stripe.com/pay/session_credits_25' });
  });

  it('returns 400 for invalid credit pack amount', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-7' } });
    mockUserFindUnique.mockResolvedValue({ email: 'user@example.com' });

    const request = createRequest({ type: 'credit_pack', credits: 5 });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  it('returns 500 when Stripe createCheckoutSession throws an error', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({ email: 'user@example.com' });
    mockCreateCheckoutSession.mockRejectedValue(new Error('Stripe API error'));

    const request = createRequest({ type: 'subscription', tier: 'pro' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Stripe API error' });
  });

  it('returns 500 with generic message when non-Error is thrown', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({ email: 'user@example.com' });
    mockCreateCheckoutSession.mockRejectedValue('unknown error');

    const request = createRequest({ type: 'subscription', tier: 'pro' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to create checkout session' });
  });

  it('handles Stripe not configured error gracefully', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({ email: 'user@example.com' });
    mockCreateCheckoutSession.mockRejectedValue(new Error('Stripe not configured'));

    const request = createRequest({ type: 'subscription', tier: 'pro' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Stripe not configured' });
  });

  it('uses correct origin from request for success and cancel URLs', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({ email: 'user@example.com' });
    mockCreateCheckoutSession.mockResolvedValue('https://checkout.stripe.com/session');

    const url = new URL('https://sotto.fm/api/billing/checkout');
    const request = new NextRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'subscription', tier: 'pro' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('url');
  });
});
