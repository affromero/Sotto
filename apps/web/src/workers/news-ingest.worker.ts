import { Job } from 'bullmq';
import type { NewsIngestPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { FEEDS, fetchFeed } from '@/lib/newsletter-fetcher';
import { logger } from '@/lib/logger';

const PRUNE_AFTER_DAYS = 30;

export async function processNewsIngest(job: Job<NewsIngestPayload>): Promise<void> {
  logger.info('Starting news ingestion', { feedCount: String(FEEDS.length) });
  job.updateProgress(5);

  // Fetch all feeds in parallel
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  job.updateProgress(40);

  let inserted = 0;
  let duplicates = 0;
  let failed = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status !== 'fulfilled') {
      failed++;
      continue;
    }

    const feed = FEEDS[i];
    for (const article of result.value) {
      if (!article.url || !article.title) continue;

      const pubDate = article.pubDate ? new Date(article.pubDate) : null;
      const validPubDate = pubDate && !isNaN(pubDate.getTime()) ? pubDate : null;

      try {
        await prisma.ingestedArticle.upsert({
          where: { url: article.url },
          create: {
            title: article.title,
            url: article.url,
            summary: article.summary || null,
            source: article.source,
            sourceUrl: feed.url,
            category: feed.category || null,
            pubDate: validPubDate,
          },
          update: {},
        });
        inserted++;
      } catch {
        // Duplicate URL race condition — safe to ignore
        duplicates++;
      }
    }
  }

  job.updateProgress(80);

  // Prune articles older than 30 days
  const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const pruned = await prisma.ingestedArticle.deleteMany({
    where: { fetchedAt: { lt: cutoff } },
  });

  job.updateProgress(100);

  logger.info('News ingestion complete', {
    inserted: String(inserted),
    duplicates: String(duplicates),
    failedFeeds: String(failed),
    pruned: String(pruned.count),
  });
}
