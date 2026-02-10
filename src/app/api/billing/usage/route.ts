import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TIER_LIMITS, INTERACTION_CREDIT_COST, type TierName } from '@/lib/stripe';

export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [user, subscription, recentTransactions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { id: true, role: true },
      }),
      prisma.subscription.findUnique({
        where: { userId: session.user.id },
        select: {
          tier: true,
          status: true,
          creditsBalance: true,
          creditsMonthly: true,
          rolloverCredits: true,
          maxRollover: true,
          currentPeriodEnd: true,
        },
      }),
      prisma.creditTransaction.findMany({
        where: { userId: session.user.id },
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
      }),
    ]);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const tier = (subscription?.status === 'ACTIVE' ? subscription.tier : 'FREE') as TierName;
    const limits = TIER_LIMITS[user.role === 'ADMIN' ? 'ADMIN' : tier];

    return NextResponse.json({
      tier,
      status: subscription?.status || 'ACTIVE',
      creditsBalance: subscription?.creditsBalance ?? 0,
      creditsMonthly: subscription?.creditsMonthly ?? limits.creditsMonthly,
      rolloverCredits: subscription?.rolloverCredits ?? 0,
      maxRollover: subscription?.maxRollover ?? limits.maxRollover,
      currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() || null,
      recentTransactions: recentTransactions.map((tx) => ({
        id: tx.id,
        amount: tx.amount,
        type: tx.type,
        description: tx.description,
        balanceAfter: tx.balanceAfter,
        createdAt: tx.createdAt.toISOString(),
      })),
      limits: {
        maxDurationMinutes: limits.maxDurationMinutes,
        interactionCreditCost: INTERACTION_CREDIT_COST,
        maxVoiceClones: limits.maxVoiceClones,
        premiumVoiceSurcharge: limits.premiumVoiceSurcharge,
        canDownload: limits.canDownload,
        canMakePrivate: limits.canMakePrivate,
        canExportPdf: limits.canExportPdf,
        canViewAnalytics: limits.canViewAnalytics,
        hasPremiumSfx: limits.hasPremiumSfx,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch usage';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
