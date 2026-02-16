import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { subDays, startOfDay } from 'date-fns';

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (user?.role !== 'ADMIN') return null;
  return session.user.id;
}

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const thirtyDaysAgo = subDays(startOfDay(new Date()), 30);

  const [
    totalMentions,
    mentionsByStatus,
    recentMentions,
    totalAutoTweets,
    autoTweetsByStatus,
    recentAutoTweets,
  ] = await Promise.all([
    prisma.tweetMention.count(),
    prisma.tweetMention.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    prisma.tweetMention.count({
      where: { createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.twitterAutoTweet.count(),
    prisma.twitterAutoTweet.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    prisma.twitterAutoTweet.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { podcast: { select: { title: true } } },
    }),
  ]);

  // Count podcasts generated from Twitter
  const podcastsFromTwitter = await prisma.podcast.count({
    where: { source: 'TWITTER' },
  });

  // Count successful podcasts from Twitter
  const successfulTwitterPodcasts = await prisma.podcast.count({
    where: { source: 'TWITTER', status: 'READY' },
  });

  // Compute mention status breakdown
  const statusBreakdown: Record<string, number> = {};
  for (const group of mentionsByStatus) {
    statusBreakdown[group.status] = group._count.id;
  }

  // Compute auto-tweet status breakdown
  const autoTweetBreakdown: Record<string, number> = {};
  for (const group of autoTweetsByStatus) {
    autoTweetBreakdown[group.status] = group._count.id;
  }

  const successRate =
    podcastsFromTwitter > 0
      ? Math.round((successfulTwitterPodcasts / podcastsFromTwitter) * 100)
      : 0;

  return NextResponse.json({
    mentions: {
      total: totalMentions,
      last30Days: recentMentions,
      statusBreakdown,
    },
    autoTweets: {
      total: totalAutoTweets,
      statusBreakdown: autoTweetBreakdown,
      recent: recentAutoTweets,
    },
    podcasts: {
      totalFromTwitter: podcastsFromTwitter,
      successful: successfulTwitterPodcasts,
      successRate,
    },
  });
}
