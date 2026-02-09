import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrismaSubscriptionFindUnique = vi.fn();
const mockAuth = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    subscription: {
      findUnique: (...args: unknown[]) => mockPrismaSubscriptionFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/stripe', async () => ({
  TIER_LIMITS: {
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
  },
}));

import { GET } from '@/app/api/billing/subscription/route';
import { TIER_LIMITS } from '@/lib/stripe';

function createRequest(): NextRequest {
  const url = new URL('http://localhost:3000/api/billing/subscription');
  return new NextRequest(url);
}

const mockActiveSubscription = {
  id: 'sub-1',
  userId: 'user-1',
  stripeCustomerId: 'cus_123',
  stripeSubscriptionId: 'sub_123',
  stripePriceId: 'price_pro',
  status: 'ACTIVE',
  tier: 'PRO',
  currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
  currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
  cancelAtPeriodEnd: false,
  premiumCreditsUsed: 1,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const mockCancelledSubscription = {
  ...mockActiveSubscription,
  status: 'CANCELLED',
  cancelAtPeriodEnd: true,
};

const mockCreatorSubscription = {
  ...mockActiveSubscription,
  id: 'sub-2',
  tier: 'CREATOR',
  stripePriceId: 'price_creator',
  premiumCreditsUsed: 5,
};

describe('GET /api/billing/subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 when user session exists but no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns subscription details for active PRO subscription', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockActiveSubscription);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tier).toBe('PRO');
    expect(body.status).toBe('ACTIVE');
    expect(body.cancelAtPeriodEnd).toBe(false);
    expect(body.currentPeriodEnd).toBe('2026-02-01T00:00:00.000Z');
    expect(body.premiumCreditsUsed).toBe(1);
  });

  it('returns subscription details for active CREATOR subscription', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockCreatorSubscription);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tier).toBe('CREATOR');
    expect(body.status).toBe('ACTIVE');
    expect(body.premiumCreditsUsed).toBe(5);
  });

  it('returns subscription details for cancelled subscription', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockCancelledSubscription);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tier).toBe('FREE');
    expect(body.status).toBe('ACTIVE');
    expect(body.cancelAtPeriodEnd).toBe(false);
  });

  it('returns FREE tier when no subscription exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tier).toBe('FREE');
    expect(body.status).toBe('ACTIVE');
    expect(body.cancelAtPeriodEnd).toBe(false);
    expect(body.currentPeriodEnd).toBeNull();
    expect(body.premiumCreditsUsed).toBe(0);
  });

  it('includes tier limits for FREE tier', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.limits).toEqual(TIER_LIMITS.FREE);
    expect(body.limits.podcastsPerMonth).toBe(2);
    expect(body.limits.interactionsPerPodcast).toBe(2);
    expect(body.limits.premiumVoiceCredits).toBe(0);
  });

  it('includes tier limits for PRO tier', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockActiveSubscription);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.limits).toEqual(TIER_LIMITS.PRO);
    expect(body.limits.podcastsPerMonth).toBe(8);
    expect(body.limits.interactionsPerPodcast).toBe(10);
    expect(body.limits.premiumVoiceCredits).toBe(3);
    expect(body.limits.canDownload).toBe(true);
    expect(body.limits.canExportPdf).toBe(true);
  });

  it('includes tier limits for CREATOR tier', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockCreatorSubscription);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.limits.podcastsPerMonth).toBe(30);
    expect(body.limits.interactionsPerPodcast).toBe(null);
    expect(body.limits.premiumVoiceCredits).toBe(10);
    expect(body.limits.hasPremiumSfx).toBe(true);
    expect(body.limits.canViewAnalytics).toBe(true);
  });

  it('queries subscription with correct user id', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-123' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue(null);

    const request = createRequest();
    await GET(request);

    expect(mockPrismaSubscriptionFindUnique).toHaveBeenCalledWith({
      where: { userId: 'user-123' },
    });
  });

  it('returns currentPeriodStart and currentPeriodEnd for active subscription', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockActiveSubscription);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.currentPeriodStart).toBe('2026-01-01T00:00:00.000Z');
    expect(body.currentPeriodEnd).toBe('2026-02-01T00:00:00.000Z');
  });

  it('handles PENDING subscription status', async () => {
    const pendingSubscription = {
      ...mockActiveSubscription,
      status: 'PENDING',
    };
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaSubscriptionFindUnique.mockResolvedValue(pendingSubscription);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ACTIVE');
    expect(body.tier).toBe('FREE');
  });

  it('handles database errors gracefully', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaSubscriptionFindUnique.mockRejectedValue(new Error('Database connection failed'));

    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });
});
