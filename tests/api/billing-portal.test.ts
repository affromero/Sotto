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
    expect(mockPrismaSubscriptionFindUnique).not.toHaveBeenCalled();
    expect(mockCreatePortalSession).not.toHaveBeenCalled();
  });

  it('returns 401 when session has no user', async () => {
    mockAuth.mockResolvedValue({ user: null });

    const request = createMockRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: 'Unauthorized' });
    expect(mockPrismaSubscriptionFindUnique).not.toHaveBeenCalled();
  });

  it('returns 401 when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: { id: null } });

    const request = createMockRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: 'Unauthorized' });
    expect(mockPrismaSubscriptionFindUnique).not.toHaveBeenCalled();
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
    expect(mockPrismaSubscriptionFindUnique).toHaveBeenCalledWith({
      where: { userId: 'user-001' },
      select: { stripeCustomerId: true },
    });
    expect(mockCreatePortalSession).not.toHaveBeenCalled();
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
    expect(mockCreatePortalSession).not.toHaveBeenCalled();
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
    expect(mockCreatePortalSession).not.toHaveBeenCalled();
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
    expect(mockCreatePortalSession).toHaveBeenCalledWith(
      'cus_test123',
      'http://localhost:3000/billing'
    );
  });

  it('uses request origin for return URL', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-005' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue({
      stripeCustomerId: 'cus_test456',
    });
    mockCreatePortalSession.mockResolvedValue('https://billing.stripe.com/session/test2');

    const request = createMockRequest('https://sotto.fm');
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockCreatePortalSession).toHaveBeenCalledWith('cus_test456', 'https://sotto.fm/billing');
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
    expect(mockCreatePortalSession).toHaveBeenCalledWith(
      'cus_test789',
      'http://localhost:3000/billing'
    );
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

  it('queries subscription with correct user id', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-specific-123' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue({
      stripeCustomerId: 'cus_specific',
    });
    mockCreatePortalSession.mockResolvedValue('https://billing.stripe.com/portal');

    const request = createMockRequest();
    await POST(request);

    expect(mockPrismaSubscriptionFindUnique).toHaveBeenCalledWith({
      where: { userId: 'user-specific-123' },
      select: { stripeCustomerId: true },
    });
  });

  it('passes correct return URL path to createPortalSession', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-008' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue({
      stripeCustomerId: 'cus_returnurl_test',
    });
    mockCreatePortalSession.mockResolvedValue('https://portal.url');

    const request = createMockRequest('https://app.example.com:3000');
    await POST(request);

    expect(mockCreatePortalSession).toHaveBeenCalledWith(
      'cus_returnurl_test',
      'https://app.example.com:3000/billing'
    );
  });

  it('handles successful portal creation with valid customer ID', async () => {
    const validCustomerId = 'cus_MZzGJQcWzv7AmR';
    mockAuth.mockResolvedValue({ user: { id: 'user-009' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue({
      stripeCustomerId: validCustomerId,
    });
    const expectedUrl = 'https://billing.stripe.com/p/session_1234567890';
    mockCreatePortalSession.mockResolvedValue(expectedUrl);

    const request = createMockRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.url).toBe(expectedUrl);
    expect(mockCreatePortalSession).toHaveBeenCalledWith(
      validCustomerId,
      'http://localhost:3000/billing'
    );
  });
});
