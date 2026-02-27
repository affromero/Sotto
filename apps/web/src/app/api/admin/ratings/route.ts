import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';

interface ProviderStats {
  ttsProvider: string;
  ratingCount: number;
  avgVoiceNaturalness: number;
  avgContentAccuracy: number;
  avgConversationFlow: number;
  avgOverallSatisfaction: number;
}

interface AiStats {
  aiProvider: string;
  aiModel: string;
  ratingCount: number;
  avgContentAccuracy: number;
  avgConversationFlow: number;
  avgOverallSatisfaction: number;
}

interface SttStats {
  sttProvider: string;
  sttModel: string;
  ratingCount: number;
  avgOverallSatisfaction: number;
}

interface TopicProviderStats {
  tagName: string;
  provider: string;
  ratingCount: number;
  avgScore: number;
}

interface SourceBreakdown {
  isCreator: boolean;
  ratingCount: number;
  avgOverallSatisfaction: number;
}

/**
 * GET /api/admin/ratings — Aggregate ratings by provider (ADMIN only)
 *
 * Query params:
 *   range: '7d' | '30d' | '90d' | 'all' (default: '30d')
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return errorResponse('Unauthorized', 401);
  }
  if (session.user.role !== 'ADMIN') {
    return errorResponse('Admin access required', 403);
  }

  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') || '30d';

  const validRanges = ['7d', '30d', '90d', 'all'];
  if (!validRanges.includes(range)) {
    return errorResponse('Invalid range', 400);
  }

  const daysMap: Record<string, number | null> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
    all: null,
  };
  const days = daysMap[range];
  const since = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : new Date(0);

  const [
    byProvider,
    byAi,
    byStt,
    byTopicTts,
    byTopicAi,
    sourceBreakdown,
    overallAverages,
    recentRatings,
    totalCount,
  ] = await Promise.all([
    // TTS provider breakdown
    prisma.$queryRaw<ProviderStats[]>`
      SELECT
        p."ttsProvider",
        COUNT(*)::int AS "ratingCount",
        AVG(r."voiceNaturalness")::float AS "avgVoiceNaturalness",
        AVG(r."contentAccuracy")::float AS "avgContentAccuracy",
        AVG(r."conversationFlow")::float AS "avgConversationFlow",
        AVG(r."overallSatisfaction")::float AS "avgOverallSatisfaction"
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      WHERE p."ttsProvider" IS NOT NULL AND p."deletedAt" IS NULL AND r."createdAt" >= ${since}
      GROUP BY p."ttsProvider"
      ORDER BY "ratingCount" DESC
    `,

    // AI provider + model breakdown (all dimensions)
    prisma.$queryRaw<AiStats[]>`
      SELECT
        p."aiProvider",
        p."aiModel",
        COUNT(*)::int AS "ratingCount",
        AVG(r."contentAccuracy")::float AS "avgContentAccuracy",
        AVG(r."conversationFlow")::float AS "avgConversationFlow",
        AVG(r."overallSatisfaction")::float AS "avgOverallSatisfaction"
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      WHERE p."aiProvider" IS NOT NULL AND p."deletedAt" IS NULL AND r."createdAt" >= ${since}
      GROUP BY p."aiProvider", p."aiModel"
      ORDER BY "ratingCount" DESC
    `,

    // STT provider + model breakdown
    prisma.$queryRaw<SttStats[]>`
      SELECT
        p."sttProvider",
        p."sttModel",
        COUNT(*)::int AS "ratingCount",
        AVG(r."overallSatisfaction")::float AS "avgOverallSatisfaction"
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      WHERE p."sttProvider" IS NOT NULL AND p."deletedAt" IS NULL AND r."createdAt" >= ${since}
      GROUP BY p."sttProvider", p."sttModel"
      ORDER BY "ratingCount" DESC
    `,

    // Topic × TTS (parent tags only, min 2 ratings)
    prisma.$queryRaw<TopicProviderStats[]>`
      SELECT
        t.name AS "tagName",
        p."ttsProvider" AS "provider",
        COUNT(*)::int AS "ratingCount",
        AVG(r."voiceNaturalness")::float AS "avgScore"
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      JOIN "PodcastTag" pt ON p.id = pt."podcastId"
      JOIN "Tag" t ON pt."tagId" = t.id
      WHERE p."ttsProvider" IS NOT NULL
        AND t."parentId" IS NULL
        AND p."deletedAt" IS NULL
        AND r."createdAt" >= ${since}
      GROUP BY t.name, p."ttsProvider"
      HAVING COUNT(*) >= 2
      ORDER BY t.name, "avgScore" DESC
    `,

    // Topic × AI (parent tags only, min 2 ratings)
    prisma.$queryRaw<TopicProviderStats[]>`
      SELECT
        t.name AS "tagName",
        p."aiProvider" AS "provider",
        COUNT(*)::int AS "ratingCount",
        AVG(r."contentAccuracy")::float AS "avgScore"
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      JOIN "PodcastTag" pt ON p.id = pt."podcastId"
      JOIN "Tag" t ON pt."tagId" = t.id
      WHERE p."aiProvider" IS NOT NULL
        AND t."parentId" IS NULL
        AND p."deletedAt" IS NULL
        AND r."createdAt" >= ${since}
      GROUP BY t.name, p."aiProvider"
      HAVING COUNT(*) >= 2
      ORDER BY t.name, "avgScore" DESC
    `,

    // Creator vs listener breakdown
    prisma.$queryRaw<SourceBreakdown[]>`
      SELECT
        r."isCreator",
        COUNT(*)::int AS "ratingCount",
        AVG(r."overallSatisfaction")::float AS "avgOverallSatisfaction"
      FROM "PodcastRating" r
      WHERE r."createdAt" >= ${since}
      GROUP BY r."isCreator"
    `,

    // Overall averages
    prisma.podcastRating.aggregate({
      where: { createdAt: { gte: since } },
      _avg: {
        voiceNaturalness: true,
        contentAccuracy: true,
        conversationFlow: true,
        overallSatisfaction: true,
      },
    }),

    // Recent ratings
    prisma.podcastRating.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        voiceNaturalness: true,
        contentAccuracy: true,
        conversationFlow: true,
        overallSatisfaction: true,
        comment: true,
        isCreator: true,
        createdAt: true,
        podcast: {
          select: {
            id: true,
            title: true,
            ttsProvider: true,
            aiProvider: true,
            aiModel: true,
            sttProvider: true,
          },
        },
      },
    }),

    // Total count
    prisma.podcastRating.count({
      where: { createdAt: { gte: since } },
    }),
  ]);

  return NextResponse.json({
    range,
    totalCount,
    overallAverages: overallAverages._avg,
    byProvider,
    byAi,
    byStt,
    byTopicTts,
    byTopicAi,
    sourceBreakdown,
    recentRatings,
  });
}
