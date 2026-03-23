import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { cache, checkRateLimit, counters, inspireFailures } from '@/lib/redis';
import {
  generateForYouQuestions,
  generateNewsQuestions,
  generateCuriosityQuestions,
  loadInspireContext,
} from '@/lib/taste-quiz';
import type { TasteQuestion, NewsTimeRange } from '@sotto/shared';
import { getTrending } from '@/lib/recommendation-engine';
import type { PodcastSummary } from '@/types/podcast';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

const inspireAllSchema = z.object({
  section: z.enum(['forYou', 'news', 'curiosity', 'trending']).optional(),
  timeRange: z.enum(['1h', '12h', '24h', '1w', '1m']).optional(),
  topic: z.string().max(50).optional(),
  model: z.string().optional(),
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
// Hard TTL: how long data stays in Redis. Soft TTL: after this, serve stale + regen in background.
// forYou/curiosity: interests don't change fast, stale content is fine.
// news: needs freshness. trending: DB-backed, cheap to regen.
const CACHE_TTL = {
  forYou: 14400, // 4h
  news: 5400, // 90 min
  trending: 1800, // 30 min (global, DB-backed)
  curiosity: 14400, // 4h
} as const;

const SOFT_TTL = {
  forYou: 3600, // 60 min
  news: 900, // 15 min
  trending: 600, // 10 min
  curiosity: 3600, // 60 min
} as const;

type Section = 'forYou' | 'trending' | 'news' | 'curiosity';

function cacheKey(section: Section, userId: string, topic?: string, timeRange?: string): string {
  if (section === 'trending') return 'inspire:trending';
  const topicHash = topic ? createHash('md5').update(topic).digest('hex').slice(0, 8) : '_';
  const suffix = section === 'news' && timeRange ? `:${timeRange}` : '';
  return `inspire:${section}:${userId}:${topicHash}${suffix}`;
}

function cacheTtl(section: Section): number {
  return CACHE_TTL[section] ?? 600;
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function trackCacheMetric(section: Section, hit: boolean): void {
  const date = today();
  const kind = hit ? 'hits' : 'misses';
  counters.increment(`inspire:${kind}:${section}:${date}`).catch(() => {});
}

function trackEmptyResult(section: Section): void {
  counters.increment(`inspire:empty:${section}:${today()}`).catch(() => {});
}

function trackError(section: Section): void {
  counters.increment(`inspire:errors:${section}:${today()}`).catch(() => {});
}

/** Cache only non-empty results — caching [] would serve empty state for the entire TTL */
async function cacheIfNonEmpty<T>(key: string, data: T[], ttl: number): Promise<void> {
  if (data.length > 0) {
    await cache.set(key, data, ttl);
  }
}

/** Treat cached empty arrays as cache misses — stale [] shouldn't block regeneration */
function nonEmpty<T>(cached: T[] | null): T[] | null {
  if (cached !== null && cached.length === 0) return null;
  return cached;
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
    ownerIsPro: p.ownerIsPro ?? false,
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
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const validation = inspireAllSchema.safeParse(params);
  if (!validation.success) {
    return errorResponse(validation.error.errors[0].message, 400);
  }

  const { section, timeRange, topic, model } = validation.data;
  const newsTimeRange: NewsTimeRange = timeRange ?? '1w';
  const topicHint = topic ? sanitizeTopic(topic) || undefined : undefined;
  const userId = authResult.userId;

  // Single-section refresh — always bypass cache read, return JSON
  if (section) {
    const rateLimit = await checkRateLimit(`inspire:${userId}`, 10, 3600);
    if (!rateLimit.allowed) {
      return errorResponse('Rate limit exceeded. Try again later.', 429, { resetAt: rateLimit.resetAt });
    }

    if (section === 'forYou') {
      const forYou = await generateForYouQuestions(userId, 6, topicHint, undefined, model);
      if (forYou.length === 0) trackEmptyResult('forYou');
      await cacheIfNonEmpty(cacheKey('forYou', userId, topicHint), forYou, CACHE_TTL.forYou);
      return new Response(JSON.stringify({ forYou }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (section === 'news') {
      const news = await generateNewsQuestions(userId, 6, [], newsTimeRange, topicHint, undefined, model);
      if (news.length === 0) trackEmptyResult('news');
      await cacheIfNonEmpty(cacheKey('news', userId, topicHint, newsTimeRange), news, CACHE_TTL.news);
      return new Response(JSON.stringify({ news }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (section === 'curiosity') {
      const curiosity = await generateCuriosityQuestions(userId, 6, topicHint, undefined, model);
      if (curiosity.length === 0) trackEmptyResult('curiosity');
      await cacheIfNonEmpty(cacheKey('curiosity', userId, topicHint), curiosity, CACHE_TTL.curiosity);
      return new Response(JSON.stringify({ curiosity }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (section === 'trending') {
      const trendingRaw = await getTrending().catch((err) => {
        logger.warn('Failed to fetch trending for inspire', { error: (err as Error).message });
        return [];
      });
      const trending = mapTrendingToPodcastSummary(trendingRaw);
      if (trending.length === 0) trackEmptyResult('trending');
      await cacheIfNonEmpty(cacheKey('trending', userId), trending, CACHE_TTL.trending);
      return new Response(JSON.stringify({ trending }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Full fetch — check cache for all 4 sections in parallel (with TTL for staleness detection)
  // nonEmpty() treats cached [] as a cache miss so stale empties trigger regeneration
  const [forYouResult, trendingResult, newsResult, curiosityResult] = await Promise.all([
    cache.getWithTtl<TasteQuestion[]>(cacheKey('forYou', userId, topicHint)),
    cache.getWithTtl<PodcastSummary[]>(cacheKey('trending', userId)),
    cache.getWithTtl<TasteQuestion[]>(cacheKey('news', userId, topicHint, newsTimeRange)),
    cache.getWithTtl<TasteQuestion[]>(cacheKey('curiosity', userId, topicHint)),
  ]);

  const cachedForYou = nonEmpty(forYouResult.value);
  const cachedTrending = nonEmpty(trendingResult.value);
  const cachedNews = nonEmpty(newsResult.value);
  const cachedCuriosity = nonEmpty(curiosityResult.value);

  const allCached = cachedForYou !== null && cachedTrending !== null && cachedNews !== null && cachedCuriosity !== null;

  // Track cache metrics per section
  trackCacheMetric('forYou', cachedForYou !== null);
  trackCacheMetric('trending', cachedTrending !== null);
  trackCacheMetric('news', cachedNews !== null);
  trackCacheMetric('curiosity', cachedCuriosity !== null);

  // All cached — return immediately, skip rate limit
  // If any section is stale (past soft TTL), fire background regeneration
  if (allCached) {
    const staleSections: Section[] = [];
    const isStale = (ttl: number, section: Section) => ttl >= 0 && ttl < CACHE_TTL[section] - SOFT_TTL[section];
    if (isStale(forYouResult.ttl, 'forYou')) staleSections.push('forYou');
    if (isStale(trendingResult.ttl, 'trending')) staleSections.push('trending');
    if (isStale(newsResult.ttl, 'news')) staleSections.push('news');
    if (isStale(curiosityResult.ttl, 'curiosity')) staleSections.push('curiosity');

    if (staleSections.length > 0) {
      logger.debug('Inspire: serving stale cache, regenerating in background', { staleSections });
      regenInBackground(userId, staleSections, topicHint, newsTimeRange, model);
    } else {
      logger.debug('Inspire: all sections fresh, returning immediately');
    }

    return new Response(JSON.stringify({
      forYou: cachedForYou,
      trending: cachedTrending,
      news: cachedNews,
      curiosity: cachedCuriosity,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // At least one section needs generation — rate limit check
  const rateLimit = await checkRateLimit(`inspire:${userId}`, 10, 3600);
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        forYou: cachedForYou ?? [],
        trending: cachedTrending ?? [],
        news: cachedNews ?? [],
        curiosity: cachedCuriosity ?? [],
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

      // Load shared context once for generators
      const ctxPromise = loadInspireContext(userId, { model });

      // Fire all 4 sections in parallel
      const results = await Promise.allSettled([
        // Trending
        (async () => {
          if (cachedTrending !== null) {
            send({ section: 'trending', data: cachedTrending });
            return;
          }
          const trendingRaw = await getTrending().catch((err) => {
            logger.warn('Failed to fetch trending for inspire', { error: (err as Error).message });
            trackError('trending');
            return [];
          });
          const trending = mapTrendingToPodcastSummary(trendingRaw);
          if (trending.length === 0) trackEmptyResult('trending');
          await cacheIfNonEmpty(cacheKey('trending', userId), trending, CACHE_TTL.trending);
          send({ section: 'trending', data: trending });
        })(),

        // ForYou
        (async () => {
          if (cachedForYou !== null) {
            send({ section: 'forYou', data: cachedForYou });
            return;
          }
          const ctx = await ctxPromise;
          const forYou = await generateForYouQuestions(userId, 6, topicHint, ctx, model);
          if (forYou.length === 0) trackEmptyResult('forYou');
          await cacheIfNonEmpty(cacheKey('forYou', userId, topicHint), forYou, CACHE_TTL.forYou);
          send({ section: 'forYou', data: forYou });
        })(),

        // News
        (async () => {
          if (cachedNews !== null) {
            send({ section: 'news', data: cachedNews });
            return;
          }
          const ctx = await ctxPromise;
          const news = await generateNewsQuestions(userId, 6, [], newsTimeRange, topicHint, ctx, model);
          if (news.length === 0) trackEmptyResult('news');
          await cacheIfNonEmpty(cacheKey('news', userId, topicHint, newsTimeRange), news, CACHE_TTL.news);
          send({ section: 'news', data: news });
        })(),

        // Curiosity
        (async () => {
          if (cachedCuriosity !== null) {
            send({ section: 'curiosity', data: cachedCuriosity });
            return;
          }
          const ctx = await ctxPromise;
          const curiosity = await generateCuriosityQuestions(userId, 6, topicHint, ctx, model);
          if (curiosity.length === 0) trackEmptyResult('curiosity');
          await cacheIfNonEmpty(cacheKey('curiosity', userId, topicHint), curiosity, cacheTtl('curiosity'));
          send({ section: 'curiosity', data: curiosity });
        })(),
      ]);

      // Log any failures and track error metrics
      const sectionNames: Section[] = ['trending', 'forYou', 'news', 'curiosity'];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          const sec = sectionNames[i];
          const reason = `SSE rejection: ${(result.reason as Error).message}`;
          logger.error('Inspire section generation failed', { section: sec, error: (result.reason as Error).message });
          trackError(sec);
          inspireFailures.push({ section: sec, reason, userId, timestamp: new Date().toISOString() }).catch(() => {});
          // Send empty array so the client doesn't hang waiting for this section
          send({ section: sec, data: [] });
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

/**
 * Fire-and-forget background regeneration for stale cache sections.
 * Called when all sections are cached but some are past the soft TTL.
 * Safe on persistent VPS — the Node.js event loop keeps processing after response is sent.
 */
function regenInBackground(
  userId: string,
  sections: Section[],
  topicHint: string | undefined,
  newsTimeRange: NewsTimeRange,
  model: string | undefined
): void {
  (async () => {
    const ctx = await loadInspireContext(userId, { model });
    await Promise.allSettled(
      sections.map(async (section) => {
        switch (section) {
          case 'forYou': {
            const data = await generateForYouQuestions(userId, 6, topicHint, ctx, model);
            if (data.length === 0) trackEmptyResult('forYou');
            await cacheIfNonEmpty(cacheKey('forYou', userId, topicHint), data, CACHE_TTL.forYou);
            break;
          }
          case 'news': {
            const data = await generateNewsQuestions(userId, 6, [], newsTimeRange, topicHint, ctx, model);
            if (data.length === 0) trackEmptyResult('news');
            await cacheIfNonEmpty(cacheKey('news', userId, topicHint, newsTimeRange), data, CACHE_TTL.news);
            break;
          }
          case 'curiosity': {
            const data = await generateCuriosityQuestions(userId, 6, topicHint, ctx, model);
            if (data.length === 0) trackEmptyResult('curiosity');
            await cacheIfNonEmpty(cacheKey('curiosity', userId, topicHint), data, CACHE_TTL.curiosity);
            break;
          }
          case 'trending': {
            const trendingRaw = await getTrending().catch((err) => {
              logger.warn('Background regen: trending fetch failed', { error: (err as Error).message });
              return [];
            });
            const data = mapTrendingToPodcastSummary(trendingRaw);
            if (data.length === 0) trackEmptyResult('trending');
            await cacheIfNonEmpty(cacheKey('trending', userId), data, CACHE_TTL.trending);
            break;
          }
        }
      })
    );
    logger.debug('Inspire: background regeneration complete', { sections });
  })().catch((err) => {
    logger.warn('Inspire: background regeneration failed', { error: (err as Error).message });
  });
}
