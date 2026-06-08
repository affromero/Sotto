import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { NEWS_CATEGORIES } from '@sotto/shared';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { checkRateLimit } from '@/lib/redis';
import type { NewsResponse } from '@/types/news';

const newsQuerySchema = z.object({
  category: z.enum(NEWS_CATEGORIES).optional(),
  timeRange: z.enum(['1h', '12h', '24h', '1w', '1m']).default('1w'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

const TIME_RANGE_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1m': 30 * 24 * 60 * 60 * 1000,
};

/**
 * GET /api/news — Authenticated news source feed
 * Query params: category, timeRange, limit, cursor
 */
export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const { allowed } = await checkRateLimit(`news:${authResult.userId}`, 30, 60);
  if (!allowed) {
    return errorResponse('Too many requests', 429);
  }

  const searchParams = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = newsQuerySchema.safeParse(searchParams);
  if (!parsed.success) {
    return errorResponse(
      `Invalid query: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      400
    );
  }

  const { category, timeRange, limit, cursor } = parsed.data;
  const cutoff = new Date(Date.now() - TIME_RANGE_MS[timeRange]);

  // Fetch articles + meta in parallel
  const [articles, latestArticle, categoryGroups, sourceGroups] = await Promise.all([
    prisma.ingestedArticle.findMany({
      where: {
        ...(category ? { category } : {}),
        pubDate: { gte: cutoff },
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { pubDate: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        title: true,
        url: true,
        summary: true,
        source: true,
        category: true,
        pubDate: true,
      },
    }),
    prisma.ingestedArticle.findFirst({
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    }),
    prisma.ingestedArticle.groupBy({
      by: ['category'],
      where: { pubDate: { gte: cutoff } },
      _count: true,
    }),
    prisma.ingestedArticle.groupBy({
      by: ['source'],
      where: { pubDate: { gte: cutoff } },
      _count: true,
    }),
  ]);

  const hasMore = articles.length > limit;
  const results = hasMore ? articles.slice(0, limit) : articles;
  const nextCursor = hasMore ? results[results.length - 1].id : null;

  // Look up this user's related briefing podcasts by article URL.
  const articleUrls = results.map((a) => a.url);
  const briefingLogs =
    articleUrls.length > 0
      ? await prisma.briefingLog.findMany({
          where: { userId: authResult.userId, articleUrls: { hasSome: articleUrls } },
          select: {
            articleUrls: true,
            podcastId: true,
          },
        })
      : [];

  const urlToPodcastId = new Map<string, string>();
  for (const log of briefingLogs) {
    for (const url of log.articleUrls) {
      if (!urlToPodcastId.has(url)) {
        urlToPodcastId.set(url, log.podcastId);
      }
    }
  }

  // Build category counts map
  const categoryCounts: Record<string, number> = {};
  for (const group of categoryGroups) {
    if (group.category) {
      categoryCounts[group.category] = group._count;
    }
  }

  const response: NewsResponse = {
    articles: results.map((a) => {
      const relatedPodcastId = urlToPodcastId.get(a.url);
      return {
        ...a,
        pubDate: a.pubDate?.toISOString() ?? null,
        ...(relatedPodcastId ? { relatedPodcastId } : {}),
      };
    }),
    nextCursor,
    meta: {
      latestFetchedAt: latestArticle?.fetchedAt?.toISOString() ?? null,
      sourceCount: sourceGroups.length,
      categoryCounts,
    },
  };

  return NextResponse.json(response);
}
