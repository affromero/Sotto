/**
 * Per-podcast analytics queries.
 * Used by the podcast owner analytics page (/podcast/[id]/analytics).
 */

import { prisma } from './prisma';

export interface PodcastOverviewData {
  plays: number;
  uniqueListeners: number;
  avgCompletion: number;
  listenHours: number;
  likes: number;
  saves: number;
  forks: number;
  comments: number;
  interactions: number;
}

export async function getPodcastOverview(podcastId: string): Promise<PodcastOverviewData> {
  const [podcast, sessionAgg, uniqueListeners, interactions] = await Promise.all([
    prisma.podcast.findUnique({
      where: { id: podcastId },
      select: { playCount: true, likeCount: true, forkCount: true, saveCount: true, commentCount: true },
    }),
    prisma.playbackSession.aggregate({
      where: { podcastId },
      _sum: { totalListenSeconds: true },
      _avg: { completionPercent: true },
    }),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "userId")::bigint AS count
      FROM "PlaybackSession"
      WHERE "podcastId" = ${podcastId}
        AND "userId" IS NOT NULL
    `,
    prisma.interaction.count({ where: { podcastId } }),
  ]);

  return {
    plays: podcast?.playCount ?? 0,
    uniqueListeners: Number(uniqueListeners[0]?.count ?? 0),
    avgCompletion: sessionAgg._avg.completionPercent ?? 0,
    listenHours: (sessionAgg._sum.totalListenSeconds ?? 0) / 3600,
    likes: podcast?.likeCount ?? 0,
    saves: podcast?.saveCount ?? 0,
    forks: podcast?.forkCount ?? 0,
    comments: podcast?.commentCount ?? 0,
    interactions,
  };
}

export interface PodcastDailyPlaysData {
  day: string;
  plays: number;
}

export async function getPodcastDailyPlays(
  podcastId: string,
  since: Date
): Promise<PodcastDailyPlaysData[]> {
  const rows = await prisma.$queryRaw<Array<{ day: Date; plays: bigint }>>`
    SELECT
      DATE_TRUNC('day', "startedAt")::date AS day,
      COUNT(*)::bigint AS plays
    FROM "PlaybackSession"
    WHERE "podcastId" = ${podcastId}
      AND "startedAt" >= ${since}
    GROUP BY DATE_TRUNC('day', "startedAt")
    ORDER BY day ASC
  `;

  return rows.map((r) => ({
    day: r.day.toISOString().split('T')[0],
    plays: Number(r.plays),
  }));
}

export interface RetentionBucket {
  percentBucket: number;
  abandonRate: number;
}

export async function getPodcastRetentionCurve(podcastId: string): Promise<RetentionBucket[] | null> {
  const feature = await prisma.podcastFeature.findUnique({
    where: { podcastId },
    select: { abandonmentCurve: true },
  });

  if (!feature?.abandonmentCurve) return null;

  return feature.abandonmentCurve as unknown as RetentionBucket[];
}

export interface PodcastEngagementData {
  likes: number;
  saves: number;
  forks: number;
  comments: number;
  interactions: number;
  upvotes: number;
}

export async function getPodcastEngagement(podcastId: string): Promise<PodcastEngagementData> {
  const [podcast, interactions, upvotes] = await Promise.all([
    prisma.podcast.findUnique({
      where: { id: podcastId },
      select: { likeCount: true, saveCount: true, forkCount: true, commentCount: true },
    }),
    prisma.interaction.count({ where: { podcastId } }),
    prisma.interaction.aggregate({
      where: { podcastId },
      _sum: { upvoteCount: true },
    }),
  ]);

  return {
    likes: podcast?.likeCount ?? 0,
    saves: podcast?.saveCount ?? 0,
    forks: podcast?.forkCount ?? 0,
    comments: podcast?.commentCount ?? 0,
    interactions,
    upvotes: upvotes._sum.upvoteCount ?? 0,
  };
}

export interface ListenerBehaviorData {
  speedDistribution: Array<{ speed: string; count: number }>;
  completionDistribution: Array<{ bucket: string; count: number }>;
}

export async function getPodcastListenerBehavior(podcastId: string): Promise<ListenerBehaviorData> {
  const [speedDist, completionDist] = await Promise.all([
    prisma.$queryRaw<Array<{ speed: string; count: bigint }>>`
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
      WHERE "podcastId" = ${podcastId}
      GROUP BY speed
      ORDER BY count DESC
    `,
    prisma.$queryRaw<Array<{ bucket: string; count: bigint }>>`
      SELECT
        CASE
          WHEN "completionPercent" < 25 THEN '0-25%'
          WHEN "completionPercent" < 50 THEN '25-50%'
          WHEN "completionPercent" < 75 THEN '50-75%'
          ELSE '75-100%'
        END AS bucket,
        COUNT(*)::bigint AS count
      FROM "PlaybackSession"
      WHERE "podcastId" = ${podcastId}
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
  ]);

  return {
    speedDistribution: speedDist.map((s) => ({ speed: s.speed, count: Number(s.count) })),
    completionDistribution: completionDist.map((c) => ({ bucket: c.bucket, count: Number(c.count) })),
  };
}

export interface TrafficSourceData {
  source: string;
  percentage: number;
}

export async function getPodcastTrafficSources(podcastId: string): Promise<TrafficSourceData[] | null> {
  const feature = await prisma.podcastFeature.findUnique({
    where: { podcastId },
    select: { completionBySource: true },
  });

  if (!feature?.completionBySource) return null;

  const sources = feature.completionBySource as unknown as Record<string, number>;
  return Object.entries(sources).map(([source, percentage]) => ({ source, percentage }));
}
