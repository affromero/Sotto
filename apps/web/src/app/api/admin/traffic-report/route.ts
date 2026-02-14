import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { subDays, startOfDay } from 'date-fns';
import { getCostBreakdown, getDailyCostTrend } from '@/lib/cost-monitor';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function mapPeriodToCostPeriod(days: number): '24h' | '7d' | '30d' | '90d' {
  if (days <= 1) return '24h';
  if (days <= 7) return '7d';
  if (days <= 30) return '30d';
  return '90d';
}

export async function GET(request: NextRequest) {
  const key = process.env.ADMIN_REPORT_KEY;
  if (!key) {
    return NextResponse.json({ error: 'ADMIN_REPORT_KEY not configured' }, { status: 500 });
  }

  const auth = request.headers.get('authorization');
  if (!auth || auth !== `Bearer ${key}`) {
    return unauthorized();
  }

  const periodParam = request.nextUrl.searchParams.get('period') ?? '7';
  const periodDays = Math.max(1, Math.min(90, parseInt(periodParam, 10) || 7));
  const since = subDays(startOfDay(new Date()), periodDays);

  const now = new Date();
  const today = startOfDay(now);
  const weekAgo = subDays(today, 7);
  const monthAgo = subDays(today, 30);

  const [
    // Traffic
    pageViews,
    uniqueVisitors,
    topPages,
    referrers,
    devices,
    dailyVisitors,
    avgPages,
    // Waitlist
    waitlistTotal,
    waitlistRecent,
    waitlistBySource,
    // Users
    totalUsers,
    signupsToday,
    signupsThisWeek,
    signupsThisMonth,
    // Podcasts
    totalPodcasts,
    podcastsByStatus,
    totalPlays,
    // Playback
    playbackStats,
    // Costs
    costBreakdown,
    dailyCostTrend,
  ] = await Promise.all([
    // --- Traffic ---
    prisma.behavioralEvent.count({
      where: { eventType: 'page.view', createdAt: { gte: since } },
    }),
    prisma.userSession.count({
      where: { startedAt: { gte: since } },
    }),
    prisma.behavioralEvent.groupBy({
      by: ['pageUrl'],
      where: { eventType: 'page.view', createdAt: { gte: since }, pageUrl: { not: null } },
      _count: true,
      orderBy: { _count: { pageUrl: 'desc' } },
      take: 20,
    }),
    prisma.userSession.groupBy({
      by: ['referrer'],
      where: { startedAt: { gte: since }, referrer: { not: null } },
      _count: true,
      orderBy: { _count: { referrer: 'desc' } },
      take: 15,
    }),
    prisma.userSession.groupBy({
      by: ['deviceType'],
      where: { startedAt: { gte: since } },
      _count: true,
    }),
    prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT DATE_TRUNC('day', "startedAt") AS day, COUNT(*)::bigint AS count
      FROM "UserSession"
      WHERE "startedAt" >= ${since}
      GROUP BY DATE_TRUNC('day', "startedAt")
      ORDER BY day ASC
    `,
    prisma.userSession.aggregate({
      where: { startedAt: { gte: since } },
      _avg: { pageCount: true },
    }),
    // --- Waitlist ---
    prisma.waitlist.count(),
    prisma.waitlist.count({
      where: { createdAt: { gte: since } },
    }),
    prisma.waitlist.groupBy({
      by: ['source'],
      _count: true,
      orderBy: { _count: { source: 'desc' } },
    }),
    // --- Users ---
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { createdAt: { gte: monthAgo } } }),
    // --- Podcasts ---
    prisma.podcast.count(),
    prisma.podcast.groupBy({
      by: ['status'],
      _count: true,
    }),
    prisma.podcast.aggregate({
      _sum: { playCount: true },
    }),
    // --- Playback ---
    prisma.playbackSession.aggregate({
      where: { startedAt: { gte: since } },
      _avg: { completionPercent: true, totalListenSeconds: true },
      _count: { id: true },
    }),
    // --- Costs ---
    getCostBreakdown(mapPeriodToCostPeriod(periodDays)),
    getDailyCostTrend(periodDays),
  ]);

  const response = {
    meta: {
      generatedAt: now.toISOString(),
      periodDays,
      since: since.toISOString(),
    },
    traffic: {
      pageViews,
      uniqueVisitors,
      avgPagesPerSession: avgPages._avg.pageCount ?? 0,
      topPages: topPages.map((p) => ({
        url: p.pageUrl ?? 'Unknown',
        count: p._count,
      })),
      referrers: referrers.map((r) => ({
        referrer: r.referrer ?? 'Direct',
        count: r._count,
      })),
      devices: devices.map((d) => ({
        type: d.deviceType ?? 'Unknown',
        count: d._count,
      })),
      dailyVisitors: dailyVisitors.map((d) => ({
        day: d.day.toISOString().split('T')[0],
        count: Number(d.count),
      })),
    },
    waitlist: {
      total: waitlistTotal,
      recentSignups: waitlistRecent,
      bySource: waitlistBySource.map((s) => ({
        source: s.source ?? 'unknown',
        count: s._count,
      })),
    },
    users: {
      total: totalUsers,
      signupsToday,
      signupsThisWeek,
      signupsThisMonth,
    },
    podcasts: {
      total: totalPodcasts,
      byStatus: Object.fromEntries(
        podcastsByStatus.map((s) => [s.status, s._count])
      ),
      totalPlays: totalPlays._sum.playCount ?? 0,
    },
    playback: {
      sessionsInPeriod: playbackStats._count.id,
      avgCompletionPercent: playbackStats._avg.completionPercent ?? 0,
      avgListenSeconds: playbackStats._avg.totalListenSeconds ?? 0,
    },
    costs: {
      breakdown: costBreakdown,
      dailyTrend: dailyCostTrend,
    },
  };

  return NextResponse.json(response);
}
