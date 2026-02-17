import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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
}

interface RecentRating {
  id: string;
  voiceNaturalness: number;
  contentAccuracy: number;
  conversationFlow: number;
  overallSatisfaction: number;
  comment: string | null;
  createdAt: Date;
  podcast: {
    id: string;
    title: string;
    ttsProvider: string | null;
    aiProvider: string | null;
    aiModel: string | null;
  };
}

/**
 * GET /api/admin/ratings — Aggregate ratings by TTS provider (ADMIN only)
 *
 * Query params:
 *   range: '7d' | '30d' | '90d' | 'all' (default: '30d')
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') || '30d';

  const validRanges = ['7d', '30d', '90d', 'all'];
  if (!validRanges.includes(range)) {
    return NextResponse.json({ error: 'Invalid range' }, { status: 400 });
  }

  const daysMap: Record<string, number | null> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
    all: null,
  };
  const days = daysMap[range];
  const since = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : new Date(0);

  const [byProvider, byAi, overallAverages, recentRatings, totalCount] = await Promise.all([
    // Group by TTS provider
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
      WHERE p."ttsProvider" IS NOT NULL AND r."createdAt" >= ${since}
      GROUP BY p."ttsProvider"
      ORDER BY "ratingCount" DESC
    `,

    // Group by AI provider + model
    prisma.$queryRaw<AiStats[]>`
      SELECT
        p."aiProvider",
        p."aiModel",
        COUNT(*)::int AS "ratingCount",
        AVG(r."contentAccuracy")::float AS "avgContentAccuracy"
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      WHERE p."aiProvider" IS NOT NULL AND r."createdAt" >= ${since}
      GROUP BY p."aiProvider", p."aiModel"
      ORDER BY "ratingCount" DESC
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
        createdAt: true,
        podcast: {
          select: {
            id: true,
            title: true,
            ttsProvider: true,
            aiProvider: true,
            aiModel: true,
          },
        },
      },
    }) as Promise<RecentRating[]>,

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
    recentRatings,
  });
}
