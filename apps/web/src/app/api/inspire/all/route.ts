import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { cache, checkRateLimit, counters } from '@/lib/redis';
import {
  generateForYouQuestions,
  generateNewsQuestions,
  loadInspireContext,
} from '@/lib/taste-quiz';
import type { NewsTimeRange } from '@/lib/taste-quiz';
import type { TasteQuestion } from '@sotto/shared';
import { getTrending } from '@/lib/recommendation-engine';
import type { PodcastSummary } from '@/types/podcast';
import { logger } from '@/lib/logger';

const inspireAllSchema = z.object({
  section: z.enum(['forYou', 'news']).optional(),
  timeRange: z.enum(['1h', '12h', '24h', '1w', '1m']).optional(),
  topic: z.string().max(50).optional(),
});

/**
 * Sanitize user topic input before interpolating into LLM prompts.
 * Strips characters and patterns that could be used for prompt injection.
 */
function sanitizeTopic(raw: string): string {
  return raw
    .replace(/[""''`]/g, '') // curly/backtick quotes
    .replace(/[{}[\]<>]/g, '') // brackets that could look like JSON/XML
    .replace(/\n|\r/g, ' ') // newlines
    .replace(/\b(ignore|forget|disregard|override|system|prompt|instruction|assistant|human)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Cache TTLs in seconds
const CACHE_TTL = {
  forYou: 600, // 10 min
  news: 300, // 5 min
  trending: 120, // 2 min (global)
} as const;

type Section = 'forYou' | 'trending' | 'news';

function cacheKey(section: Section, userId: string, topic?: string, timeRange?: string): string {
  if (section === 'trending') return 'inspire:trending';
  const topicHash = topic ? createHash('md5').update(topic).digest('hex').slice(0, 8) : '_';
  const suffix = section === 'news' && timeRange ? `:${timeRange}` : '';
  return `inspire:${section}:${userId}:${topicHash}${suffix}`;
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function trackCacheMetric(section: Section, hit: boolean): void {
  const date = today();
  const kind = hit ? 'hits' : 'misses';
  counters.increment(`inspire:${kind}:${section}:${date}`).catch(() => {});
}

function mapTrendingToPodcastSummary(
  trendingRaw: Awaited<ReturnType<typeof getTrending>>
): PodcastSummary[] {
  return trendingRaw.map((p) => ({
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
}

/**
 * GET /api/inspire/all
 * Returns all three Inspire Me sections.
 *
 * Full fetch (no ?section=): returns SSE stream with progressive loading.
 * Single-section refresh (?section=forYou|news): returns JSON, bypasses cache read.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const validation = inspireAllSchema.safeParse(params);
  if (!validation.success) {
    return new Response(JSON.stringify({ error: validation.error.errors[0].message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { section, timeRange, topic } = validation.data;
  const newsTimeRange: NewsTimeRange = timeRange ?? '1w';
  const topicHint = topic ? sanitizeTopic(topic) || undefined : undefined;
  const userId = session.user.id;

  // Single-section refresh — always bypass cache read, return JSON
  if (section === 'forYou' || section === 'news') {
    const rateLimit = await checkRateLimit(`inspire:${userId}`, 10, 3600);
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Try again later.', resetAt: rateLimit.resetAt }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (section === 'forYou') {
      const forYou = await generateForYouQuestions(userId, 6, topicHint);
      // Cache fresh result for subsequent full fetches
      await cache.set(cacheKey('forYou', userId, topicHint), forYou, CACHE_TTL.forYou);
      return new Response(JSON.stringify({ forYou }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const news = await generateNewsQuestions(userId, 6, [], newsTimeRange, topicHint);
    await cache.set(cacheKey('news', userId, topicHint, newsTimeRange), news, CACHE_TTL.news);
    return new Response(JSON.stringify({ news }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Full fetch — check cache for all 3 sections in parallel
  const [cachedForYou, cachedTrending, cachedNews] = await Promise.all([
    cache.get<TasteQuestion[]>(cacheKey('forYou', userId, topicHint)),
    cache.get<PodcastSummary[]>(cacheKey('trending', userId)),
    cache.get<TasteQuestion[]>(cacheKey('news', userId, topicHint, newsTimeRange)),
  ]);

  const allCached = cachedForYou !== null && cachedTrending !== null && cachedNews !== null;

  // Track cache metrics per section
  trackCacheMetric('forYou', cachedForYou !== null);
  trackCacheMetric('trending', cachedTrending !== null);
  trackCacheMetric('news', cachedNews !== null);

  // All cached — return immediately, skip rate limit
  if (allCached) {
    logger.debug('Inspire: all sections cached, returning immediately');
    return new Response(JSON.stringify({ forYou: cachedForYou, trending: cachedTrending, news: cachedNews }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // At least one section needs generation — rate limit check
  const rateLimit = await checkRateLimit(`inspire:${userId}`, 10, 3600);
  if (!rateLimit.allowed) {
    // Return whatever we have cached + empty arrays for uncached
    return new Response(
      JSON.stringify({
        forYou: cachedForYou ?? [],
        trending: cachedTrending ?? [],
        news: cachedNews ?? [],
        error: 'Rate limit exceeded. Try again later.',
        resetAt: rateLimit.resetAt,
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // SSE progressive loading — stream each section as it resolves
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      // Load shared context once for both generators
      const ctxPromise = loadInspireContext(userId);

      // Fire all 3 sections in parallel
      const results = await Promise.allSettled([
        // Trending
        (async () => {
          if (cachedTrending !== null) {
            send({ section: 'trending', data: cachedTrending });
            return;
          }
          const trendingRaw = await getTrending().catch((err) => {
            logger.warn('Failed to fetch trending for inspire', { error: (err as Error).message });
            return [];
          });
          const trending = mapTrendingToPodcastSummary(trendingRaw);
          await cache.set(cacheKey('trending', userId), trending, CACHE_TTL.trending);
          send({ section: 'trending', data: trending });
        })(),

        // ForYou
        (async () => {
          if (cachedForYou !== null) {
            send({ section: 'forYou', data: cachedForYou });
            return;
          }
          const ctx = await ctxPromise;
          const forYou = await generateForYouQuestions(userId, 6, topicHint, ctx);
          await cache.set(cacheKey('forYou', userId, topicHint), forYou, CACHE_TTL.forYou);
          send({ section: 'forYou', data: forYou });
        })(),

        // News
        (async () => {
          if (cachedNews !== null) {
            send({ section: 'news', data: cachedNews });
            return;
          }
          const ctx = await ctxPromise;
          const news = await generateNewsQuestions(userId, 6, [], newsTimeRange, topicHint, ctx);
          await cache.set(cacheKey('news', userId, topicHint, newsTimeRange), news, CACHE_TTL.news);
          send({ section: 'news', data: news });
        })(),
      ]);

      // Log any failures
      for (const result of results) {
        if (result.status === 'rejected') {
          logger.error('Inspire section generation failed', { error: (result.reason as Error).message });
        }
      }

      send({ done: true });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
