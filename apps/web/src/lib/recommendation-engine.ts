import { prisma } from './prisma';
import { createMLProvider, type ScoredPodcast, type RecommendationSignals } from './providers/ml';
import { logger } from './logger';
import {
  applyDiversity,
  categorizePicks,
  PRIVATE_RECOMMENDATION_CONFIG,
} from './private-recommendations';
import type {
  ScoredCandidate,
  DiversityCandidate,
  CategorizationContext,
} from './private-recommendations';

const CONFIDENCE_THRESHOLD = PRIVATE_RECOMMENDATION_CONFIG.confidenceThreshold;
const DAILY_PICKS_MAX = PRIVATE_RECOMMENDATION_CONFIG.maxPicks;
const EXPLORE_MAX = 10;
const TRENDING_COUNT = 6;

export interface PickCategory {
  label: 'Continue Learning' | 'Fresh Perspective' | 'High Signal' | string;
  podcasts: RecommendedPodcast[];
}

export interface RecommendedPodcast {
  podcastId: string;
  title: string;
  topic: string;
  duration: number | null;
  audioUrl: string | null;
  playCount: number;
  lowReferences?: boolean;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    image: string | null;
    handle?: string | null;
    role?: string;
  };
  tags: Array<{ id: string; name: string; slug: string }>;
  ownerIsPro?: boolean;
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

/** Compute ownerIsPro and strip plan from a Prisma user row. */
function resolveOwnerPro(user: {
  plan?: string | null;
  role?: string | null;
  [key: string]: unknown;
}) {
  const { plan, ...safeUser } = user;
  return {
    safeUser,
    ownerIsPro: plan === 'PRO' || ['ADMIN', 'SYSTEM'].includes((safeUser.role as string) ?? ''),
  };
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
      lowReferences: true,
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

  // Apply creator and topic diversity before assigning daily pick slots.
  const diversityCandidates: DiversityCandidate[] = candidates.map((c) => ({
    id: c.id,
    creatorId: c.userId,
    tags: c.tags.map((pt) => ({ id: pt.tag.id, parentId: pt.tag.parentId })),
  }));
  const scoredCandidates: ScoredCandidate[] = confident.map((s) => ({
    id: s.podcastId,
    score: s.score,
    signals: s.signals,
    explanation: s.explanation,
  }));
  const diverseResult = applyDiversity(scoredCandidates, diversityCandidates, {
    maxPerCreator: PRIVATE_RECOMMENDATION_CONFIG.maxPerCreator,
    maxPerPrimaryTag: PRIVATE_RECOMMENDATION_CONFIG.maxPerPrimaryTag,
    maxPicks: DAILY_PICKS_MAX,
  });

  const userInterests = await prisma.userInterest.findMany({
    where: { userId },
    include: { tag: { select: { id: true, name: true, parentId: true } } },
  });

  // Build parentId → interest tag name map for sibling matching
  const interestParentToName = new Map<string, string>();
  for (const i of userInterests) {
    if (i.tag.parentId) {
      interestParentToName.set(i.tag.parentId, i.tag.name);
    }
  }

  const catContext: CategorizationContext = {
    interestTagIds: new Set(userInterests.map((i) => i.tag.id)),
    interestTagNames: new Map(userInterests.map((i) => [i.tag.id, i.tag.name])),
    interestParentIds: new Set(
      userInterests.map((i) => i.tag.parentId).filter((p): p is string => p !== null)
    ),
    interestParentToName,
  };

  const pickCategories = categorizePicks(diverseResult, diversityCandidates, catContext, {
    continueLearningSlots: PRIVATE_RECOMMENDATION_CONFIG.continueLearningSlots,
    freshPerspectiveSlots: PRIVATE_RECOMMENDATION_CONFIG.freshPerspectiveSlots,
    highSignalSlots: PRIVATE_RECOMMENDATION_CONFIG.highSignalSlots,
  });

  // Map back to RecommendedPodcast / PickCategory
  const categories: PickCategory[] = pickCategories.map((cat) => ({
    label: cat.label,
    podcasts: cat.items.map((item) => {
      const candidate = candidates.find((c) => c.id === item.id);
      const categoryLabel = cat.label;
      return {
        podcastId: item.id,
        title: candidate?.title ?? '',
        topic: candidate?.topic ?? '',
        duration: candidate?.duration ?? null,
        audioUrl: candidate?.audioUrl ?? null,
        playCount: candidate?.playCount ?? 0,
        createdAt: candidate?.createdAt.toISOString() ?? '',
        user: candidate?.user ?? { id: '', name: null, image: null },
        tags: candidate?.tags.map((pt) => pt.tag) ?? [],
        score: item.score,
        signals: item.signals,
        explanation: item.explanation,
        category: categoryLabel,
      };
    }),
  }));

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
      lowReferences: true,
      createdAt: true,
      user: { select: { id: true, name: true, image: true, handle: true, role: true, plan: true } },
      tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
    },
    orderBy: [{ playCount: 'desc' }, { saveCount: 'desc' }, { createdAt: 'desc' }],
    take: EXPLORE_MAX,
  });

  // If user is authenticated, score and sort
  if (userId) {
    const ml = createMLProvider();
    const scored: RecommendedPodcast[] = [];

    for (const p of podcasts) {
      const { safeUser, ownerIsPro } = resolveOwnerPro(p.user);
      try {
        const result = await ml.computeScore(userId, p.id);
        scored.push({
          podcastId: p.id,
          title: p.title,
          topic: p.topic,
          duration: p.duration,
          audioUrl: p.audioUrl,
          playCount: p.playCount,
          createdAt: p.createdAt.toISOString(),
          user: safeUser as RecommendedPodcast['user'],
          tags: p.tags.map((pt) => pt.tag),
          ownerIsPro,
          score: result.score,
          signals: result.signals,
          explanation: result.explanation,
          category: 'explore',
        });
      } catch {
        logger.warn('Failed to score search result', { podcastId: p.id });
      }
    }

    return scored.sort((a, b) => b.score - a.score);
  }

  return podcasts.map((p) => {
    const { safeUser, ownerIsPro } = resolveOwnerPro(p.user);
    return {
      podcastId: p.id,
      title: p.title,
      topic: p.topic,
      duration: p.duration,
      audioUrl: p.audioUrl,
      playCount: p.playCount,
      createdAt: p.createdAt.toISOString(),
      user: safeUser as RecommendedPodcast['user'],
      tags: p.tags.map((pt) => pt.tag),
      ownerIsPro,
      score: 0,
      signals: { relevance: 0, collaborative: 0, quality: 0, freshness: 0, novelty: 0 },
      explanation: '',
      category: 'explore',
    };
  });
}

/**
 * Get trending podcasts.
 * Returns 6 podcasts based on listen velocity (not raw popularity).
 */
export async function getTrending(): Promise<RecommendedPodcast[]> {
  // Listen velocity: podcasts with most new listens in last 7 days
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const trendingIds = await prisma.playbackSession.groupBy({
    by: ['podcastId'],
    where: { startedAt: { gte: oneWeekAgo } },
    _count: { podcastId: true },
    orderBy: { _count: { podcastId: 'desc' } },
    take: TRENDING_COUNT,
  });

  if (trendingIds.length === 0) {
    return [];
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
      lowReferences: true,
      createdAt: true,
      user: { select: { id: true, name: true, image: true, handle: true, role: true, plan: true } },
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

  return podcasts.map((p) => {
    const { safeUser, ownerIsPro } = resolveOwnerPro(p.user);
    return {
      podcastId: p.id,
      title: p.title,
      topic: p.topic,
      duration: p.duration,
      audioUrl: p.audioUrl,
      playCount: p.playCount,
      createdAt: p.createdAt.toISOString(),
      user: safeUser as RecommendedPodcast['user'],
      tags: p.tags.map((pt) => pt.tag),
      ownerIsPro,
      score: 0,
      signals: { relevance: 0, collaborative: 0, quality: 0, freshness: 0, novelty: 0 },
      explanation: 'Trending this week',
      category: 'trending',
    };
  });
}
