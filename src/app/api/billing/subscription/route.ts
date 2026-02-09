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

    const subscription = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
    });

    if (!subscription || subscription.status !== 'ACTIVE') {
      return NextResponse.json({
        tier: 'FREE',
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        premiumCreditsUsed: 0,
        limits: TIER_LIMITS.FREE,
      });
    }

    const tier = subscription.tier as keyof typeof TIER_LIMITS;

    return NextResponse.json({
      tier: subscription.tier,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      currentPeriodStart: subscription.currentPeriodStart?.toISOString() || null,
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      premiumCreditsUsed: subscription.premiumCreditsUsed,
      limits: TIER_LIMITS[tier],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch subscription';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
