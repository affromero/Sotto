import { prisma } from './prisma';
import { createMLProvider, type ScoredPodcast, type RecommendationSignals } from './providers/ml';
import { logger } from './logger';

const CONFIDENCE_THRESHOLD = 0.45;
const DAILY_PICKS_MAX = 7;
const EXPLORE_MAX = 10;
const TRENDING_COUNT = 6;

export interface PickCategory {
  label: 'Continue Learning' | 'Fresh Perspective' | 'From Your People' | string;
  podcasts: RecommendedPodcast[];
}

export interface RecommendedPodcast {
  podcastId: string;
  title: string;
  topic: string;
  duration: number | null;
  audioUrl: string | null;
  playCount: number;
  likeCount: number;
  forkCount: number;
  createdAt: string;
  user: { id: string; name: string | null; image: string | null };
  tags: Array<{ id: string; name: string; slug: string }>;
  score: number;
  signals: RecommendationSignals;
  explanation: string;
  category: string;
}

export interface DailyPicksResult {
  picks: RecommendedPodcast[];
  categories: PickCategory[];
  refreshBatch: number;
  message?: string;
}

/**
 * Get daily picks for an authenticated user.
 * Returns 5-7 curated picks with explanations, organized in 3 categories.
 */
export async function getDailyPicks(
  userId: string,
  refreshBatch: number = 0
): Promise<DailyPicksResult> {
  const ml = createMLProvider();

  // Get candidate podcasts (exclude user's own, already listened with high completion)
  const listenedIds = await prisma.playbackSession.findMany({
    where: { userId, completionPercent: { gte: 50 } },
    select: { podcastId: true },
    distinct: ['podcastId'],
  });
  const excludeIds = new Set(listenedIds.map((s: { podcastId: string }) => s.podcastId));

  // Also exclude podcasts from previous refresh batches today
  if (refreshBatch > 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const previousRecs = await prisma.recommendationLog.findMany({
      where: {
        userId,
        surface: 'picks',
        createdAt: { gte: today },
        refreshBatch: { lt: refreshBatch },
      },
      select: { podcastId: true },
    });
    previousRecs.forEach((r: { podcastId: string }) => excludeIds.add(r.podcastId));
  }

  const candidates = await prisma.podcast.findMany({
    where: {
      status: 'READY',
      visibility: 'PUBLIC',
      userId: { not: userId },
      id: { notIn: Array.from(excludeIds) as string[] },
    },
    select: {
      id: true,
      title: true,
      topic: true,
      duration: true,
      audioUrl: true,
      playCount: true,
      likeCount: true,
      forkCount: true,
      createdAt: true,
      userId: true,
      user: { select: { id: true, name: true, image: true } },
      tags: { include: { tag: { select: { id: true, name: true, slug: true, parentId: true } } } },
    },
    orderBy: [{ playCount: 'desc' }, { createdAt: 'desc' }],
    take: 50,
  });

  // Score all candidates
  const scored: ScoredPodcast[] = [];
  for (const candidate of candidates) {
    try {
      const result = await ml.computeScore(userId, candidate.id);
      scored.push(result);
    } catch (err) {
      logger.warn('Failed to score podcast', {
        podcastId: candidate.id,
        error: (err as Error).message,
      });
    }
  }

  // Filter by confidence threshold
  const confident = scored
    .filter((s) => s.score >= CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  // Apply MMR diversity: no more than 1 from same creator, at least 3 tags
  const selected = applyDiversity(confident, candidates, DAILY_PICKS_MAX);

  // Categorize into slots
  const [followedIds, userInterests] = await Promise.all([
    prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    }),
    prisma.userInterest.findMany({
      where: { userId },
      include: { tag: { select: { id: true, name: true, parentId: true } } },
    }),
  ]);
  const followedSet = new Set(followedIds.map((f) => f.followingId));
  const interestTagIds = new Set(userInterests.map((i) => i.tag.id));
  const interestTagNames = new Map(userInterests.map((i) => [i.tag.id, i.tag.name]));
  // Build parent→name map for sibling matching
  const interestParentIds = new Set(
    userInterests.map((i) => i.tag.parentId).filter((p): p is string => p !== null)
  );

  const categories: PickCategory[] = [
    { label: 'Continue Learning', podcasts: [] },
    { label: 'Fresh Perspective', podcasts: [] },
    { label: 'From Your People', podcasts: [] },
  ];

  for (const pick of selected) {
    const candidate = candidates.find((c) => c.id === pick.podcastId);
    if (!candidate) continue;

    const rec: RecommendedPodcast = {
      podcastId: candidate.id,
      title: candidate.title,
      topic: candidate.topic,
      duration: candidate.duration,
      audioUrl: candidate.audioUrl,
      playCount: candidate.playCount,
      likeCount: candidate.likeCount,
      forkCount: candidate.forkCount,
      createdAt: candidate.createdAt.toISOString(),
      user: candidate.user,
      tags: candidate.tags.map((pt) => pt.tag),
      score: pick.score,
      signals: pick.signals,
      explanation: pick.explanation,
      category: '',
    };

    // Check if podcast matches explicit user interests (exact or sibling via same parent)
    const matchingTag = candidate.tags.find((pt) => interestTagIds.has(pt.tag.id));
    let matchingInterestName = matchingTag ? interestTagNames.get(matchingTag.tag.id) : null;

    // Sibling match: podcast tag shares a parent with one of the user's interest tags
    if (!matchingInterestName) {
      const siblingTag = candidate.tags.find((pt) => {
        return pt.tag.parentId && interestParentIds.has(pt.tag.parentId);
      });
      if (siblingTag) {
        const relatedInterest = userInterests.find((i) => i.tag.parentId === siblingTag.tag.parentId);
        matchingInterestName = relatedInterest?.tag.name ?? siblingTag.tag.name;
      }
    }

    if (followedSet.has(candidate.userId) && categories[2].podcasts.length < 2) {
      rec.category = 'From Your People';
      categories[2].podcasts.push(rec);
    } else if (matchingInterestName && categories[0].podcasts.length < 3) {
      rec.category = 'Continue Learning';
      rec.explanation = `Because you're interested in ${matchingInterestName}`;
      categories[0].podcasts.push(rec);
    } else if (pick.signals.novelty > pick.signals.relevance && categories[1].podcasts.length < 2) {
      rec.category = 'Fresh Perspective';
      categories[1].podcasts.push(rec);
    } else if (categories[0].podcasts.length < 3) {
      rec.category = 'Continue Learning';
      categories[0].podcasts.push(rec);
    } else if (categories[1].podcasts.length < 2) {
      rec.category = 'Fresh Perspective';
      categories[1].podcasts.push(rec);
    } else if (categories[2].podcasts.length < 2) {
      rec.category = 'From Your People';
      categories[2].podcasts.push(rec);
    }
  }

  const allPicks = [
    ...categories[0].podcasts,
    ...categories[1].podcasts,
    ...categories[2].podcasts,
  ];

  // Log recommendations
  for (let i = 0; i < allPicks.length; i++) {
    try {
      await prisma.recommendationLog.create({
        data: {
          userId,
          podcastId: allPicks[i].podcastId,
          surface: 'picks',
          position: i,
          score: allPicks[i].score,
          signals: allPicks[i].signals as object,
          explanation: allPicks[i].explanation,
          impressed: true,
          refreshBatch,
        },
      });
    } catch (err) {
      logger.warn('Failed to log recommendation', { error: (err as Error).message });
    }
  }

  const message =
    allPicks.length < 5
      ? "We're still learning your taste — create a podcast about what interests you and we'll get better."
      : undefined;

  return { picks: allPicks, categories, refreshBatch, message };
}

/**
 * Search podcasts with optional auth for personalized ranking.
 * Returns max 10 results.
 */
export async function searchPodcasts(
  query: string,
  filters?: { tag?: string; depth?: string; audience?: string; tone?: string; language?: string },
  userId?: string
): Promise<RecommendedPodcast[]> {
  const where: Record<string, unknown> = {
    status: 'READY',
    visibility: 'PUBLIC',
    OR: [
      { title: { contains: query, mode: 'insensitive' } },
      { topic: { contains: query, mode: 'insensitive' } },
    ],
  };

  if (filters?.tag) {
    where.tags = { some: { tag: { slug: filters.tag } } };
  }
  if (filters?.language) {
    where.language = filters.language;
  }
  if (filters?.depth || filters?.audience || filters?.tone) {
    const discoveryFilter: Record<string, string> = {};
    if (filters.depth) discoveryFilter.depth = filters.depth;
    if (filters.audience) discoveryFilter.audienceLevel = filters.audience;
    if (filters.tone) discoveryFilter.tone = filters.tone;
    where.discovery = discoveryFilter;
  }

  const podcasts = await prisma.podcast.findMany({
    where,
    select: {
      id: true,
      title: true,
      topic: true,
      duration: true,
      audioUrl: true,
      playCount: true,
      likeCount: true,
      forkCount: true,
      createdAt: true,
      user: { select: { id: true, name: true, image: true } },
      tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
    },
    orderBy: [{ playCount: 'desc' }, { likeCount: 'desc' }],
    take: EXPLORE_MAX,
  });

  // If user is authenticated, score and sort
  if (userId) {
    const ml = createMLProvider();
    const scored: RecommendedPodcast[] = [];

    for (const p of podcasts) {
      try {
        const result = await ml.computeScore(userId, p.id);
        scored.push({
          podcastId: p.id,
          title: p.title,
          topic: p.topic,
          duration: p.duration,
          audioUrl: p.audioUrl,
          playCount: p.playCount,
          likeCount: p.likeCount,
          forkCount: p.forkCount,
          createdAt: p.createdAt.toISOString(),
          user: p.user,
          tags: p.tags.map((pt) => pt.tag),
          score: result.score,
          signals: result.signals,
          explanation: result.explanation,
          category: 'explore',
        });
      } catch {
        scored.push({
          podcastId: p.id,
          title: p.title,
          topic: p.topic,
          duration: p.duration,
          audioUrl: p.audioUrl,
          playCount: p.playCount,
          likeCount: p.likeCount,
          forkCount: p.forkCount,
          createdAt: p.createdAt.toISOString(),
          user: p.user,
          tags: p.tags.map((pt) => pt.tag),
          score: 0.5,
          signals: { relevance: 0, collaborative: 0, quality: 0.5, freshness: 0, novelty: 0 },
          explanation: 'Popular in search results',
          category: 'explore',
        });
      }
    }

    return scored.sort((a, b) => b.score - a.score);
  }

  return podcasts.map((p) => ({
    podcastId: p.id,
    title: p.title,
    topic: p.topic,
    duration: p.duration,
    audioUrl: p.audioUrl,
    playCount: p.playCount,
    likeCount: p.likeCount,
    forkCount: p.forkCount,
    createdAt: p.createdAt.toISOString(),
    user: p.user,
    tags: p.tags.map((pt) => pt.tag),
    score: 0,
    signals: { relevance: 0, collaborative: 0, quality: 0, freshness: 0, novelty: 0 },
    explanation: '',
    category: 'explore',
  }));
}

/**
 * Get trending podcasts.
 * Returns 6 podcasts based on engagement velocity (not raw popularity).
 */
export async function getTrending(): Promise<RecommendedPodcast[]> {
  // Engagement velocity: podcasts with most new listens in last 7 days
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const trendingIds = await prisma.playbackSession.groupBy({
    by: ['podcastId'],
    where: { startedAt: { gte: oneWeekAgo } },
    _count: { podcastId: true },
    orderBy: { _count: { podcastId: 'desc' } },
    take: TRENDING_COUNT,
  });

  if (trendingIds.length === 0) {
    // Fallback to most popular
    const popular = await prisma.podcast.findMany({
      where: { status: 'READY', visibility: 'PUBLIC' },
      orderBy: { playCount: 'desc' },
      take: TRENDING_COUNT,
      select: {
        id: true,
        title: true,
        topic: true,
        duration: true,
        audioUrl: true,
        playCount: true,
        likeCount: true,
        forkCount: true,
        createdAt: true,
        user: { select: { id: true, name: true, image: true } },
        tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
      },
    });

    return popular.map((p) => ({
      podcastId: p.id,
      title: p.title,
      topic: p.topic,
      duration: p.duration,
      audioUrl: p.audioUrl,
      playCount: p.playCount,
      likeCount: p.likeCount,
      forkCount: p.forkCount,
      createdAt: p.createdAt.toISOString(),
      user: p.user,
      tags: p.tags.map((pt) => pt.tag),
      score: 0,
      signals: { relevance: 0, collaborative: 0, quality: 0, freshness: 0, novelty: 0 },
      explanation: 'Trending this week',
      category: 'trending',
    }));
  }

  const podcasts = await prisma.podcast.findMany({
    where: {
      id: {
        in: trendingIds.map(
          (t: { podcastId: string; _count: { podcastId: number } }) => t.podcastId
        ),
      },
      status: 'READY',
      visibility: 'PUBLIC',
    },
    select: {
      id: true,
      title: true,
      topic: true,
      duration: true,
      audioUrl: true,
      playCount: true,
      likeCount: true,
      forkCount: true,
      createdAt: true,
      user: { select: { id: true, name: true, image: true } },
      tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
    },
  });

  // Sort by trending order
  const orderMap = new Map(
    trendingIds.map(
      (t: { podcastId: string; _count: { podcastId: number } }, i: number) =>
        [t.podcastId, i] as [string, number]
    )
  );
  podcasts.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

  return podcasts.map((p) => ({
    podcastId: p.id,
    title: p.title,
    topic: p.topic,
    duration: p.duration,
    audioUrl: p.audioUrl,
    playCount: p.playCount,
    likeCount: p.likeCount,
    forkCount: p.forkCount,
    createdAt: p.createdAt.toISOString(),
    user: p.user,
    tags: p.tags.map((pt) => pt.tag),
    score: 0,
    signals: { relevance: 0, collaborative: 0, quality: 0, freshness: 0, novelty: 0 },
    explanation: 'Trending this week',
    category: 'trending',
  }));
}

/**
 * Apply Maximal Marginal Relevance diversity to picks.
 * - No more than 1 podcast from same creator
 * - At least 3 different primary tags
 */
function applyDiversity(
  scored: ScoredPodcast[],
  candidates: Array<{
    id: string;
    userId: string;
    tags: Array<{ tag: { id: string; name: string; slug: string; parentId: string | null } }>;
  }>,
  maxPicks: number
): ScoredPodcast[] {
  const selected: ScoredPodcast[] = [];
  const creatorSeen = new Set<string>();
  const tagCounts = new Map<string, number>();

  for (const pick of scored) {
    if (selected.length >= maxPicks) break;

    const candidate = candidates.find((c) => c.id === pick.podcastId);
    if (!candidate) continue;

    // Creator diversity: max 1 from same creator
    if (creatorSeen.has(candidate.userId)) continue;

    // Tag diversity: max 2 with same primary tag
    const primaryTag = candidate.tags[0]?.tag.id;
    if (primaryTag && (tagCounts.get(primaryTag) || 0) >= 2) continue;

    selected.push(pick);
    creatorSeen.add(candidate.userId);
    if (primaryTag) {
      tagCounts.set(primaryTag, (tagCounts.get(primaryTag) || 0) + 1);
    }
  }

  return selected;
}
