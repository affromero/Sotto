import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasByokKey } from '@/lib/byok';
import { getTierFeatures } from '@/lib/tier-features';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = session.user.id;

  // Verify ownership
  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true, title: true, createdAt: true, playCount: true },
  });

  if (!podcast) {
    return errorResponse('Not found', 404);
  }
  if (podcast.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }

  // Gate: Pro or BYOK only
  const [user, hasTts] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true, role: true } }),
    hasByokKey(userId),
  ]);

  const isPrivileged = user.role === 'ADMIN' || user.role === 'SYSTEM';
  const features = getTierFeatures(user.plan as 'FREE' | 'PRO', hasTts, user.role);

  if (!features.analyticsEnabled && !isPrivileged) {
    return errorResponse(
      'Analytics are a Pro feature. Upgrade to Pro to access creator analytics.',
      403,
      { code: 'pro_required' }
    );
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Gather all analytics in parallel
  const [playEvents, completeEvents, questionCount, answeredQuestionCount, dailyPlays] =
    await Promise.all([
      // Total play events (unique sessions = unique listeners estimate)
      prisma.behavioralEvent.findMany({
        where: { podcastId, eventType: 'playback.play' },
        select: { sessionId: true, userId: true },
      }),

      // Completion events with progress data
      prisma.behavioralEvent.findMany({
        where: { podcastId, eventType: 'playback.complete' },
        select: { eventData: true },
      }),

      // Private question count
      prisma.interaction.count({ where: { podcastId } }),

      // Answered private question count
      prisma.interaction.count({ where: { podcastId, answer: { not: null } } }),

      // Daily plays over last 30 days
      prisma.behavioralEvent.groupBy({
        by: ['createdAt'],
        where: {
          podcastId,
          eventType: 'playback.play',
          createdAt: { gte: thirtyDaysAgo },
        },
        _count: { id: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

  const uniqueListeners = new Set(playEvents.map((e) => e.sessionId)).size;
  const totalPlays = podcast.playCount ?? playEvents.length;

  // Completion rate distribution (0-25%, 25-50%, 50-75%, 75-100%)
  const completionBuckets = { q1: 0, q2: 0, q3: 0, q4: 0 };
  for (const e of completeEvents) {
    const data = e.eventData as { progress?: number };
    const progress = data?.progress ?? 1;
    if (progress < 0.25) completionBuckets.q1++;
    else if (progress < 0.5) completionBuckets.q2++;
    else if (progress < 0.75) completionBuckets.q3++;
    else completionBuckets.q4++;
  }

  // Aggregate daily plays into day buckets
  const dayMap = new Map<string, number>();
  for (const row of dailyPlays) {
    const day = row.createdAt.toISOString().slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + row._count.id);
  }

  // Fill all 30 days (including zeros)
  const playsByDay: Array<{ date: string; plays: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const day = d.toISOString().slice(0, 10);
    playsByDay.push({ date: day, plays: dayMap.get(day) ?? 0 });
  }

  return NextResponse.json({
    podcastId,
    title: podcast.title,
    createdAt: podcast.createdAt,
    totalPlays,
    uniqueListeners,
    completionDistribution: completionBuckets,
    completionRate:
      completeEvents.length > 0 && totalPlays > 0
        ? Math.round((completeEvents.length / totalPlays) * 100)
        : 0,
    questionCount,
    answeredQuestionCount,
    playsByDay,
  });
}
