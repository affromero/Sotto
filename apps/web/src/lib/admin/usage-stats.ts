/**
 * admin/usage-stats.ts — typed aggregations over ApiUsageLog for the admin
 * Overview and Usage & cost views. Observability only: real provider spend,
 * tokens, requests, and latency. No budgets, caps, or quotas.
 */
import { prisma } from '@/lib/prisma';

const DAY_MS = 86_400_000;

export interface UsageHeadline {
  /** Spend (USD) in the trailing `days` window. */
  spend: number;
  /** Spend (USD) in the window immediately before this one, for a delta. */
  spendPrev: number;
  requests: number;
  avgLatencyMs: number;
  activeLearners: number;
  tokensIn: number;
  tokensOut: number;
}

export interface ServiceSpend {
  service: string;
  usd: number;
  requests: number;
  /** Fractional share of total spend (0–1). */
  share: number;
}

export interface CategorySpend {
  category: string;
  usd: number;
  requests: number;
}

export interface DaySpend {
  /** YYYY-MM-DD (UTC). */
  day: string;
  usd: number;
}

export interface LearnerSpend {
  userId: string;
  name: string;
  usd: number;
}

/** Registered-learner counts (total + signups in the last 7 days). */
export async function getLearnerCounts(): Promise<{ total: number; signupsThisWeek: number }> {
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const [total, signupsThisWeek] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
  ]);
  return { total, signupsThisWeek };
}

/** Headline numbers for the trailing `days` window + the prior window for deltas. */
export async function getUsageHeadline(days = 30): Promise<UsageHeadline> {
  const since = new Date(Date.now() - days * DAY_MS);
  const prevSince = new Date(Date.now() - 2 * days * DAY_MS);

  const [current, previous, learners] = await Promise.all([
    prisma.apiUsageLog.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { totalCost: true, inputTokens: true, outputTokens: true },
      _avg: { durationMs: true },
      _count: { _all: true },
    }),
    prisma.apiUsageLog.aggregate({
      where: { createdAt: { gte: prevSince, lt: since } },
      _sum: { totalCost: true },
    }),
    prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(DISTINCT "userId")::int AS n
      FROM "ApiUsageLog"
      WHERE "createdAt" >= ${since} AND "userId" IS NOT NULL
    `,
  ]);

  return {
    spend: current._sum.totalCost ?? 0,
    spendPrev: previous._sum.totalCost ?? 0,
    requests: current._count._all,
    avgLatencyMs: Math.round(current._avg.durationMs ?? 0),
    activeLearners: learners[0]?.n ?? 0,
    tokensIn: current._sum.inputTokens ?? 0,
    tokensOut: current._sum.outputTokens ?? 0,
  };
}

/** Spend grouped by provider (`service`), descending, with fractional share. */
export async function getSpendByService(days = 30): Promise<ServiceSpend[]> {
  const since = new Date(Date.now() - days * DAY_MS);
  const grouped = await prisma.apiUsageLog.groupBy({
    by: ['service'],
    where: { createdAt: { gte: since } },
    _sum: { totalCost: true },
    _count: { _all: true },
  });

  const total = grouped.reduce((a, g) => a + (g._sum.totalCost ?? 0), 0) || 1;
  return grouped
    .map((g) => ({
      service: g.service,
      usd: g._sum.totalCost ?? 0,
      requests: g._count._all,
      share: (g._sum.totalCost ?? 0) / total,
    }))
    .sort((a, b) => b.usd - a.usd);
}

/** Spend grouped by pipeline `category`, descending. */
export async function getSpendByCategory(days = 30): Promise<CategorySpend[]> {
  const since = new Date(Date.now() - days * DAY_MS);
  const grouped = await prisma.apiUsageLog.groupBy({
    by: ['category'],
    where: { createdAt: { gte: since } },
    _sum: { totalCost: true },
    _count: { _all: true },
  });

  return grouped
    .map((g) => ({
      category: g.category,
      usd: g._sum.totalCost ?? 0,
      requests: g._count._all,
    }))
    .sort((a, b) => b.usd - a.usd);
}

/** Continuous per-day spend series (zero-filled) for the trailing `days` window. */
export async function getSpendByDay(days = 30): Promise<DaySpend[]> {
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await prisma.$queryRaw<{ day: Date; usd: number }[]>`
    SELECT DATE_TRUNC('day', "createdAt") AS day, COALESCE(SUM("totalCost"), 0)::float AS usd
    FROM "ApiUsageLog"
    WHERE "createdAt" >= ${since}
    GROUP BY 1
    ORDER BY 1
  `;

  const byDay = new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), r.usd]));
  const series: DaySpend[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
    series.push({ day: key, usd: byDay.get(key) ?? 0 });
  }
  return series;
}

/** Top learners by spend (observability only — no caps or limits). */
export async function getCostByUser(days = 30, limit = 8): Promise<LearnerSpend[]> {
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await prisma.$queryRaw<{ userId: string; name: string | null; usd: number }[]>`
    SELECT u.id AS "userId", u.name AS name, COALESCE(SUM(l."totalCost"), 0)::float AS usd
    FROM "ApiUsageLog" l
    JOIN "User" u ON u.id = l."userId"
    WHERE l."createdAt" >= ${since}
    GROUP BY u.id, u.name
    HAVING COALESCE(SUM(l."totalCost"), 0) > 0
    ORDER BY usd DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name?.trim() || 'Learner',
    usd: r.usd,
  }));
}
