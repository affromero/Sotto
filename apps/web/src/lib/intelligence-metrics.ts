/**
 * Platform intelligence queries for admin content analytics.
 * Aggregate-level queries for platform decision-making.
 */

import { prisma } from './prisma';

export interface HeatmapCell {
  dayOfWeek: number;
  hour: number;
  listenMinutes: number;
}

export async function getPeakUsageHeatmap(since: Date): Promise<HeatmapCell[]> {
  const rows = await prisma.$queryRaw<
    Array<{ dow: number; hour: number; minutes: number }>
  >`
    SELECT
      EXTRACT(DOW FROM "startedAt")::int AS dow,
      EXTRACT(HOUR FROM "startedAt")::int AS hour,
      (COALESCE(SUM("totalListenSeconds"), 0) / 60)::float AS minutes
    FROM "PlaybackSession"
    WHERE "startedAt" >= ${since}
    GROUP BY dow, hour
    ORDER BY dow, hour
  `;

  return rows.map((r) => ({
    dayOfWeek: r.dow,
    hour: r.hour,
    listenMinutes: Math.round(r.minutes * 10) / 10,
  }));
}

export interface DurationTopicRow {
  topic: string;
  durationBucket: string;
  avgCompletion: number;
  podcastCount: number;
}

export async function getOptimalDurationByTopic(since: Date): Promise<DurationTopicRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ topic: string; bucket: string; avgCompletion: number; podcastCount: bigint }>
  >`
    SELECT
      t.name AS topic,
      CASE
        WHEN p.duration < 300 THEN '0-5m'
        WHEN p.duration < 600 THEN '5-10m'
        WHEN p.duration < 900 THEN '10-15m'
        WHEN p.duration < 1200 THEN '15-20m'
        WHEN p.duration < 1800 THEN '20-30m'
        ELSE '30m+'
      END AS bucket,
      AVG(ps."completionPercent")::float AS "avgCompletion",
      COUNT(DISTINCT p.id)::bigint AS "podcastCount"
    FROM "PlaybackSession" ps
    JOIN "Podcast" p ON p.id = ps."podcastId"
    JOIN "PodcastTag" pt ON pt."podcastId" = p.id
    JOIN "Tag" t ON t.id = pt."tagId"
    WHERE ps."startedAt" >= ${since}
      AND p."deletedAt" IS NULL
    GROUP BY t.name, bucket
    HAVING COUNT(DISTINCT p.id) >= 2
    ORDER BY t.name, "avgCompletion" DESC
  `;

  return rows.map((r) => ({
    topic: r.topic,
    durationBucket: r.bucket,
    avgCompletion: Math.round(r.avgCompletion * 10) / 10,
    podcastCount: Number(r.podcastCount),
  }));
}

export interface GenerationListenRatio {
  totalGenerated: number;
  totalListened: number;
  ratio: number;
}

export async function getGenerationToListenRatio(since: Date): Promise<GenerationListenRatio> {
  const [generated, listened] = await Promise.all([
    prisma.podcast.count({
      where: { status: 'READY', createdAt: { gte: since }, deletedAt: null },
    }),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "podcastId")::bigint AS count
      FROM "PlaybackSession"
      WHERE "startedAt" >= ${since}
    `,
  ]);

  const listenedCount = Number(listened[0]?.count ?? 0);
  return {
    totalGenerated: generated,
    totalListened: listenedCount,
    ratio: generated > 0 ? Math.round((listenedCount / generated) * 100) / 100 : 0,
  };
}

export interface SessionDepthData {
  avgDurationMinutes: number;
  bounceRate: number;
  avgPodcastsPerSession: number;
}

export async function getSessionDepth(since: Date): Promise<SessionDepthData> {
  const [sessionAgg, bounceCount, totalSessions, podcastsPerSession] = await Promise.all([
    prisma.$queryRaw<[{ avgMinutes: number }]>`
      SELECT
        AVG(EXTRACT(EPOCH FROM ("lastSeenAt" - "startedAt")) / 60)::float AS "avgMinutes"
      FROM "UserSession"
      WHERE "startedAt" >= ${since}
        AND "lastSeenAt" > "startedAt"
    `,
    prisma.userSession.count({
      where: { startedAt: { gte: since }, pageCount: 1 },
    }),
    prisma.userSession.count({
      where: { startedAt: { gte: since } },
    }),
    prisma.$queryRaw<[{ avg: number }]>`
      SELECT AVG(podcast_count)::float AS avg FROM (
        SELECT us."sessionId", COUNT(DISTINCT ps."podcastId") AS podcast_count
        FROM "UserSession" us
        JOIN "PlaybackSession" ps ON ps."sessionId" = us."sessionId"
        WHERE us."startedAt" >= ${since}
        GROUP BY us."sessionId"
      ) sub
    `,
  ]);

  return {
    avgDurationMinutes: Math.round((sessionAgg[0]?.avgMinutes ?? 0) * 10) / 10,
    bounceRate: totalSessions > 0 ? Math.round((bounceCount / totalSessions) * 100) / 100 : 0,
    avgPodcastsPerSession: Math.round((podcastsPerSession[0]?.avg ?? 0) * 10) / 10,
  };
}

export interface ArchetypeCount {
  archetype: string;
  count: number;
}

export async function getAudienceArchetypes(since: Date): Promise<ArchetypeCount[]> {
  const groups = await prisma.userFeature.groupBy({
    by: ['archetype'],
    where: {
      archetype: { not: null },
      computedAt: { gte: since },
    },
    _count: true,
    orderBy: { _count: { archetype: 'desc' } },
  });

  return groups
    .filter((g) => g.archetype !== null)
    .map((g) => ({
      archetype: g.archetype!,
      count: g._count,
    }));
}
