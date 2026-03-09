import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { checkRateLimit } from '@/lib/redis';

const NEWS_CATEGORIES = ['tech', 'science', 'politics', 'business', 'world', 'culture'] as const;

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
 * GET /api/news — Public browsable news feed
 * Query params: category, timeRange, limit, cursor
 */
export async function GET(request: NextRequest) {
  // Rate limit: 30 req/min per IP
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const { allowed } = await checkRateLimit(`news:${ip}`, 30, 60);
  if (!allowed) {
    return errorResponse('Too many requests', 429);
  }

  const searchParams = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = newsQuerySchema.safeParse(searchParams);
  if (!parsed.success) {
    return errorResponse(`Invalid query: ${parsed.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  const { category, timeRange, limit, cursor } = parsed.data;
  const cutoff = new Date(Date.now() - TIME_RANGE_MS[timeRange]);

  const articles = await prisma.ingestedArticle.findMany({
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
  });

  const hasMore = articles.length > limit;
  const results = hasMore ? articles.slice(0, limit) : articles;
  const nextCursor = hasMore ? results[results.length - 1].id : null;

  return NextResponse.json({
    articles: results.map((a) => ({
      ...a,
      pubDate: a.pubDate?.toISOString() ?? null,
    })),
    nextCursor,
  });
}
