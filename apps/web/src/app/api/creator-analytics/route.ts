import { NextRequest, NextResponse } from 'next/server';
import { subDays, subMonths, startOfDay } from 'date-fns';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { analyticsQuerySchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';
import {
  getCreatorOverview,
  getCreatorTopPodcasts,
  getCreatorDailyPlays,
  getCreatorEngagement,
  getCreatorAudienceInsights,
} from '@/lib/creator-metrics';

function periodToDate(period: string): Date {
  switch (period) {
    case '7d':
      return subDays(startOfDay(new Date()), 7);
    case '30d':
      return subDays(startOfDay(new Date()), 30);
    case '90d':
      return subMonths(startOfDay(new Date()), 3);
    case 'all':
      return new Date('2024-01-01');
    default:
      return subDays(startOfDay(new Date()), 30);
  }
}

/**
 * GET /api/creator-analytics — Creator-scoped podcast performance data
 *
 * Query params:
 *   period: '7d' | '30d' | '90d' | 'all' (default: '30d')
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = session.user.id as string;
  const podcastCount = await prisma.podcast.count({ where: { userId, deletedAt: null } });
  if (podcastCount === 0) {
    return errorResponse('No podcasts found', 403);
  }

  const { searchParams } = new URL(request.url);
  const parsed = analyticsQuerySchema.safeParse({ period: searchParams.get('period') || '30d' });
  if (!parsed.success) {
    return errorResponse('Invalid period', 400);
  }

  const since = periodToDate(parsed.data.period);

  const [overview, topPodcasts, dailyPlays, engagement, audienceInsights] = await Promise.all([
    getCreatorOverview(userId, since),
    getCreatorTopPodcasts(userId, since),
    getCreatorDailyPlays(userId, since),
    getCreatorEngagement(userId, since),
    getCreatorAudienceInsights(userId, since),
  ]);

  return NextResponse.json({
    overview,
    topPodcasts,
    dailyPlays,
    engagement,
    audienceInsights,
    period: parsed.data.period,
  });
}
