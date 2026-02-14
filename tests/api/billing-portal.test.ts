import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuth = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

const mockPrismaSubscriptionFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    subscription: {
      findUnique: (...args: unknown[]) => mockPrismaSubscriptionFindUnique(...args),
    },
  },
}));

const mockCreatePortalSession = vi.fn();

vi.mock('@/lib/stripe', () => ({
  createPortalSession: (...args: unknown[]) => mockCreatePortalSession(...args),
}));

const mockLogger = {
  error: vi.fn(),
};

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
}));

// ---- Import under test ----
import { POST } from '@/app/api/billing/portal/route';

// ---- Helpers ----

function createMockRequest(origin = 'http://localhost:3000'): NextRequest {
  return {
    nextUrl: {
      origin,
    },
  } as NextRequest;
}

// ---- Tests ----

describe('POST /api/billing/portal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 for unauthenticated user', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createMockRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user', async () => {
    mockAuth.mockResolvedValue({ user: null });

    const request = createMockRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: { id: null } });

    const request = createMockRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when user has no subscription', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue(null);

    const request = createMockRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'No active subscription found. Please subscribe first.',
    });
  });

  it('returns 400 when subscription has no stripeCustomerId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-002' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue({
      stripeCustomerId: null,
    });

    const request = createMockRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'No active subscription found. Please subscribe first.',
    });
  });

  it('returns 400 when subscription has empty stripeCustomerId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-003' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue({
      stripeCustomerId: '',
    });

    const request = createMockRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'No active subscription found. Please subscribe first.',
    });
  });

  it('successfully creates portal session and returns URL', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-004' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue({
      stripeCustomerId: 'cus_test123',
    });
    mockCreatePortalSession.mockResolvedValue('https://billing.stripe.com/session/test');

    const request = createMockRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ url: 'https://billing.stripe.com/session/test' });
  });

  it('uses request origin for return URL', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-005' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue({
      stripeCustomerId: 'cus_test456',
    });
    mockCreatePortalSession.mockResolvedValue('https://billing.stripe.com/session/test2');

    const request = createMockRequest('https://sotto.fm');
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('url');
  });

  it('returns 500 when Stripe createPortalSession throws error', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-006' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue({
      stripeCustomerId: 'cus_test789',
    });
    mockCreatePortalSession.mockRejectedValue(new Error('Stripe API error'));

    const request = createMockRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: 'Stripe API error' });
  });

  it('returns 500 with generic message for non-Error exceptions', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-007' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue({
      stripeCustomerId: 'cus_test_nonstandard',
    });
    mockCreatePortalSession.mockRejectedValue('Something went wrong');

    const request = createMockRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: 'Failed to create portal session' });
  });

});
