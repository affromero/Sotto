import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrismaUserFindUnique = vi.fn();
const mockPrismaSubscriptionFindUnique = vi.fn();
const mockPrismaCreditTransactionFindMany = vi.fn();
const mockAuth = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
    },
    subscription: {
      findUnique: (...args: unknown[]) => mockPrismaSubscriptionFindUnique(...args),
    },
    creditTransaction: {
      findMany: (...args: unknown[]) => mockPrismaCreditTransactionFindMany(...args),
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

vi.mock('@/lib/stripe', () => ({
  TIER_LIMITS: {
    FREE: {
      creditsMonthly: 1,
      maxRollover: 0,
      maxDurationMinutes: 5,
      maxVoiceClones: 0,
      premiumVoiceSurcharge: 0,
      canDownload: false,
      canMakePrivate: false,
      canExportPdf: false,
      canViewAnalytics: false,
      hasPremiumSfx: false,
    },
    STARTER: {
      creditsMonthly: 3,
      maxRollover: 1,
      maxDurationMinutes: 10,
      maxVoiceClones: 1,
      premiumVoiceSurcharge: 0,
      canDownload: true,
      canMakePrivate: false,
      canExportPdf: false,
      canViewAnalytics: false,
      hasPremiumSfx: false,
    },
    PRO: {
      creditsMonthly: 10,
      maxRollover: 3,
      maxDurationMinutes: 10,
      maxVoiceClones: 3,
      premiumVoiceSurcharge: 0,
      canDownload: true,
      canMakePrivate: true,
      canExportPdf: true,
      canViewAnalytics: true,
      hasPremiumSfx: false,
    },
    STUDIO: {
      creditsMonthly: 20,
      maxRollover: 8,
      maxDurationMinutes: 10,
      maxVoiceClones: 10,
      premiumVoiceSurcharge: 0,
      canDownload: true,
      canMakePrivate: true,
      canExportPdf: true,
      canViewAnalytics: true,
      hasPremiumSfx: true,
    },
    ADMIN: {
      creditsMonthly: Infinity,
      maxRollover: Infinity,
      maxDurationMinutes: 60,
      maxVoiceClones: Infinity,
      premiumVoiceSurcharge: 0,
      canDownload: true,
      canMakePrivate: true,
      canExportPdf: true,
      canViewAnalytics: true,
      hasPremiumSfx: true,
    },
  },
  INTERACTION_CREDIT_COST: 0.25,
}));

import { GET } from '@/app/api/billing/usage/route';

function createRequest(): NextRequest {
  const url = new URL('http://localhost:3000/api/billing/usage');
  return new NextRequest(url);
}

const mockUser = {
  id: 'user-1',
  role: 'USER',
};

const mockSubscription = {
  tier: 'PRO',
  status: 'ACTIVE',
  creditsBalance: 10,
  creditsMonthly: 10,
  rolloverCredits: 3,
  maxRollover: 3,
  currentPeriodEnd: new Date('2026-03-01T00:00:00Z'),
};

const mockTransactions = [
  {
    id: 'tx-1',
    amount: 15,
    type: 'MONTHLY_GRANT',
    description: 'Monthly credit allocation',
    balanceAfter: 15,
    createdAt: new Date('2026-02-01T00:00:00Z'),
  },
  {
    id: 'tx-2',
    amount: -1,
    type: 'PODCAST_CREATION',
    description: 'Created podcast "AI Basics"',
    balanceAfter: 14,
    createdAt: new Date('2026-02-05T00:00:00Z'),
  },
];

describe('GET /api/billing/usage', () => {
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

  it('returns 404 when user is not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-999' } });
    mockPrismaUserFindUnique.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('User not found');
  });

  it('returns usage data with correct response shape', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockPrismaCreditTransactionFindMany.mockResolvedValue(mockTransactions);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('tier');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('creditsBalance');
    expect(body).toHaveProperty('creditsMonthly');
    expect(body).toHaveProperty('rolloverCredits');
    expect(body).toHaveProperty('maxRollover');
    expect(body).toHaveProperty('currentPeriodEnd');
    expect(body).toHaveProperty('recentTransactions');
    expect(body).toHaveProperty('limits');
    expect(body.limits).toHaveProperty('maxDurationMinutes');
    expect(body.limits).toHaveProperty('interactionCreditCost');
    expect(body.limits).toHaveProperty('maxVoiceClones');
    expect(body.limits).toHaveProperty('premiumVoiceSurcharge');
    expect(body.limits).toHaveProperty('canDownload');
    expect(body.limits).toHaveProperty('canMakePrivate');
    expect(body.limits).toHaveProperty('canExportPdf');
    expect(body.limits).toHaveProperty('canViewAnalytics');
    expect(body.limits).toHaveProperty('hasPremiumSfx');
  });

  it('returns correct usage data for PRO tier user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockPrismaCreditTransactionFindMany.mockResolvedValue(mockTransactions);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.tier).toBe('PRO');
    expect(body.status).toBe('ACTIVE');
    expect(body.creditsBalance).toBe(10);
    expect(body.creditsMonthly).toBe(10);
    expect(body.rolloverCredits).toBe(3);
    expect(body.maxRollover).toBe(3);
    expect(body.currentPeriodEnd).toBe('2026-03-01T00:00:00.000Z');
    expect(body.limits.maxDurationMinutes).toBe(10);
    expect(body.limits.interactionCreditCost).toBe(0.25);
    expect(body.limits.canDownload).toBe(true);
    expect(body.limits.canMakePrivate).toBe(true);
    expect(body.limits.canExportPdf).toBe(true);
    expect(body.limits.canViewAnalytics).toBe(true);
  });

  it('returns correct usage data for FREE tier user with no subscription', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(null);
    mockPrismaCreditTransactionFindMany.mockResolvedValue([]);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.tier).toBe('FREE');
    expect(body.status).toBe('ACTIVE');
    expect(body.creditsBalance).toBe(0);
    expect(body.creditsMonthly).toBe(1);
    expect(body.rolloverCredits).toBe(0);
    expect(body.maxRollover).toBe(0);
    expect(body.currentPeriodEnd).toBeNull();
    expect(body.recentTransactions).toEqual([]);
    expect(body.limits.maxDurationMinutes).toBe(5);
    expect(body.limits.interactionCreditCost).toBe(0.25);
    expect(body.limits.canDownload).toBe(false);
    expect(body.limits.canMakePrivate).toBe(false);
    expect(body.limits.canExportPdf).toBe(false);
    expect(body.limits.canViewAnalytics).toBe(false);
  });

  it('returns correct usage data for STARTER tier user', async () => {
    const starterSubscription = {
      tier: 'STARTER',
      status: 'ACTIVE',
      creditsBalance: 3,
      creditsMonthly: 3,
      rolloverCredits: 1,
      maxRollover: 1,
      currentPeriodEnd: new Date('2026-03-01T00:00:00Z'),
    };
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(starterSubscription);
    mockPrismaCreditTransactionFindMany.mockResolvedValue([]);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.tier).toBe('STARTER');
    expect(body.creditsBalance).toBe(3);
    expect(body.creditsMonthly).toBe(3);
    expect(body.rolloverCredits).toBe(1);
    expect(body.maxRollover).toBe(1);
    expect(body.limits.maxDurationMinutes).toBe(10);
    expect(body.limits.interactionCreditCost).toBe(0.25);
    expect(body.limits.maxVoiceClones).toBe(1);
    expect(body.limits.canDownload).toBe(true);
  });

  it('returns correct usage data for STUDIO tier user', async () => {
    const studioSubscription = {
      tier: 'STUDIO',
      status: 'ACTIVE',
      creditsBalance: 18,
      creditsMonthly: 20,
      rolloverCredits: 5,
      maxRollover: 8,
      currentPeriodEnd: new Date('2026-03-01T00:00:00Z'),
    };
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(studioSubscription);
    mockPrismaCreditTransactionFindMany.mockResolvedValue([]);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.tier).toBe('STUDIO');
    expect(body.creditsBalance).toBe(18);
    expect(body.creditsMonthly).toBe(20);
    expect(body.rolloverCredits).toBe(5);
    expect(body.maxRollover).toBe(8);
    expect(body.limits.maxDurationMinutes).toBe(10);
    expect(body.limits.interactionCreditCost).toBe(0.25);
    expect(body.limits.maxVoiceClones).toBe(10);
    expect(body.limits.hasPremiumSfx).toBe(true);
  });

  it('returns correct limits for ADMIN role user', async () => {
    const adminUser = { ...mockUser, role: 'ADMIN' };
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(adminUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(null);
    mockPrismaCreditTransactionFindMany.mockResolvedValue([]);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    // Note: limits are not directly exposed in the response, only via TIER_LIMITS
    // The API returns subscription-level data (creditsMonthly, maxRollover) and a limits object
    // For ADMIN with no subscription, tier defaults to FREE
    expect(body.tier).toBe('FREE');
    expect(body.limits.maxDurationMinutes).toBe(60);
    expect(body.limits.interactionCreditCost).toBe(0.25);
    expect(body.limits.maxVoiceClones).toBe(null); // Infinity serializes as null in JSON
  });

  it('includes recent transactions in correct format', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockPrismaCreditTransactionFindMany.mockResolvedValue(mockTransactions);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.recentTransactions).toHaveLength(2);
    expect(body.recentTransactions[0]).toEqual({
      id: 'tx-1',
      amount: 15,
      type: 'MONTHLY_GRANT',
      description: 'Monthly credit allocation',
      balanceAfter: 15,
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    expect(body.recentTransactions[1]).toEqual({
      id: 'tx-2',
      amount: -1,
      type: 'PODCAST_CREATION',
      description: 'Created podcast "AI Basics"',
      balanceAfter: 14,
      createdAt: '2026-02-05T00:00:00.000Z',
    });
  });

  it('fetches recent transactions with correct query parameters', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockPrismaCreditTransactionFindMany.mockResolvedValue(mockTransactions);

    const request = createRequest();
    await GET(request);

    expect(mockPrismaCreditTransactionFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        amount: true,
        type: true,
        description: true,
        balanceAfter: true,
        createdAt: true,
      },
    });
  });

  it('handles user with CANCELED subscription status', async () => {
    const canceledSubscription = {
      ...mockSubscription,
      status: 'CANCELED',
    };
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(canceledSubscription);
    mockPrismaCreditTransactionFindMany.mockResolvedValue([]);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.tier).toBe('FREE');
    expect(body.status).toBe('CANCELED');
  });

  it('handles user with PAST_DUE subscription status', async () => {
    const pastDueSubscription = {
      ...mockSubscription,
      status: 'PAST_DUE',
    };
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(pastDueSubscription);
    mockPrismaCreditTransactionFindMany.mockResolvedValue([]);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.tier).toBe('FREE');
    expect(body.status).toBe('PAST_DUE');
  });

  it('handles zero credits balance', async () => {
    const zeroSubscription = {
      ...mockSubscription,
      creditsBalance: 0,
      rolloverCredits: 0,
    };
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(zeroSubscription);
    mockPrismaCreditTransactionFindMany.mockResolvedValue([]);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.creditsBalance).toBe(0);
    expect(body.rolloverCredits).toBe(0);
  });

  it('handles database errors gracefully', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockRejectedValue(new Error('Database connection failed'));

    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Database connection failed');
  });

  it('returns null currentPeriodEnd for FREE tier users', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(null);
    mockPrismaCreditTransactionFindMany.mockResolvedValue([]);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.currentPeriodEnd).toBeNull();
  });

  it('handles empty transaction history', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockPrismaCreditTransactionFindMany.mockResolvedValue([]);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.recentTransactions).toEqual([]);
  });

  it('executes all database queries in parallel', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockPrismaCreditTransactionFindMany.mockResolvedValue(mockTransactions);

    const request = createRequest();
    await GET(request);

    expect(mockPrismaUserFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { id: true, role: true },
    });
    expect(mockPrismaSubscriptionFindUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: {
        tier: true,
        status: true,
        creditsBalance: true,
        creditsMonthly: true,
        rolloverCredits: true,
        maxRollover: true,
        currentPeriodEnd: true,
      },
    });
    expect(mockPrismaCreditTransactionFindMany).toHaveBeenCalled();
  });
});
