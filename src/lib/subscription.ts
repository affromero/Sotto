import { prisma } from './prisma';
import { TIER_LIMITS, TierName } from './stripe';
import { grantMonthlyCredits } from './credits';

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
 * Get user's credit balance and usage info
 */
export async function getUserUsage(userId: string): Promise<{
  tier: TierName;
  creditsBalance: number;
  creditsMonthly: number;
  canCreate: boolean;
}> {
  const tier = await getUserTier(userId);
  const limits = TIER_LIMITS[tier];

  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { creditsBalance: true },
  });

  const creditsBalance = subscription?.creditsBalance ?? 0;

  return {
    tier,
    creditsBalance,
    creditsMonthly: limits.creditsMonthly,
    canCreate: creditsBalance > 0,
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
  const total = limits.creditsMonthly;

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
 * Reset monthly usage via credit grant system.
 * Called by Stripe webhook on period renewal.
 */
export async function resetMonthlyUsage(userId: string): Promise<void> {
  const tier = await getUserTier(userId);
  await grantMonthlyCredits(userId, tier);
}
