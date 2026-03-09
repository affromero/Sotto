/**
 * Newsletter/RSS fetcher for "In the News" grounded questions.
 * Fetches from a curated, politically balanced set of RSS feeds,
 * caches results in Redis, and returns recent articles.
 */
import { JSDOM } from 'jsdom';
import type { NewsTimeRange } from '@sotto/shared';
import { cache } from './redis';
import { logger } from './logger';

// ── Types ───────────────────────────────────────────────────────

export interface NewsArticle {
  title: string;
  url: string;
  summary: string;
  pubDate: string;
  source: string;
}

export interface FeedConfig {
  name: string;
  url: string;
  category?: string;
}

// ── Curated feed list (balanced across political spectrum + topics) ──

const FEEDS: FeedConfig[] = [
  // LEFT / LEFT-CENTER
  { name: 'Vox', url: 'https://www.vox.com/rss/index.xml', category: 'politics' },
  { name: 'The Atlantic', url: 'https://www.theatlantic.com/feed/all/', category: 'culture' },
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml', category: 'politics' },

  // CENTER
  { name: 'Reuters', url: 'https://www.reutersagency.com/feed/', category: 'world' },
  { name: 'AP News', url: 'https://feedx.net/rss/ap.xml', category: 'world' },
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml', category: 'world' },
  { name: 'Axios', url: 'https://api.axios.com/feed/', category: 'politics' },

  // RIGHT-CENTER / RIGHT
  { name: 'The Wall Street Journal', url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', category: 'business' },
  { name: 'The Economist', url: 'https://www.economist.com/rss', category: 'business' },
  { name: 'National Review', url: 'https://www.nationalreview.com/feed/', category: 'politics' },

  // SCIENCE / TECH (non-partisan)
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', category: 'tech' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'tech' },
  { name: 'Nature News', url: 'https://www.nature.com/nature.rss', category: 'science' },
  { name: 'Rest of World', url: 'https://restofworld.org/feed/', category: 'tech' },

  // AGGREGATORS (Google News topic feeds)
  { name: 'Google News — Top Stories', url: 'https://news.google.com/rss', category: 'world' },
  { name: 'Google News — Tech', url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB', category: 'tech' },
  { name: 'Google News — Science', url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtVnVHZ0pWVXlnQVAB', category: 'science' },
  { name: 'Google News — Business', url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB', category: 'business' },

  // TECH / STARTUPS
  { name: 'Hacker News — Best', url: 'https://hnrss.org/best', category: 'tech' },
  { name: 'Techmeme', url: 'https://www.techmeme.com/feed.xml', category: 'tech' },

  // REDDIT (public RSS — no API key needed)
  { name: 'Reddit — World News', url: 'https://www.reddit.com/r/worldnews/.rss', category: 'world' },
  { name: 'Reddit — Science', url: 'https://www.reddit.com/r/science/.rss', category: 'science' },
  { name: 'Reddit — Technology', url: 'https://www.reddit.com/r/technology/.rss', category: 'tech' },

  // INTERNATIONAL
  { name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', category: 'world' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'world' },
];

// ── Time range helpers ──────────────────────────────────────────

const TIME_RANGE_MS: Record<NewsTimeRange, number> = {
  '1h': 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1m': 30 * 24 * 60 * 60 * 1000,
};

const CACHE_TTL: Record<NewsTimeRange, number> = {
  '1h': 5 * 60,      // 5 min
  '12h': 15 * 60,     // 15 min
  '24h': 30 * 60,     // 30 min
  '1w': 60 * 60,      // 1 hour
  '1m': 2 * 60 * 60,  // 2 hours
};

const FETCH_TIMEOUT = 8000;

// ── RSS parsing ─────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function parseRssFeed(xml: string, sourceName: string): NewsArticle[] {
  const dom = new JSDOM(xml, { contentType: 'text/xml' });
  const doc = dom.window.document;
  const articles: NewsArticle[] = [];

  // Try RSS 2.0 <item> elements first, then Atom <entry> elements
  const items = doc.querySelectorAll('item');
  const entries = doc.querySelectorAll('entry');
  const elements = items.length > 0 ? items : entries;

  for (const el of elements) {
    const title = el.querySelector('title')?.textContent?.trim();
    if (!title) continue;

    // URL: RSS uses <link> text, Atom uses <link href="">
    let url = el.querySelector('link')?.textContent?.trim() || '';
    if (!url) {
      url = el.querySelector('link')?.getAttribute('href') || '';
    }
    if (!url) continue;

    // Summary: try <description> (RSS) then <summary> (Atom)
    const rawSummary = el.querySelector('description')?.textContent
      || el.querySelector('summary')?.textContent
      || '';
    const summary = stripHtml(rawSummary).substring(0, 300);

    // Date: try <pubDate> (RSS) then <published> (Atom) then <updated>
    const dateStr = el.querySelector('pubDate')?.textContent
      || el.querySelector('published')?.textContent
      || el.querySelector('updated')?.textContent
      || '';

    articles.push({
      title,
      url,
      summary,
      pubDate: dateStr,
      source: sourceName,
    });
  }

  return articles;
}

// ── Fetch single feed ───────────────────────────────────────────

async function fetchFeed(feed: FeedConfig): Promise<NewsArticle[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SottoBot/1.0' },
    });
    if (!response.ok) return [];
    const xml = await response.text();
    return parseRssFeed(xml, feed.name);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ── Public API ──────────────────────────────────────────────────

export async function fetchNewsletterArticles(
  timeRange: NewsTimeRange = '1w'
): Promise<NewsArticle[]> {
  const cacheKey = `newsletter:articles:${timeRange}`;
  const cached = await cache.get<NewsArticle[]>(cacheKey).catch(() => null);
  if (cached && cached.length > 0) return cached;

  const results = await Promise.allSettled(FEEDS.map(fetchFeed));

  const cutoff = Date.now() - TIME_RANGE_MS[timeRange];
  const allArticles: NewsArticle[] = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const article of result.value) {
      // Filter by publication date if parseable
      if (article.pubDate) {
        const pubTime = new Date(article.pubDate).getTime();
        if (!isNaN(pubTime) && pubTime < cutoff) continue;
      }
      allArticles.push(article);
    }
  }

  // Sort newest first, take top 100
  allArticles.sort((a, b) => {
    const timeA = new Date(a.pubDate).getTime() || 0;
    const timeB = new Date(b.pubDate).getTime() || 0;
    return timeB - timeA;
  });

  const sliced = allArticles.slice(0, 100);

  if (sliced.length > 0) {
    await cache.set(cacheKey, sliced, CACHE_TTL[timeRange]).catch((err) => {
      logger.warn('Failed to cache newsletter articles', { error: (err as Error).message });
    });
  }

  return sliced;
}

export function formatArticlesForPrompt(articles: NewsArticle[]): string {
  return articles
    .map((a, i) => `[${i + 1}] ${a.source} — "${a.title}" (${a.pubDate})\n    URL: ${a.url}\n    ${a.summary}`)
    .join('\n\n');
}

/** Exported for testing + news-ingest worker */
export { FEEDS, parseRssFeed, fetchFeed };
