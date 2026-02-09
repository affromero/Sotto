import { prisma } from './prisma';
import { TIER_LIMITS, TierName } from './stripe';

/**
 * Get the user's current subscription tier
 */
export async function getUserTier(userId: string): Promise<TierName> {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  if (!subscription || subscription.status !== 'ACTIVE') {
    return 'FREE';
  }

  return subscription.tier as TierName;
}

/**
 * Get user's usage for the current billing period
 */
export async function getUserUsage(userId: string): Promise<{
  tier: TierName;
  podcastsUsed: number;
  podcastsAllowed: number;
  canCreate: boolean;
}> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const tier = await getUserTier(userId);
  const limits = TIER_LIMITS[tier];

  return {
    tier,
    podcastsUsed: user.podcastsUsed,
    podcastsAllowed: limits.podcastsPerMonth === Infinity ? -1 : limits.podcastsPerMonth,
    canCreate: user.podcastsUsed < limits.podcastsPerMonth,
  };
}

/**
 * Get premium voice credit usage for the current billing period
 */
export async function getUserVoiceCredits(userId: string): Promise<{
  used: number;
  total: number;
  remaining: number;
}> {
  const tier = await getUserTier(userId);
  const limits = TIER_LIMITS[tier];
  const total = limits.premiumVoiceCredits;

  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { premiumCreditsUsed: true },
  });

  const used = subscription?.premiumCreditsUsed ?? 0;

  return {
    used,
    total,
    remaining: Math.max(0, total - used),
  };
}

/**
 * Consume one premium voice credit. Throws if no credits remaining.
 */
export async function consumeVoiceCredit(userId: string): Promise<void> {
  const credits = await getUserVoiceCredits(userId);
  if (credits.remaining <= 0) {
    throw new Error('No premium voice credits remaining this month');
  }

  await prisma.subscription.update({
    where: { userId },
    data: { premiumCreditsUsed: { increment: 1 } },
  });
}

/**
 * Increment podcast usage counter
 */
export async function incrementPodcastUsage(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { podcastsUsed: { increment: 1 } },
  });
}

/**
 * Reset monthly usage (called by Stripe webhook on period renewal)
 */
export async function resetMonthlyUsage(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { podcastsUsed: 0 },
    }),
    prisma.subscription.updateMany({
      where: { userId },
      data: { premiumCreditsUsed: 0 },
    }),
  ]);
}
