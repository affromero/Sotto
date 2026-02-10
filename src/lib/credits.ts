import { prisma } from './prisma';
import { TIER_LIMITS, TierName } from './stripe';
import { logger } from './logger';

/**
 * Consume credits from a user's balance.
 * Atomic transaction: decrement balance + create CreditTransaction record.
 * Throws if insufficient balance.
 */
export async function consumeCredit(
  userId: string,
  amount: number,
  description: string,
  podcastId?: string
): Promise<{ balanceBefore: number; balanceAfter: number }> {
  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findUnique({
      where: { userId },
      select: { creditsBalance: true },
    });

    const balanceBefore = subscription?.creditsBalance ?? 0;

    if (balanceBefore < amount) {
      throw new Error(`Insufficient credits: need ${amount}, have ${balanceBefore}`);
    }

    const balanceAfter = balanceBefore - amount;

    await tx.subscription.update({
      where: { userId },
      data: { creditsBalance: balanceAfter },
    });

    await tx.creditTransaction.create({
      data: {
        userId,
        amount: -amount,
        balanceBefore,
        balanceAfter,
        type: 'generation',
        description,
        podcastId,
      },
    });

    logger.info('Credit consumed', { userId, amount, balanceBefore, balanceAfter });
    return { balanceBefore, balanceAfter };
  });
}

/**
 * Refund credits to a user's balance.
 * Used when generation fails or by admin.
 */
export async function refundCredits(
  userId: string,
  amount: number,
  reason: 'generation_failed' | 'admin_refund',
  podcastId?: string
): Promise<{ balanceBefore: number; balanceAfter: number }> {
  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findUnique({
      where: { userId },
      select: { creditsBalance: true },
    });

    const balanceBefore = subscription?.creditsBalance ?? 0;
    const balanceAfter = balanceBefore + amount;

    await tx.subscription.update({
      where: { userId },
      data: { creditsBalance: balanceAfter },
    });

    await tx.creditTransaction.create({
      data: {
        userId,
        amount,
        balanceBefore,
        balanceAfter,
        type: 'refund',
        description:
          reason === 'generation_failed' ? 'Credit refunded — generation failed' : 'Admin refund',
        podcastId,
      },
    });

    logger.info('Credits refunded', { userId, amount, reason, balanceBefore, balanceAfter });
    return { balanceBefore, balanceAfter };
  });
}

/**
 * Add purchased credits (credit pack fulfillment).
 */
export async function addPurchasedCredits(
  userId: string,
  credits: number,
  stripePaymentId?: string
): Promise<{ balanceBefore: number; balanceAfter: number }> {
  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findUnique({
      where: { userId },
      select: { creditsBalance: true },
    });

    const balanceBefore = subscription?.creditsBalance ?? 0;
    const balanceAfter = balanceBefore + credits;

    await tx.subscription.update({
      where: { userId },
      data: { creditsBalance: balanceAfter },
    });

    await tx.creditTransaction.create({
      data: {
        userId,
        amount: credits,
        balanceBefore,
        balanceAfter,
        type: 'purchase',
        description: `Purchased ${credits} credits`,
        stripePaymentId,
      },
    });

    logger.info('Purchased credits added', { userId, credits, stripePaymentId });
    return { balanceBefore, balanceAfter };
  });
}

/**
 * Grant monthly credits on subscription renewal.
 * Calculates rollover from current balance, capped by maxRollover.
 */
export async function grantMonthlyCredits(userId: string, tier: TierName): Promise<void> {
  const limits = TIER_LIMITS[tier];

  await prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findUnique({
      where: { userId },
      select: { creditsBalance: true },
    });

    const currentBalance = subscription?.creditsBalance ?? 0;
    const rollover = Math.min(currentBalance, limits.maxRollover);
    const newBalance = rollover + limits.creditsMonthly;

    await tx.subscription.update({
      where: { userId },
      data: {
        creditsBalance: newBalance,
        creditsMonthly: limits.creditsMonthly,
        rolloverCredits: rollover,
        maxRollover: limits.maxRollover,
        premiumCreditsUsed: 0,
      },
    });

    await tx.creditTransaction.create({
      data: {
        userId,
        amount: limits.creditsMonthly,
        balanceBefore: currentBalance,
        balanceAfter: newBalance,
        type: 'monthly_grant',
        description: `Monthly grant: ${limits.creditsMonthly} credits (${tier}), rollover: ${rollover}`,
      },
    });

    logger.info('Monthly credits granted', {
      userId,
      tier,
      monthlyGrant: limits.creditsMonthly,
      rollover,
      newBalance,
    });
  });
}

/**
 * Get current credit balance and limits.
 */
export async function getBalance(userId: string): Promise<{
  creditsBalance: number;
  creditsMonthly: number;
  rolloverCredits: number;
  maxRollover: number;
}> {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: {
      creditsBalance: true,
      creditsMonthly: true,
      rolloverCredits: true,
      maxRollover: true,
    },
  });

  return {
    creditsBalance: subscription?.creditsBalance ?? 0,
    creditsMonthly: subscription?.creditsMonthly ?? 2,
    rolloverCredits: subscription?.rolloverCredits ?? 0,
    maxRollover: subscription?.maxRollover ?? 0,
  };
}
