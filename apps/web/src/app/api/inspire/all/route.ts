import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/redis';
import { generateForYouQuestions, generateNewsQuestions } from '@/lib/taste-quiz';
import { getTrending } from '@/lib/recommendation-engine';
import type { PodcastSummary } from '@/types/podcast';
import { logger } from '@/lib/logger';

const inspireAllSchema = z.object({
  section: z.enum(['forYou', 'news']).optional(),
});

/**
 * GET /api/inspire/all
 * Returns all three Inspire Me sections in one call.
 * Optional ?section=forYou|news for single-section refresh ("Load more").
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const validation = inspireAllSchema.safeParse(params);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.errors[0].message }, { status: 400 });
  }

  const { section } = validation.data;
  const userId = session.user.id;

  const rateLimit = await checkRateLimit(`inspire:${userId}`, 10, 3600);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.', resetAt: rateLimit.resetAt },
      { status: 429 }
    );
  }

  // Single-section refresh
  if (section === 'forYou') {
    const forYou = await generateForYouQuestions(userId, 6);
    return NextResponse.json({ forYou });
  }

  if (section === 'news') {
    const news = await generateNewsQuestions(userId, 6);
    return NextResponse.json({ news });
  }

  // Full fetch: trending + forYou in parallel, then news sequentially (needs forYou for dedup)
  const [trendingRaw, forYou] = await Promise.all([
    getTrending().catch((err) => {
      logger.warn('Failed to fetch trending for inspire', { error: (err as Error).message });
      return [];
    }),
    generateForYouQuestions(userId, 6),
  ]);

  const news = await generateNewsQuestions(
    userId,
    6,
    forYou.map((q) => q.text)
  );

  // Map RecommendedPodcast to PodcastSummary shape
  const trending: PodcastSummary[] = trendingRaw.map((p) => ({
    id: p.podcastId,
    title: p.title,
    topic: p.topic,
    status: 'READY' as const,
    visibility: 'PUBLIC' as const,
    audioUrl: p.audioUrl,
    duration: p.duration,
    playCount: p.playCount,
    likeCount: p.likeCount,
    forkCount: p.forkCount,
    createdAt: p.createdAt,
    source: 'WEB' as const,
    isHumanContent: false,
    forkedFromId: null,
    user: { ...p.user, handle: null },
    tags: p.tags,
  }));

  return NextResponse.json({ forYou, trending, news });
}
