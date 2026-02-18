/**
 * Playback analytics queries for the admin dashboard.
 * Extracted from traffic-report.ts for reuse.
 */

import { prisma } from './prisma';

export interface PlaybackOverview {
  totalListenHours: number;
  sessionCount: number;
  avgCompletionPercent: number;
  avgListenSeconds: number;
}

export async function getPlaybackOverview(since: Date): Promise<PlaybackOverview> {
  const [agg, sessionCount] = await Promise.all([
    prisma.playbackSession.aggregate({
      where: { startedAt: { gte: since } },
      _sum: { totalListenSeconds: true },
      _avg: { completionPercent: true, totalListenSeconds: true },
    }),
    prisma.playbackSession.count({ where: { startedAt: { gte: since } } }),
  ]);

  return {
    totalListenHours: (agg._sum.totalListenSeconds ?? 0) / 3600,
    sessionCount,
    avgCompletionPercent: agg._avg.completionPercent ?? 0,
    avgListenSeconds: agg._avg.totalListenSeconds ?? 0,
  };
}

export async function getSpeedDistribution(
  since: Date
): Promise<Array<{ speed: string; count: number }>> {
  const rows = await prisma.$queryRaw<Array<{ speed: string; count: bigint }>>`
    SELECT
      CASE
        WHEN "lastSpeed" < 1.0 THEN 'below_1x'
        WHEN "lastSpeed" = 1.0 THEN '1x'
        WHEN "lastSpeed" <= 1.25 THEN '1.25x'
        WHEN "lastSpeed" <= 1.5 THEN '1.5x'
        WHEN "lastSpeed" <= 2.0 THEN '2x'
        ELSE 'above_2x'
      END AS speed,
      COUNT(*)::bigint AS count
    FROM "PlaybackSession"
    WHERE "startedAt" >= ${since}
    GROUP BY speed
    ORDER BY count DESC
  `;

  return rows.map((r) => ({ speed: r.speed, count: Number(r.count) }));
}

export async function getCompletionDistribution(
  since: Date
): Promise<Array<{ bucket: string; count: number }>> {
  const rows = await prisma.$queryRaw<Array<{ bucket: string; count: bigint }>>`
    SELECT
      CASE
        WHEN "completionPercent" < 25 THEN '0-25%'
        WHEN "completionPercent" < 50 THEN '25-50%'
        WHEN "completionPercent" < 75 THEN '50-75%'
        ELSE '75-100%'
      END AS bucket,
      COUNT(*)::bigint AS count
    FROM "PlaybackSession"
    WHERE "startedAt" >= ${since}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  return rows.map((r) => ({ bucket: r.bucket, count: Number(r.count) }));
}

export async function getDailyListenHours(
  since: Date
): Promise<Array<{ day: string; hours: number }>> {
  const rows = await prisma.$queryRaw<Array<{ day: Date; total_seconds: number }>>`
    SELECT
      DATE_TRUNC('day', "startedAt") AS day,
      COALESCE(SUM("totalListenSeconds"), 0)::float AS total_seconds
    FROM "PlaybackSession"
    WHERE "startedAt" >= ${since}
    GROUP BY DATE_TRUNC('day', "startedAt")
    ORDER BY day ASC
  `;

  return rows.map((r) => ({
    day: r.day.toISOString().split('T')[0],
    hours: r.total_seconds / 3600,
  }));
}
