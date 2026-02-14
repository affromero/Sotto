import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockAuth = vi.fn();
const mockSubscriptionFindUnique = vi.fn();
const mockCheckoutSessionCreate = vi.fn();
const mockSubscriptionsCancel = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();

let mockStripeValue = {
  checkout: {
    sessions: {
      create: (...args: unknown[]) => mockCheckoutSessionCreate(...args),
    },
  },
  subscriptions: {
    cancel: (...args: unknown[]) => mockSubscriptionsCancel(...args),
  },
};

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
  get stripe() {
    return mockStripeValue;
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: vi.fn(),
  },
}));

const originalEnv = {
  STRIPE_PRICE_ID_VOICE_CREATOR_ADDON: process.env.STRIPE_PRICE_ID_VOICE_CREATOR_ADDON,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
};

beforeEach(() => {
  process.env.STRIPE_PRICE_ID_VOICE_CREATOR_ADDON = 'price_addon_123';
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterEach(() => {
  process.env.STRIPE_PRICE_ID_VOICE_CREATOR_ADDON = originalEnv.STRIPE_PRICE_ID_VOICE_CREATOR_ADDON;
  process.env.NEXTAUTH_URL = originalEnv.NEXTAUTH_URL;
});

import { POST, DELETE } from '@/app/api/billing/voice-creator-addon/route';

const mockSession = {
  user: {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: '2025-12-31',
};

const mockStudioSubscription = {
  tier: 'STUDIO',
  voiceCreatorAddonActive: false,
  stripeCustomerId: 'cus_123',
};

describe('POST /api/billing/voice-creator-addon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when user email is missing', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Test User' },
      expires: '2025-12-31',
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 500 when Stripe not configured', async () => {
    mockAuth.mockResolvedValue(mockSession);
    const originalStripe = mockStripeValue;
    mockStripeValue = null as unknown as typeof mockStripeValue;

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Stripe not configured' });

    mockStripeValue = originalStripe;
  });

  it('returns 500 when price ID not configured', async () => {
    mockAuth.mockResolvedValue(mockSession);
    delete process.env.STRIPE_PRICE_ID_VOICE_CREATOR_ADDON;

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Voice Creator add-on not configured' });
  });

  it('returns 403 when not Studio tier', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({
      tier: 'PRO',
      voiceCreatorAddonActive: false,
      stripeCustomerId: 'cus_123',
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Voice Creator add-on requires Studio tier' });
  });

  it('returns 403 when subscription is null', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue(null);

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Voice Creator add-on requires Studio tier' });
  });

  it('returns 409 when addon already active', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({
      tier: 'STUDIO',
      voiceCreatorAddonActive: true,
      stripeCustomerId: 'cus_123',
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: 'Voice Creator add-on is already active' });
  });

  it('returns 200 with checkout URL on success', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue(mockStudioSubscription);
    mockCheckoutSessionCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/session_123',
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ url: 'https://checkout.stripe.com/session_123' });
    expect(mockCheckoutSessionCreate).toHaveBeenCalledWith({
      mode: 'subscription',
      customer: 'cus_123',
      line_items: [{ price: 'price_addon_123', quantity: 1 }],
      success_url: 'http://localhost:3000/settings/voices?addon=success',
      cancel_url: 'http://localhost:3000/settings/voices?addon=cancel',
      metadata: {
        userId: 'user-1',
        type: 'voice_creator_addon',
      },
    });
    expect(mockLoggerInfo).toHaveBeenCalledWith('Voice Creator addon checkout created', {
      userId: 'user-1',
    });
  });
});

describe('DELETE /api/billing/voice-creator-addon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await DELETE();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 500 when Stripe not configured', async () => {
    mockAuth.mockResolvedValue(mockSession);
    const originalStripe = mockStripeValue;
    mockStripeValue = null as unknown as typeof mockStripeValue;

    const response = await DELETE();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Stripe not configured' });

    mockStripeValue = originalStripe;
  });

  it('returns 404 when no active addon', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({
      voiceCreatorAddonActive: false,
      voiceCreatorAddonStripeSubscriptionId: null,
    });

    const response = await DELETE();
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'No active Voice Creator add-on to cancel' });
  });

  it('returns 404 when subscription is null', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue(null);

    const response = await DELETE();
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'No active Voice Creator add-on to cancel' });
  });

  it('returns 404 when addon active but subscription ID is null', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({
      voiceCreatorAddonActive: true,
      voiceCreatorAddonStripeSubscriptionId: null,
    });

    const response = await DELETE();
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'No active Voice Creator add-on to cancel' });
  });

  it('returns 200 on successful cancellation', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({
      voiceCreatorAddonActive: true,
      voiceCreatorAddonStripeSubscriptionId: 'sub_addon_123',
    });
    mockSubscriptionsCancel.mockResolvedValue({});

    const response = await DELETE();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mockSubscriptionsCancel).toHaveBeenCalledWith('sub_addon_123');
    expect(mockLoggerInfo).toHaveBeenCalledWith('Voice Creator addon cancelled', {
      userId: 'user-1',
    });
  });
});
