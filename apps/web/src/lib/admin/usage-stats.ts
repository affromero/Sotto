/**
 * admin/usage-stats.ts — typed aggregations over ApiUsageLog for the admin
 * Overview and Usage & cost views. Observability only: real provider spend,
 * tokens, requests, and latency. No budgets, caps, or quotas.
 */
import { prisma } from '@/lib/prisma';
import { getAllAiProviderMeta } from '@/lib/providers/ai-registry';

const DAY_MS = 86_400_000;

export interface UsageHeadline {
  /** Spend (USD) in the trailing `days` window. */
  spend: number;
  /** Spend (USD) in the window immediately before this one, for a delta. */
  spendPrev: number;
  unknownCosts: number;
  unknownCostsPrev: number;
  requests: number;
  avgLatencyMs: number;
  activeLearners: number;
  tokensIn: number;
  tokensOut: number;
  unknownInputTokens: number;
  unknownOutputTokens: number;
  unknownLatency: number;
  tokenRequests: number;
}

export interface ServiceSpend {
  unknownCosts: number;
  service: string;
  usd: number;
  requests: number;
  /** Fractional share of total spend (0–1). */
  share: number;
}

export interface CategorySpend {
  unknownCosts: number;
  category: string;
  usd: number;
  requests: number;
}

export interface DaySpend {
  unknownCosts: number;
  requests: number;
  /** YYYY-MM-DD (UTC). */
  day: string;
  usd: number;
}

export interface LearnerSpend {
  unknownCosts: number;
  requests: number;
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
export async function getUsageHeadline(days = 30, now = Date.now()): Promise<UsageHeadline> {
  const since = new Date(now - days * DAY_MS);
  const prevSince = new Date(now - 2 * days * DAY_MS);

  const [current, previous, learners, tokens] = await Promise.all([
    prisma.apiUsageLog.aggregate({
      where: { createdAt: { gte: since, lt: new Date(now) } },
      _sum: { totalCost: true, inputTokens: true, outputTokens: true },
      _avg: { durationMs: true },
      _count: {
        _all: true,
        totalCost: true,
        inputTokens: true,
        outputTokens: true,
        durationMs: true,
      },
    }),
    prisma.apiUsageLog.aggregate({
      where: { createdAt: { gte: prevSince, lt: since } },
      _sum: { totalCost: true },
      _count: { _all: true, totalCost: true },
    }),
    prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(DISTINCT "userId")::int AS n
      FROM "ApiUsageLog"
      WHERE "createdAt" >= ${since} AND "createdAt" < ${new Date(now)} AND "userId" IS NOT NULL
    `,
    prisma.apiUsageLog.aggregate({
      where: {
        createdAt: { gte: since, lt: new Date(now) },
        OR: [
          { service: { in: getAllAiProviderMeta().map((provider) => provider.id) } },
          { inputTokens: { not: null } },
          { outputTokens: { not: null } },
        ],
      },
      _sum: { inputTokens: true, outputTokens: true },
      _count: { _all: true, inputTokens: true, outputTokens: true },
    }),
  ]);

  return {
    spend: current._sum.totalCost ?? 0,
    spendPrev: previous._sum.totalCost ?? 0,
    unknownCosts: current._count._all - current._count.totalCost,
    unknownCostsPrev: previous._count._all - previous._count.totalCost,
    requests: current._count._all,
    avgLatencyMs: Math.round(current._avg.durationMs ?? 0),
    activeLearners: learners[0]?.n ?? 0,
    tokensIn: tokens._sum.inputTokens ?? 0,
    tokensOut: tokens._sum.outputTokens ?? 0,
    tokenRequests: tokens._count._all,
    unknownInputTokens: tokens._count._all - tokens._count.inputTokens,
    unknownOutputTokens: tokens._count._all - tokens._count.outputTokens,
    unknownLatency: current._count._all - current._count.durationMs,
  };
}

/** Spend grouped by provider (`service`), descending, with fractional share. */
export async function getSpendByService(days = 30, now = Date.now()): Promise<ServiceSpend[]> {
  const since = new Date(now - days * DAY_MS);
  const grouped = await prisma.apiUsageLog.groupBy({
    by: ['service'],
    where: { createdAt: { gte: since, lt: new Date(now) } },
    _sum: { totalCost: true },
    _count: { _all: true, totalCost: true },
  });

  const total = grouped.reduce((a, g) => a + (g._sum.totalCost ?? 0), 0) || 1;
  return grouped
    .map((g) => ({
      service: g.service,
      unknownCosts: g._count._all - g._count.totalCost,
      usd: g._sum.totalCost ?? 0,
      requests: g._count._all,
      share: (g._sum.totalCost ?? 0) / total,
    }))
    .sort((a, b) => b.usd - a.usd);
}

/** Spend grouped by pipeline `category`, descending. */
export async function getSpendByCategory(days = 30, now = Date.now()): Promise<CategorySpend[]> {
  const since = new Date(now - days * DAY_MS);
  const grouped = await prisma.apiUsageLog.groupBy({
    by: ['category'],
    where: { createdAt: { gte: since, lt: new Date(now) } },
    _sum: { totalCost: true },
    _count: { _all: true, totalCost: true },
  });

  return grouped
    .map((g) => ({
      category: g.category,
      unknownCosts: g._count._all - g._count.totalCost,
      usd: g._sum.totalCost ?? 0,
      requests: g._count._all,
    }))
    .sort((a, b) => b.usd - a.usd);
}

/** Continuous per-day spend series (zero-filled) for the trailing `days` window. */
export async function getSpendByDay(days = 30, now = Date.now()): Promise<DaySpend[]> {
  const since = new Date(now - days * DAY_MS);
  const rows = await prisma.$queryRaw<
    { day: Date; usd: number; requests: number; unknownCosts: number }[]
  >`
    SELECT DATE_TRUNC('day', "createdAt") AS day, COALESCE(SUM("totalCost"), 0)::float AS usd,
      COUNT(*)::int AS requests, COUNT(*) FILTER (WHERE "totalCost" IS NULL)::int AS "unknownCosts"
    FROM "ApiUsageLog"
    WHERE "createdAt" >= ${since} AND "createdAt" < ${new Date(now)}
    GROUP BY 1
    ORDER BY 1
  `;

  const byDay = new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), r]));
  const series: DaySpend[] = [];
  const firstDay = Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate());
  for (let day = firstDay; day < now; day += DAY_MS) {
    const key = new Date(day).toISOString().slice(0, 10);
    const row = byDay.get(key);
    series.push({
      day: key,
      usd: row?.usd ?? 0,
      requests: row?.requests ?? 0,
      unknownCosts: row?.unknownCosts ?? 0,
    });
  }
  return series;
}

/** Top learners by spend (observability only — no caps or limits). */
export async function getCostByUser(
  days = 30,
  limit = 8,
  now = Date.now()
): Promise<LearnerSpend[]> {
  const since = new Date(now - days * DAY_MS);
  const rows = await prisma.$queryRaw<
    { userId: string; name: string | null; usd: number; requests: number; unknownCosts: number }[]
  >`
    SELECT u.id AS "userId", u.name AS name, COALESCE(SUM(l."totalCost"), 0)::float AS usd,
      COUNT(*)::int AS requests, COUNT(*) FILTER (WHERE l."totalCost" IS NULL)::int AS "unknownCosts"
    FROM "ApiUsageLog" l
    JOIN "User" u ON u.id = l."userId"
    WHERE l."createdAt" >= ${since} AND l."createdAt" < ${new Date(now)}
    GROUP BY u.id, u.name
    ORDER BY usd DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name?.trim() || 'Learner',
    usd: r.usd,
    requests: r.requests,
    unknownCosts: r.unknownCosts,
  }));
}

/** Read a report against one time boundary, including its earliest partial day. */
export async function getUsageReport(days = 30) {
  const now = Date.now();
  const [headline, byService, byDay, byCategory, byUser] = await Promise.all([
    getUsageHeadline(days, now),
    getSpendByService(days, now),
    getSpendByDay(days, now),
    getSpendByCategory(days, now),
    getCostByUser(days, 8, now),
  ]);
  return { headline, byService, byDay, byCategory, byUser };
}

export async function getUsageOverview(days = 30) {
  const now = Date.now();
  const [headline, byService, byDay, learners] = await Promise.all([
    getUsageHeadline(days, now),
    getSpendByService(days, now),
    getSpendByDay(days, now),
    getLearnerCounts(),
  ]);
  return { headline, byService, byDay, learners };
}
