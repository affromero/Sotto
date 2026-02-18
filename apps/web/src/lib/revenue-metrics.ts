/**
 * Revenue aggregation queries for the voice marketplace admin dashboard.
 */

import { prisma } from './prisma';

export interface RevenueOverview {
  totalRevenueCents: number;
  platformFeesCents: number;
  netToCreatorsCents: number;
  totalPurchases: number;
  avgPriceCents: number;
}

export async function getRevenueOverview(since: Date): Promise<RevenueOverview> {
  const agg = await prisma.voicePurchase.aggregate({
    where: { status: 'captured', createdAt: { gte: since } },
    _sum: { amountCents: true, platformFeeCents: true },
    _count: true,
    _avg: { amountCents: true },
  });

  const totalRevenueCents = agg._sum.amountCents ?? 0;
  const platformFeesCents = agg._sum.platformFeeCents ?? 0;

  return {
    totalRevenueCents,
    platformFeesCents,
    netToCreatorsCents: totalRevenueCents - platformFeesCents,
    totalPurchases: agg._count,
    avgPriceCents: Math.round(agg._avg.amountCents ?? 0),
  };
}

export async function getDailyRevenueTrend(
  days: number
): Promise<Array<{ date: string; revenueCents: number; count: number }>> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const rows = await prisma.$queryRaw<
    Array<{ day: Date; revenue: bigint; count: bigint }>
  >`
    SELECT
      DATE_TRUNC('day', "createdAt") AS day,
      COALESCE(SUM("amountCents"), 0)::bigint AS revenue,
      COUNT(*)::bigint AS count
    FROM "VoicePurchase"
    WHERE "status" = 'captured' AND "createdAt" >= ${since}
    GROUP BY DATE_TRUNC('day', "createdAt")
    ORDER BY day ASC
  `;

  return rows.map((r) => ({
    date: r.day.toISOString().split('T')[0],
    revenueCents: Number(r.revenue),
    count: Number(r.count),
  }));
}

export async function getTopSellingVoices(
  limit: number = 10
): Promise<
  Array<{
    voiceCloneId: string;
    voiceName: string;
    ownerName: string | null;
    totalRevenueCents: number;
    purchaseCount: number;
  }>
> {
  const rows = await prisma.$queryRaw<
    Array<{
      voiceCloneId: string;
      voiceName: string;
      ownerName: string | null;
      revenue: bigint;
      count: bigint;
    }>
  >`
    SELECT
      vp."voiceCloneId",
      vc."name" AS "voiceName",
      u."name" AS "ownerName",
      COALESCE(SUM(vp."amountCents"), 0)::bigint AS revenue,
      COUNT(*)::bigint AS count
    FROM "VoicePurchase" vp
    JOIN "VoiceClone" vc ON vc."id" = vp."voiceCloneId"
    JOIN "User" u ON u."id" = vc."userId"
    WHERE vp."status" = 'captured'
    GROUP BY vp."voiceCloneId", vc."name", u."name"
    ORDER BY revenue DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    voiceCloneId: r.voiceCloneId,
    voiceName: r.voiceName,
    ownerName: r.ownerName,
    totalRevenueCents: Number(r.revenue),
    purchaseCount: Number(r.count),
  }));
}

export async function getRevenueByStatus(): Promise<
  Array<{ status: string; count: number; totalCents: number }>
> {
  const rows = await prisma.voicePurchase.groupBy({
    by: ['status'],
    _count: true,
    _sum: { amountCents: true },
  });

  return rows.map((r) => ({
    status: r.status,
    count: r._count,
    totalCents: r._sum.amountCents ?? 0,
  }));
}

export async function getMarketplaceHealth(): Promise<{
  connectedSellers: number;
  paidVoices: number;
  freeVoices: number;
}> {
  const [connectedSellers, paidVoices, freeVoices] = await Promise.all([
    prisma.user.count({ where: { stripeOnboarded: true } }),
    prisma.voiceClone.count({ where: { priceInCents: { gt: 0 } } }),
    prisma.voiceClone.count({ where: { OR: [{ priceInCents: null }, { priceInCents: 0 }] } }),
  ]);

  return { connectedSellers, paidVoices, freeVoices };
}
