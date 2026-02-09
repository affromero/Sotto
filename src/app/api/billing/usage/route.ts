import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TIER_LIMITS } from '@/lib/stripe';

export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        podcastsUsed: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const subscription = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
      select: {
        tier: true,
        status: true,
        premiumCreditsUsed: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
      },
    });

    const tier = (
      subscription?.status === 'ACTIVE' ? subscription.tier : 'FREE'
    ) as keyof typeof TIER_LIMITS;
    const limits = TIER_LIMITS[tier];

    const periodFilter = subscription?.currentPeriodStart
      ? { createdAt: { gte: subscription.currentPeriodStart } }
      : {};

    await prisma.podcast.count({
      where: {
        userId: session.user.id,
        ...periodFilter,
      },
    });

    const interactionCount = await prisma.interaction.count({
      where: {
        podcast: {
          userId: session.user.id,
        },
        ...periodFilter,
      },
    });

    const premiumCreditsUsed = subscription?.premiumCreditsUsed ?? 0;
    const premiumCreditsTotal = limits.premiumVoiceCredits;

    return NextResponse.json({
      tier,
      podcastsUsed: user.podcastsUsed,
      podcastsAllowed: limits.podcastsPerMonth,
      podcastsRemaining: Math.max(0, limits.podcastsPerMonth - user.podcastsUsed),
      interactionsThisMonth: interactionCount,
      premiumCreditsUsed,
      premiumCreditsTotal,
      premiumCreditsRemaining: Math.max(0, premiumCreditsTotal - premiumCreditsUsed),
      currentPeriodStart: subscription?.currentPeriodStart?.toISOString() || null,
      currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() || null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch usage';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
