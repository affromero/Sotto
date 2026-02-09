import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getUserTier,
  getUserUsage,
  getUserVoiceCredits,
  consumeVoiceCredit,
  incrementPodcastUsage,
  resetMonthlyUsage,
} from '@/lib/subscription';
import { prisma } from '@/lib/prisma';
import { TIER_LIMITS } from '@/lib/stripe';
import type { UserRole } from '@prisma/client';

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
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub1',
      userId: 'user1',
      tier: 'PRO',
      status: 'CANCELED',
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
      stripeCustomerId: 'cus_123',
      premiumCreditsUsed: 0,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const tier = await getUserTier('user1');

    expect(tier).toBe('FREE');
  });

  it('returns PRO when subscription is active with PRO tier', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub1',
      userId: 'user1',
      tier: 'PRO',
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
      stripeCustomerId: 'cus_123',
      premiumCreditsUsed: 0,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const tier = await getUserTier('user1');

    expect(tier).toBe('PRO');
  });

  it('returns CREATOR when subscription is active with CREATOR tier', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub1',
      userId: 'user1',
      tier: 'CREATOR',
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
      stripeCustomerId: 'cus_123',
      premiumCreditsUsed: 0,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const tier = await getUserTier('user1');

    expect(tier).toBe('CREATOR');
  });
});

describe('getUserUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct usage for FREE tier user', async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      id: 'user1',
      email: 'user@example.com',
      name: 'Test User',
      image: null,
      emailVerified: null,
      bio: null,
      podcastsUsed: 1,
      podcastsAllowed: 2,
      twitterHandle: null,
      twitterEnabled: false,
      preferredHostVoiceId: null,
      preferredExpertVoiceId: null,
      teamId: null,
      role: 'USER' as UserRole,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);

    const usage = await getUserUsage('user1');

    expect(usage).toEqual({
      tier: 'FREE',
      podcastsUsed: 1,
      podcastsAllowed: TIER_LIMITS.FREE.podcastsPerMonth,
      canCreate: true,
    });
  });

  it('returns correct usage for PRO tier user', async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      id: 'user1',
      email: 'user@example.com',
      name: 'Test User',
      image: null,
      emailVerified: null,
      bio: null,
      podcastsUsed: 5,
      podcastsAllowed: 2,
      twitterHandle: null,
      twitterEnabled: false,
      preferredHostVoiceId: null,
      preferredExpertVoiceId: null,
      teamId: null,
      role: 'USER' as UserRole,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub1',
      userId: 'user1',
      tier: 'PRO',
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
      stripeCustomerId: 'cus_123',
      premiumCreditsUsed: 0,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const usage = await getUserUsage('user1');

    expect(usage).toEqual({
      tier: 'PRO',
      podcastsUsed: 5,
      podcastsAllowed: TIER_LIMITS.PRO.podcastsPerMonth,
      canCreate: true,
    });
  });

  it('returns correct usage for CREATOR tier user', async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      id: 'user1',
      email: 'user@example.com',
      name: 'Test User',
      image: null,
      emailVerified: null,
      bio: null,
      podcastsUsed: 15,
      podcastsAllowed: 2,
      twitterHandle: null,
      twitterEnabled: false,
      preferredHostVoiceId: null,
      preferredExpertVoiceId: null,
      teamId: null,
      role: 'USER' as UserRole,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub1',
      userId: 'user1',
      tier: 'CREATOR',
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
      stripeCustomerId: 'cus_123',
      premiumCreditsUsed: 0,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const usage = await getUserUsage('user1');

    expect(usage).toEqual({
      tier: 'CREATOR',
      podcastsUsed: 15,
      podcastsAllowed: TIER_LIMITS.CREATOR.podcastsPerMonth,
      canCreate: true,
    });
  });

  it('returns canCreate false when at FREE tier limit', async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      id: 'user1',
      email: 'user@example.com',
      name: 'Test User',
      image: null,
      emailVerified: null,
      bio: null,
      podcastsUsed: 2,
      podcastsAllowed: 2,
      twitterHandle: null,
      twitterEnabled: false,
      preferredHostVoiceId: null,
      preferredExpertVoiceId: null,
      teamId: null,
      role: 'USER' as UserRole,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);

    const usage = await getUserUsage('user1');

    expect(usage.canCreate).toBe(false);
  });

  it('returns canCreate false when at PRO tier limit', async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      id: 'user1',
      email: 'user@example.com',
      name: 'Test User',
      image: null,
      emailVerified: null,
      bio: null,
      podcastsUsed: 8,
      podcastsAllowed: 2,
      twitterHandle: null,
      twitterEnabled: false,
      preferredHostVoiceId: null,
      preferredExpertVoiceId: null,
      teamId: null,
      role: 'USER' as UserRole,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub1',
      userId: 'user1',
      tier: 'PRO',
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
      stripeCustomerId: 'cus_123',
      premiumCreditsUsed: 0,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const usage = await getUserUsage('user1');

    expect(usage.canCreate).toBe(false);
  });

  it('returns canCreate false when at CREATOR tier limit', async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      id: 'user1',
      email: 'user@example.com',
      name: 'Test User',
      image: null,
      emailVerified: null,
      bio: null,
      podcastsUsed: 30,
      podcastsAllowed: 2,
      twitterHandle: null,
      twitterEnabled: false,
      preferredHostVoiceId: null,
      preferredExpertVoiceId: null,
      teamId: null,
      role: 'USER' as UserRole,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub1',
      userId: 'user1',
      tier: 'CREATOR',
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
      stripeCustomerId: 'cus_123',
      premiumCreditsUsed: 0,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const usage = await getUserUsage('user1');

    expect(usage.canCreate).toBe(false);
  });
});

describe('getUserVoiceCredits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero credits for FREE tier', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);

    const credits = await getUserVoiceCredits('user1');

    expect(credits).toEqual({
      used: 0,
      total: 0,
      remaining: 0,
    });
  });

  it('returns correct credits for PRO tier with zero used', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub1',
      userId: 'user1',
      tier: 'PRO',
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
      stripeCustomerId: 'cus_123',
      premiumCreditsUsed: 0,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const credits = await getUserVoiceCredits('user1');

    expect(credits).toEqual({
      used: 0,
      total: TIER_LIMITS.PRO.premiumVoiceCredits,
      remaining: TIER_LIMITS.PRO.premiumVoiceCredits,
    });
  });

  it('returns correct credits for CREATOR tier with some used', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub1',
      userId: 'user1',
      tier: 'CREATOR',
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
      stripeCustomerId: 'cus_123',
      premiumCreditsUsed: 5,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const credits = await getUserVoiceCredits('user1');

    expect(credits).toEqual({
      used: 5,
      total: TIER_LIMITS.CREATOR.premiumVoiceCredits,
      remaining: 5,
    });
  });

  it('returns zero remaining when all credits used', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub1',
      userId: 'user1',
      tier: 'PRO',
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
      stripeCustomerId: 'cus_123',
      premiumCreditsUsed: 3,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const credits = await getUserVoiceCredits('user1');

    expect(credits).toEqual({
      used: 3,
      total: 3,
      remaining: 0,
    });
  });
});

describe('consumeVoiceCredit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('increments premium credits used when credits available', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub1',
      userId: 'user1',
      tier: 'PRO',
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
      stripeCustomerId: 'cus_123',
      premiumCreditsUsed: 1,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.subscription.update).mockResolvedValue({
      id: 'sub1',
      userId: 'user1',
      tier: 'PRO',
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
      stripeCustomerId: 'cus_123',
      premiumCreditsUsed: 2,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await consumeVoiceCredit('user1');

    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      data: { premiumCreditsUsed: { increment: 1 } },
    });
  });

  it('throws error when no credits remaining', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: 'sub1',
      userId: 'user1',
      tier: 'PRO',
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_123',
      stripePriceId: 'price_123',
      stripeCustomerId: 'cus_123',
      premiumCreditsUsed: 3,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(consumeVoiceCredit('user1')).rejects.toThrow(
      'No premium voice credits remaining this month'
    );

    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('throws error when FREE tier user tries to consume credit', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);

    await expect(consumeVoiceCredit('user1')).rejects.toThrow(
      'No premium voice credits remaining this month'
    );
  });
});

describe('incrementPodcastUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('increments user podcast usage counter', async () => {
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: 'user1',
      email: 'user@example.com',
      name: 'Test User',
      image: null,
      emailVerified: null,
      bio: null,
      podcastsUsed: 2,
      podcastsAllowed: 2,
      twitterHandle: null,
      twitterEnabled: false,
      preferredHostVoiceId: null,
      preferredExpertVoiceId: null,
      teamId: null,
      role: 'USER' as UserRole,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await incrementPodcastUsage('user1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: { podcastsUsed: { increment: 1 } },
    });
  });
});

describe('resetMonthlyUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets both podcast usage and premium credits in transaction', async () => {
    const mockTransaction = vi.fn().mockImplementation((operations) => {
      if (Array.isArray(operations)) {
        return Promise.all(operations);
      }
      return operations;
    });

    vi.mocked(prisma.$transaction).mockImplementation(mockTransaction as never);

    vi.mocked(prisma.user.update).mockResolvedValue({
      id: 'user1',
      email: 'user@example.com',
      name: 'Test User',
      image: null,
      emailVerified: null,
      bio: null,
      podcastsUsed: 0,
      podcastsAllowed: 2,
      twitterHandle: null,
      twitterEnabled: false,
      preferredHostVoiceId: null,
      preferredExpertVoiceId: null,
      teamId: null,
      role: 'USER' as UserRole,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 1 });

    await resetMonthlyUsage('user1');

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.arrayContaining([expect.anything(), expect.anything()])
    );
  });

  it('resets usage for user with no subscription', async () => {
    const mockTransaction = vi.fn().mockImplementation((callback) => {
      if (Array.isArray(callback)) {
        return Promise.all(callback);
      }
      return callback(prisma);
    });

    vi.mocked(prisma.$transaction).mockImplementation(mockTransaction as never);

    vi.mocked(prisma.user.update).mockResolvedValue({
      id: 'user1',
      email: 'user@example.com',
      name: 'Test User',
      image: null,
      emailVerified: null,
      bio: null,
      podcastsUsed: 0,
      podcastsAllowed: 2,
      twitterHandle: null,
      twitterEnabled: false,
      preferredHostVoiceId: null,
      preferredExpertVoiceId: null,
      teamId: null,
      role: 'USER' as UserRole,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 0 });

    await resetMonthlyUsage('user1');

    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
