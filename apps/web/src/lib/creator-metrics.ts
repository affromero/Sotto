/**
 * Creator-scoped podcast analytics queries.
 * Follows the engagement-metrics.ts pattern: exported async functions, Promise.all for parallel queries.
 */

import { prisma } from './prisma';
import type {
  CreatorOverview,
  CreatorTopPodcast,
  CreatorDailyPlays,
  CreatorEngagement,
  CreatorAudienceInsights,
} from '@/types/analytics';

export async function getCreatorOverview(userId: string, since: Date): Promise<CreatorOverview> {
  const podcastIds = await prisma.podcast.findMany({
    where: { userId, deletedAt: null },
    select: { id: true },
  });
  const ids = podcastIds.map((p) => p.id);

  if (ids.length === 0) {
    return {
      totalPlays: 0,
      uniqueListeners: 0,
      avgCompletion: 0,
      totalListenHours: 0,
      podcastCount: 0,
    };
  }

  const [playCount, sessionAgg, uniqueListeners] = await Promise.all([
    prisma.playbackSession.count({
      where: { podcastId: { in: ids }, startedAt: { gte: since } },
    }),
    prisma.playbackSession.aggregate({
      where: { podcastId: { in: ids }, startedAt: { gte: since } },
      _sum: { totalListenSeconds: true },
      _avg: { completionPercent: true },
    }),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "userId")::bigint AS count
      FROM "PlaybackSession"
      WHERE "podcastId" = ANY(${ids})
        AND "startedAt" >= ${since}
        AND "userId" IS NOT NULL
    `,
  ]);

  return {
    totalPlays: playCount,
    uniqueListeners: Number(uniqueListeners[0]?.count ?? 0),
    avgCompletion: sessionAgg._avg.completionPercent ?? 0,
    totalListenHours: (sessionAgg._sum.totalListenSeconds ?? 0) / 3600,
    podcastCount: ids.length,
  };
}

export async function getCreatorTopPodcasts(
  userId: string,
  since: Date,
  limit: number = 10
): Promise<CreatorTopPodcast[]> {
  const podcasts = await prisma.podcast.findMany({
    where: { userId, deletedAt: null },
    orderBy: { playCount: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      playCount: true,
      likeCount: true,
      forkCount: true,
    },
  });

  if (podcasts.length === 0) return [];

  const completionData = await prisma.$queryRaw<
    Array<{ podcastId: string; avgCompletion: number }>
  >`
    SELECT
      "podcastId",
      AVG("completionPercent")::float AS "avgCompletion"
    FROM "PlaybackSession"
    WHERE "podcastId" = ANY(${podcasts.map((p) => p.id)})
      AND "startedAt" >= ${since}
    GROUP BY "podcastId"
  `;

  const completionMap = new Map(completionData.map((c) => [c.podcastId, c.avgCompletion]));

  return podcasts.map((p) => ({
    id: p.id,
    title: p.title,
    plays: p.playCount,
    completionPercent: completionMap.get(p.id) ?? 0,
    likes: p.likeCount,
    forks: p.forkCount,
  }));
}

export async function getCreatorDailyPlays(
  userId: string,
  since: Date
): Promise<CreatorDailyPlays[]> {
  const podcastIds = await prisma.podcast.findMany({
    where: { userId, deletedAt: null },
    select: { id: true },
  });
  const ids = podcastIds.map((p) => p.id);

  if (ids.length === 0) return [];

  const rows = await prisma.$queryRaw<Array<{ day: Date; plays: bigint }>>`
    SELECT
      DATE_TRUNC('day', "startedAt")::date AS day,
      COUNT(*)::bigint AS plays
    FROM "PlaybackSession"
    WHERE "podcastId" = ANY(${ids})
      AND "startedAt" >= ${since}
    GROUP BY DATE_TRUNC('day', "startedAt")
    ORDER BY day ASC
  `;

  return rows.map((r) => ({
    day: r.day.toISOString().split('T')[0],
    plays: Number(r.plays),
  }));
}

export async function getCreatorEngagement(
  userId: string,
  since: Date
): Promise<CreatorEngagement> {
  const podcastIds = await prisma.podcast.findMany({
    where: { userId, deletedAt: null },
    select: { id: true },
  });
  const ids = podcastIds.map((p) => p.id);

  if (ids.length === 0) {
    return { likes: 0, saves: 0, comments: 0, forks: 0, follows: 0, interactions: 0 };
  }

  const [likes, saves, comments, forks, follows, interactions] = await Promise.all([
    prisma.like.count({ where: { podcastId: { in: ids }, createdAt: { gte: since } } }),
    prisma.save.count({ where: { podcastId: { in: ids }, createdAt: { gte: since } } }),
    prisma.comment.count({ where: { podcastId: { in: ids }, createdAt: { gte: since } } }),
    prisma.podcast.count({
      where: { forkedFromId: { in: ids }, deletedAt: null, createdAt: { gte: since } },
    }),
    prisma.follow.count({ where: { followingId: userId, createdAt: { gte: since } } }),
    prisma.interaction.count({ where: { podcastId: { in: ids }, createdAt: { gte: since } } }),
  ]);

  return { likes, saves, comments, forks, follows, interactions };
}

export async function getCreatorAudienceInsights(
  userId: string,
  since: Date
): Promise<CreatorAudienceInsights> {
  const podcastIds = await prisma.podcast.findMany({
    where: { userId, deletedAt: null },
    select: { id: true },
  });
  const ids = podcastIds.map((p) => p.id);

  if (ids.length === 0) {
    return { devices: [], sources: [] };
  }

  const [devices, sources] = await Promise.all([
    prisma.$queryRaw<Array<{ device: string; count: bigint }>>`
      SELECT
        COALESCE("deviceType", 'unknown') AS device,
        COUNT(*)::bigint AS count
      FROM "BehavioralEvent"
      WHERE "podcastId" = ANY(${ids})
        AND "eventType" = 'playback.play'
        AND "createdAt" >= ${since}
      GROUP BY COALESCE("deviceType", 'unknown')
      ORDER BY count DESC
    `,
    prisma.$queryRaw<Array<{ source: string; count: bigint }>>`
      SELECT
        CASE
          WHEN rl.id IS NOT NULL THEN 'recommendation'
          WHEN be."referrer" LIKE '%/search%' OR be."referrer" LIKE '%q=%' THEN 'search'
          ELSE 'direct'
        END AS source,
        COUNT(*)::bigint AS count
      FROM "BehavioralEvent" be
      LEFT JOIN "RecommendationLog" rl
        ON rl."userId" = be."userId" AND rl."podcastId" = be."podcastId"
        AND rl."clicked" = true
      WHERE be."podcastId" = ANY(${ids})
        AND be."eventType" = 'playback.play'
        AND be."createdAt" >= ${since}
      GROUP BY source
      ORDER BY count DESC
    `,
  ]);

  return {
    devices: devices.map((d) => ({ device: d.device, count: Number(d.count) })),
    sources: sources.map((s) => ({ source: s.source, count: Number(s.count) })),
  };
}
