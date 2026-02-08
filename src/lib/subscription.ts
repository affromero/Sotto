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
  await prisma.user.update({
    where: { id: userId },
    data: { podcastsUsed: 0 },
  });
}
