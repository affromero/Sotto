import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { analyticsQuerySchema } from '@/lib/validations';
import type { AnalyticsResponse } from '@/types/analytics';

function getPeriodDate(period: string): Date | null {
  const now = new Date();
  switch (period) {
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = analyticsQuerySchema.safeParse(searchParams);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { period } = parsed.data;
  const sinceDate = getPeriodDate(period);

  const dateFilter = sinceDate ? { createdAt: { gte: sinceDate } } : {};
  const userFilter = { userId: session.user.id };
  const whereClause = { ...userFilter, ...dateFilter };

  // Run all queries in parallel
  const [aggregateResult, byService, byCategory, timeSeries] = await Promise.all([
    // Summary aggregation
    prisma.apiUsageLog.aggregate({
      where: whereClause,
      _sum: { totalCost: true },
      _count: true,
      _avg: { durationMs: true },
    }),

    // Group by service
    prisma.apiUsageLog.groupBy({
      by: ['service'],
      where: whereClause,
      _sum: { totalCost: true },
      _count: true,
      orderBy: { _sum: { totalCost: 'desc' } },
    }),

    // Group by category
    prisma.apiUsageLog.groupBy({
      by: ['category'],
      where: whereClause,
      _sum: { totalCost: true },
      _count: true,
      orderBy: { _sum: { totalCost: 'desc' } },
    }),

    // Time series — use raw query for date grouping
    prisma.$queryRaw<Array<{ date: Date; count: bigint; total_cost: number }>>`
      SELECT DATE(created_at) as date, COUNT(*) as count, COALESCE(SUM(total_cost), 0) as total_cost
      FROM "ApiUsageLog"
      WHERE user_id = ${session.user.id}
      ${sinceDate ? prisma.$queryRaw`AND created_at >= ${sinceDate}` : prisma.$queryRaw``}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `.catch(() => []),
  ]);

  const response: AnalyticsResponse = {
    summary: {
      totalCost: aggregateResult._sum.totalCost ?? 0,
      totalRequests: aggregateResult._count,
      avgDurationMs: aggregateResult._avg.durationMs ?? null,
    },
    byService: byService.map((s) => ({
      service: s.service,
      count: s._count,
      totalCost: s._sum.totalCost ?? 0,
    })),
    byCategory: byCategory.map((c) => ({
      category: c.category,
      count: c._count,
      totalCost: c._sum.totalCost ?? 0,
    })),
    timeSeries: Array.isArray(timeSeries)
      ? timeSeries.map((d) => ({
          date: new Date(d.date).toISOString().split('T')[0],
          count: Number(d.count),
          totalCost: Number(d.total_cost),
        }))
      : [],
    period,
  };

  return NextResponse.json(response);
}
