/**
 * Quality analytics queries for the investor-facing dashboard.
 * Aggregate rating data by provider, topic, and time period.
 */

import { prisma } from './prisma';

export interface ModelUsageRow {
  providerType: 'tts' | 'ai';
  provider: string;
  model: string | null;
  podcastCount: number;
  avgSatisfaction: number;
}

export async function getModelUsageDistribution(since: Date): Promise<ModelUsageRow[]> {
  const [tts, ai] = await Promise.all([
    prisma.$queryRaw<Array<{ provider: string; model: string | null; podcastCount: bigint; avgSatisfaction: number }>>`
      SELECT
        p."ttsProvider" AS provider,
        p."ttsModel" AS model,
        COUNT(DISTINCT p.id)::bigint AS "podcastCount",
        AVG(r."overallSatisfaction")::float AS "avgSatisfaction"
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      WHERE p."ttsProvider" IS NOT NULL AND p."deletedAt" IS NULL AND r."createdAt" >= ${since}
      GROUP BY p."ttsProvider", p."ttsModel"
      ORDER BY "podcastCount" DESC
    `,
    prisma.$queryRaw<Array<{ provider: string; model: string | null; podcastCount: bigint; avgSatisfaction: number }>>`
      SELECT
        p."aiProvider" AS provider,
        p."aiModel" AS model,
        COUNT(DISTINCT p.id)::bigint AS "podcastCount",
        AVG(r."overallSatisfaction")::float AS "avgSatisfaction"
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      WHERE p."aiProvider" IS NOT NULL AND p."deletedAt" IS NULL AND r."createdAt" >= ${since}
      GROUP BY p."aiProvider", p."aiModel"
      ORDER BY "podcastCount" DESC
    `,
  ]);

  return [
    ...tts.map((r) => ({
      providerType: 'tts' as const,
      provider: r.provider,
      model: r.model,
      podcastCount: Number(r.podcastCount),
      avgSatisfaction: Math.round(r.avgSatisfaction * 10) / 10,
    })),
    ...ai.map((r) => ({
      providerType: 'ai' as const,
      provider: r.provider,
      model: r.model,
      podcastCount: Number(r.podcastCount),
      avgSatisfaction: Math.round(r.avgSatisfaction * 10) / 10,
    })),
  ];
}

export interface QualityTrendRow {
  week: string;
  avgVoice: number;
  avgAccuracy: number;
  avgFlow: number;
  avgOverall: number;
  ratingCount: number;
}

export async function getQualityTrend(since: Date): Promise<QualityTrendRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      week: Date;
      avgVoice: number;
      avgAccuracy: number;
      avgFlow: number;
      avgOverall: number;
      ratingCount: bigint;
    }>
  >`
    SELECT
      DATE_TRUNC('week', r."createdAt") AS week,
      AVG(r."voiceNaturalness")::float AS "avgVoice",
      AVG(r."contentAccuracy")::float AS "avgAccuracy",
      AVG(r."conversationFlow")::float AS "avgFlow",
      AVG(r."overallSatisfaction")::float AS "avgOverall",
      COUNT(*)::bigint AS "ratingCount"
    FROM "PodcastRating" r
    WHERE r."createdAt" >= ${since}
    GROUP BY DATE_TRUNC('week', r."createdAt")
    ORDER BY week
  `;

  return rows.map((r) => ({
    week: r.week.toISOString().slice(0, 10),
    avgVoice: Math.round(r.avgVoice * 10) / 10,
    avgAccuracy: Math.round(r.avgAccuracy * 10) / 10,
    avgFlow: Math.round(r.avgFlow * 10) / 10,
    avgOverall: Math.round(r.avgOverall * 10) / 10,
    ratingCount: Number(r.ratingCount),
  }));
}

export interface BestModelByTopicRow {
  topic: string;
  bestTtsProvider: string | null;
  bestTtsScore: number | null;
  bestAiProvider: string | null;
  bestAiScore: number | null;
  ratingCount: number;
}

export async function getBestModelByTopic(since: Date): Promise<BestModelByTopicRow[]> {
  const [bestTts, bestAi] = await Promise.all([
    prisma.$queryRaw<Array<{ topic: string; provider: string; avgScore: number; cnt: bigint }>>`
      SELECT DISTINCT ON (t.slug)
        t.name AS topic,
        p."ttsProvider" AS provider,
        AVG(r."voiceNaturalness")::float AS "avgScore",
        COUNT(*)::bigint AS cnt
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      JOIN "PodcastTag" pt ON p.id = pt."podcastId"
      JOIN "Tag" t ON pt."tagId" = t.id
      WHERE p."ttsProvider" IS NOT NULL
        AND t."parentId" IS NULL
        AND p."deletedAt" IS NULL
        AND r."createdAt" >= ${since}
      GROUP BY t.slug, t.name, p."ttsProvider"
      HAVING COUNT(*) >= 2
      ORDER BY t.slug, "avgScore" DESC
    `,
    prisma.$queryRaw<Array<{ topic: string; provider: string; avgScore: number; cnt: bigint }>>`
      SELECT DISTINCT ON (t.slug)
        t.name AS topic,
        p."aiProvider" AS provider,
        AVG(r."contentAccuracy")::float AS "avgScore",
        COUNT(*)::bigint AS cnt
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      JOIN "PodcastTag" pt ON p.id = pt."podcastId"
      JOIN "Tag" t ON pt."tagId" = t.id
      WHERE p."aiProvider" IS NOT NULL
        AND t."parentId" IS NULL
        AND p."deletedAt" IS NULL
        AND r."createdAt" >= ${since}
      GROUP BY t.slug, t.name, p."aiProvider"
      HAVING COUNT(*) >= 2
      ORDER BY t.slug, "avgScore" DESC
    `,
  ]);

  const topicMap = new Map<string, BestModelByTopicRow>();

  for (const row of bestTts) {
    topicMap.set(row.topic, {
      topic: row.topic,
      bestTtsProvider: row.provider,
      bestTtsScore: Math.round(row.avgScore * 10) / 10,
      bestAiProvider: null,
      bestAiScore: null,
      ratingCount: Number(row.cnt),
    });
  }

  for (const row of bestAi) {
    const existing = topicMap.get(row.topic);
    if (existing) {
      existing.bestAiProvider = row.provider;
      existing.bestAiScore = Math.round(row.avgScore * 10) / 10;
      existing.ratingCount = Math.max(existing.ratingCount, Number(row.cnt));
    } else {
      topicMap.set(row.topic, {
        topic: row.topic,
        bestTtsProvider: null,
        bestTtsScore: null,
        bestAiProvider: row.provider,
        bestAiScore: Math.round(row.avgScore * 10) / 10,
        ratingCount: Number(row.cnt),
      });
    }
  }

  return Array.from(topicMap.values()).sort((a, b) => a.topic.localeCompare(b.topic));
}

export interface RatingVolumeRow {
  week: string;
  creatorCount: number;
  listenerCount: number;
}

export async function getRatingVolumeTrend(since: Date): Promise<RatingVolumeRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ week: Date; creatorCount: bigint; listenerCount: bigint }>
  >`
    SELECT
      DATE_TRUNC('week', r."createdAt") AS week,
      COUNT(*) FILTER (WHERE r."isCreator" = true)::bigint AS "creatorCount",
      COUNT(*) FILTER (WHERE r."isCreator" = false)::bigint AS "listenerCount"
    FROM "PodcastRating" r
    WHERE r."createdAt" >= ${since}
    GROUP BY DATE_TRUNC('week', r."createdAt")
    ORDER BY week
  `;

  return rows.map((r) => ({
    week: r.week.toISOString().slice(0, 10),
    creatorCount: Number(r.creatorCount),
    listenerCount: Number(r.listenerCount),
  }));
}

export interface OverallQualityScore {
  avgSatisfaction: number;
  totalRatings: number;
  creatorRatings: number;
  listenerRatings: number;
  ratingGrowthPercent: number;
  topRatedModel: string | null;
}

export async function getOverallQualityScore(since: Date): Promise<OverallQualityScore> {
  const halfRange = Math.max((Date.now() - since.getTime()) / 2, 1);
  const midpoint = new Date(since.getTime() + halfRange);

  const [overall, periodSplit, topModel] = await Promise.all([
    prisma.$queryRaw<[{
      avgSatisfaction: number | null;
      totalRatings: bigint;
      creatorRatings: bigint;
      listenerRatings: bigint;
    }]>`
      SELECT
        AVG(r."overallSatisfaction")::float AS "avgSatisfaction",
        COUNT(*)::bigint AS "totalRatings",
        COUNT(*) FILTER (WHERE r."isCreator" = true)::bigint AS "creatorRatings",
        COUNT(*) FILTER (WHERE r."isCreator" = false)::bigint AS "listenerRatings"
      FROM "PodcastRating" r
      WHERE r."createdAt" >= ${since}
    `,

    prisma.$queryRaw<Array<{ period: string; cnt: bigint }>>`
      SELECT
        CASE WHEN r."createdAt" < ${midpoint} THEN 'first' ELSE 'second' END AS period,
        COUNT(*)::bigint AS cnt
      FROM "PodcastRating" r
      WHERE r."createdAt" >= ${since}
      GROUP BY period
    `,

    prisma.$queryRaw<Array<{ provider: string; model: string | null; avgSat: number }>>`
      SELECT
        p."ttsProvider" AS provider,
        p."ttsModel" AS model,
        AVG(r."overallSatisfaction")::float AS "avgSat"
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      WHERE p."ttsProvider" IS NOT NULL AND p."deletedAt" IS NULL AND r."createdAt" >= ${since}
      GROUP BY p."ttsProvider", p."ttsModel"
      HAVING COUNT(*) >= 2
      ORDER BY "avgSat" DESC
      LIMIT 1
    `,
  ]);

  const data = overall[0];
  const firstHalf = Number(periodSplit.find((p) => p.period === 'first')?.cnt ?? 0);
  const secondHalf = Number(periodSplit.find((p) => p.period === 'second')?.cnt ?? 0);
  const growthPercent = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : 0;

  const top = topModel[0];
  const topModelLabel = top ? `${top.provider}${top.model ? ` / ${top.model}` : ''}` : null;

  return {
    avgSatisfaction: Math.round((data.avgSatisfaction ?? 0) * 10) / 10,
    totalRatings: Number(data.totalRatings),
    creatorRatings: Number(data.creatorRatings),
    listenerRatings: Number(data.listenerRatings),
    ratingGrowthPercent: growthPercent,
    topRatedModel: topModelLabel,
  };
}
