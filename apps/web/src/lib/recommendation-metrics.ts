/**
 * Recommendation analytics queries for the admin dashboard.
 * Extracts and extends patterns from traffic-report.ts.
 */

import { prisma } from './prisma';

export interface RecommendationOverview {
  impressions: number;
  clicks: number;
  queues: number;
  ctr: number;
  queueRate: number;
  avgListenPercent: number;
}

export async function getRecommendationOverview(since: Date): Promise<RecommendationOverview> {
  const [agg] = await prisma.$queryRaw<
    [{ impressions: bigint; clicks: bigint; queues: bigint; avgListened: number | null }]
  >`
    SELECT
      COUNT(*) FILTER (WHERE "impressed" = true)::bigint AS impressions,
      COUNT(*) FILTER (WHERE "clicked" = true)::bigint AS clicks,
      COUNT(*) FILTER (WHERE "queued" = true)::bigint AS queues,
      AVG("listenedPercent") FILTER (WHERE "listenedPercent" IS NOT NULL)::float AS "avgListened"
    FROM "RecommendationLog"
    WHERE "createdAt" >= ${since}
  `;

  const impressions = Number(agg.impressions);
  const clicks = Number(agg.clicks);
  const queues = Number(agg.queues);

  return {
    impressions,
    clicks,
    queues,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
    queueRate: impressions > 0 ? Math.round((queues / impressions) * 10000) / 100 : 0,
    avgListenPercent: Math.round((agg.avgListened ?? 0) * 10) / 10,
  };
}

export interface RecommendationSurface {
  surface: string;
  impressions: number;
  clicks: number;
  ctr: number;
  queues: number;
  queueRate: number;
}

export async function getRecommendationBySurface(since: Date): Promise<RecommendationSurface[]> {
  const rows = await prisma.$queryRaw<
    Array<{ surface: string; impressions: bigint; clicks: bigint; queues: bigint }>
  >`
    SELECT
      "surface",
      COUNT(*) FILTER (WHERE "impressed" = true)::bigint AS impressions,
      COUNT(*) FILTER (WHERE "clicked" = true)::bigint AS clicks,
      COUNT(*) FILTER (WHERE "queued" = true)::bigint AS queues
    FROM "RecommendationLog"
    WHERE "createdAt" >= ${since}
    GROUP BY "surface"
    ORDER BY impressions DESC
  `;

  return rows.map((r) => {
    const imp = Number(r.impressions);
    const cli = Number(r.clicks);
    const q = Number(r.queues);
    return {
      surface: r.surface,
      impressions: imp,
      clicks: cli,
      ctr: imp > 0 ? Math.round((cli / imp) * 10000) / 100 : 0,
      queues: q,
      queueRate: imp > 0 ? Math.round((q / imp) * 10000) / 100 : 0,
    };
  });
}

export interface PositionBias {
  position: number;
  ctr: number;
  impressions: number;
}

export async function getRecommendationPositionBias(since: Date): Promise<PositionBias[]> {
  const rows = await prisma.$queryRaw<
    Array<{ position: number; impressions: bigint; clicks: bigint }>
  >`
    SELECT
      LEAST(position, 10) AS position,
      COUNT(*) FILTER (WHERE "impressed" = true)::bigint AS impressions,
      COUNT(*) FILTER (WHERE "clicked" = true)::bigint AS clicks
    FROM "RecommendationLog"
    WHERE "createdAt" >= ${since}
    GROUP BY LEAST(position, 10)
    ORDER BY position ASC
  `;

  return rows.map((r) => {
    const imp = Number(r.impressions);
    const cli = Number(r.clicks);
    return {
      position: r.position,
      ctr: imp > 0 ? Math.round((cli / imp) * 10000) / 100 : 0,
      impressions: imp,
    };
  });
}

export interface DailyRecommendationTrend {
  day: string;
  impressions: number;
  clicks: number;
}

export async function getDailyRecommendationTrend(since: Date): Promise<DailyRecommendationTrend[]> {
  const rows = await prisma.$queryRaw<
    Array<{ day: Date; impressions: bigint; clicks: bigint }>
  >`
    SELECT
      DATE_TRUNC('day', "createdAt")::date AS day,
      COUNT(*) FILTER (WHERE "impressed" = true)::bigint AS impressions,
      COUNT(*) FILTER (WHERE "clicked" = true)::bigint AS clicks
    FROM "RecommendationLog"
    WHERE "createdAt" >= ${since}
    GROUP BY DATE_TRUNC('day', "createdAt")
    ORDER BY day ASC
  `;

  return rows.map((r) => ({
    day: r.day.toISOString().split('T')[0],
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
  }));
}

export interface TopRecommended {
  podcastId: string;
  title: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  avgListenPercent: number;
}

export async function getTopRecommendedPodcasts(
  since: Date,
  limit: number = 15
): Promise<TopRecommended[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      podcastId: string;
      title: string | null;
      impressions: bigint;
      clicks: bigint;
      avgListened: number | null;
    }>
  >`
    SELECT
      rl."podcastId",
      p.title,
      COUNT(*) FILTER (WHERE rl."impressed" = true)::bigint AS impressions,
      COUNT(*) FILTER (WHERE rl."clicked" = true)::bigint AS clicks,
      AVG(rl."listenedPercent") FILTER (WHERE rl."listenedPercent" IS NOT NULL)::float AS "avgListened"
    FROM "RecommendationLog" rl
    JOIN "Podcast" p ON p.id = rl."podcastId"
    WHERE rl."createdAt" >= ${since}
    GROUP BY rl."podcastId", p.title
    ORDER BY impressions DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => {
    const imp = Number(r.impressions);
    const cli = Number(r.clicks);
    return {
      podcastId: r.podcastId,
      title: r.title,
      impressions: imp,
      clicks: cli,
      ctr: imp > 0 ? Math.round((cli / imp) * 10000) / 100 : 0,
      avgListenPercent: Math.round((r.avgListened ?? 0) * 10) / 10,
    };
  });
}
