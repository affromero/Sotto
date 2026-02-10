import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getUserTier,
  getUserUsage,
  getUserVoiceCredits,
  resetMonthlyUsage,
} from '@/lib/subscription';
import { prisma } from '@/lib/prisma';
import { TIER_LIMITS } from '@/lib/stripe';
import type { SubscriptionStatus, SubscriptionTier } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    subscription: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/credits', () => ({
  grantMonthlyCredits: vi.fn(),
}));

const mockSubscription = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub1',
  userId: 'user1',
  tier: 'PRO' as SubscriptionTier,
  status: 'ACTIVE' as SubscriptionStatus,
  stripeSubscriptionId: 'sub_123',
  stripePriceId: 'price_123',
  stripeCustomerId: 'cus_123',
  premiumCreditsUsed: 0,
  creditsBalance: 10,
  creditsMonthly: 15,
  rolloverCredits: 0,
  maxRollover: 5,
  cancelAtPeriodEnd: false,
  currentPeriodStart: new Date(),
  currentPeriodEnd: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('getUserTier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns FREE when no subscription exists', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);

    const tier = await getUserTier('user1');

    expect(tier).toBe('FREE');
    expect(prisma.subscription.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user1' },
    });
  });

  it('returns FREE when subscription is not active', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(
      mockSubscription({ status: 'CANCELED' as SubscriptionStatus })
    );

    const tier = await getUserTier('user1');

    expect(tier).toBe('FREE');
  });

  it('returns PRO when subscription is active with PRO tier', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(
      mockSubscription({ tier: 'PRO' as SubscriptionTier, status: 'ACTIVE' as SubscriptionStatus })
    );

    const tier = await getUserTier('user1');

    expect(tier).toBe('PRO');
  });

  it('returns STUDIO when subscription is active with STUDIO tier', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(
      mockSubscription({
        tier: 'STUDIO' as SubscriptionTier,
        status: 'ACTIVE' as SubscriptionStatus,
      })
    );

    const tier = await getUserTier('user1');

    expect(tier).toBe('STUDIO');
  });

  it('returns STARTER when subscription is active with STARTER tier', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(
      mockSubscription({
        tier: 'STARTER' as SubscriptionTier,
        status: 'ACTIVE' as SubscriptionStatus,
      })
    );

    const tier = await getUserTier('user1');

    expect(tier).toBe('STARTER');
  });
});

describe('getUserUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct usage for FREE tier user (no subscription)', async () => {
    // getUserTier call
    vi.mocked(prisma.subscription.findUnique)
      .mockResolvedValueOnce(null) // getUserTier
      .mockResolvedValueOnce(null); // getUserUsage creditsBalance lookup

    const usage = await getUserUsage('user1');

    expect(usage).toEqual({
      tier: 'FREE',
      creditsBalance: 0,
      creditsMonthly: TIER_LIMITS.FREE.creditsMonthly,
      canCreate: false,
    });
  });

  it('returns correct usage for PRO tier user with credits', async () => {
    vi.mocked(prisma.subscription.findUnique)
      .mockResolvedValueOnce(
        mockSubscription({
          tier: 'PRO' as SubscriptionTier,
          status: 'ACTIVE' as SubscriptionStatus,
        })
      )
      .mockResolvedValueOnce(mockSubscription({ creditsBalance: 10 }));

    const usage = await getUserUsage('user1');

    expect(usage).toEqual({
      tier: 'PRO',
      creditsBalance: 10,
      creditsMonthly: TIER_LIMITS.PRO.creditsMonthly,
      canCreate: true,
    });
  });

  it('returns canCreate false when zero credits', async () => {
    vi.mocked(prisma.subscription.findUnique)
      .mockResolvedValueOnce(
        mockSubscription({
          tier: 'PRO' as SubscriptionTier,
          status: 'ACTIVE' as SubscriptionStatus,
        })
      )
      .mockResolvedValueOnce(mockSubscription({ creditsBalance: 0 }));

    const usage = await getUserUsage('user1');

    expect(usage.canCreate).toBe(false);
    expect(usage.creditsBalance).toBe(0);
  });

  it('returns STUDIO tier usage correctly', async () => {
    vi.mocked(prisma.subscription.findUnique)
      .mockResolvedValueOnce(
        mockSubscription({
          tier: 'STUDIO' as SubscriptionTier,
          status: 'ACTIVE' as SubscriptionStatus,
        })
      )
      .mockResolvedValueOnce(mockSubscription({ creditsBalance: 45 }));

    const usage = await getUserUsage('user1');

    expect(usage).toEqual({
      tier: 'STUDIO',
      creditsBalance: 45,
      creditsMonthly: TIER_LIMITS.STUDIO.creditsMonthly,
      canCreate: true,
    });
  });
});

describe('getUserVoiceCredits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns credits based on tier creditsMonthly for FREE tier', async () => {
    vi.mocked(prisma.subscription.findUnique)
      .mockResolvedValueOnce(null) // getUserTier
      .mockResolvedValueOnce(null); // getUserVoiceCredits

    const credits = await getUserVoiceCredits('user1');

    expect(credits).toEqual({
      used: 0,
      total: TIER_LIMITS.FREE.creditsMonthly,
      remaining: TIER_LIMITS.FREE.creditsMonthly,
    });
  });

  it('returns correct credits for PRO tier with zero used', async () => {
    vi.mocked(prisma.subscription.findUnique)
      .mockResolvedValueOnce(
        mockSubscription({
          tier: 'PRO' as SubscriptionTier,
          status: 'ACTIVE' as SubscriptionStatus,
        })
      )
      .mockResolvedValueOnce(
        mockSubscription({ premiumCreditsUsed: 0, tier: 'PRO' as SubscriptionTier })
      );

    const credits = await getUserVoiceCredits('user1');

    expect(credits).toEqual({
      used: 0,
      total: TIER_LIMITS.PRO.creditsMonthly,
      remaining: TIER_LIMITS.PRO.creditsMonthly,
    });
  });

  it('returns correct credits for STUDIO tier with some used', async () => {
    vi.mocked(prisma.subscription.findUnique)
      .mockResolvedValueOnce(
        mockSubscription({
          tier: 'STUDIO' as SubscriptionTier,
          status: 'ACTIVE' as SubscriptionStatus,
        })
      )
      .mockResolvedValueOnce(
        mockSubscription({ premiumCreditsUsed: 5, tier: 'STUDIO' as SubscriptionTier })
      );

    const credits = await getUserVoiceCredits('user1');

    expect(credits).toEqual({
      used: 5,
      total: TIER_LIMITS.STUDIO.creditsMonthly,
      remaining: TIER_LIMITS.STUDIO.creditsMonthly - 5,
    });
  });
});

describe('resetMonthlyUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls grantMonthlyCredits with correct tier', async () => {
    const { grantMonthlyCredits } = await import('@/lib/credits');

    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(
      mockSubscription({ tier: 'PRO' as SubscriptionTier, status: 'ACTIVE' as SubscriptionStatus })
    );

    await resetMonthlyUsage('user1');

    expect(grantMonthlyCredits).toHaveBeenCalledWith('user1', 'PRO');
  });

  it('uses FREE tier when no subscription exists', async () => {
    const { grantMonthlyCredits } = await import('@/lib/credits');

    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);

    await resetMonthlyUsage('user1');

    expect(grantMonthlyCredits).toHaveBeenCalledWith('user1', 'FREE');
  });
});
