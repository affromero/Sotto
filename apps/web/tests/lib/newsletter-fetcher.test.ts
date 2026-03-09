import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();

vi.mock('@/lib/redis', () => ({
  cache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  FEEDS,
  parseRssFeed,
  fetchFeed,
  fetchNewsletterArticles,
  formatArticlesForPrompt,
} from '@/lib/newsletter-fetcher';

// ---- Tests ----

describe('newsletter-fetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
  });

  describe('FEEDS', () => {
    it('has at least 20 curated feeds', () => {
      expect(FEEDS.length).toBeGreaterThanOrEqual(20);
    });

    it('includes feeds from multiple political perspectives', () => {
      const names = FEEDS.map((f) => f.name);
      // Center
      expect(names).toContain('Reuters');
      expect(names).toContain('BBC News');
      // Left-leaning
      expect(names).toContain('NPR');
      // Right-leaning
      expect(names).toContain('National Review');
      // Science/Tech
      expect(names).toContain('Ars Technica');
    });

    it('includes aggregator and community feeds', () => {
      const names = FEEDS.map((f) => f.name);
      expect(names).toContain('Google News — Top Stories');
      expect(names).toContain('Hacker News — Best');
      expect(names).toContain('The Guardian');
    });

    it('all feeds have name, url, and category', () => {
      for (const feed of FEEDS) {
        expect(feed.name).toBeTruthy();
        expect(feed.url).toMatch(/^https?:\/\//);
        expect(feed.category).toBeTruthy();
      }
    });
  });

  describe('parseRssFeed', () => {
    it('parses RSS 2.0 feed', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Article One</title>
      <link>https://example.com/article-1</link>
      <description>This is the first article summary.</description>
      <pubDate>Mon, 27 Feb 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Article Two</title>
      <link>https://example.com/article-2</link>
      <description>&lt;p&gt;HTML content&lt;/p&gt;</description>
      <pubDate>Mon, 27 Feb 2026 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

      const articles = parseRssFeed(xml, 'Test Source');
      expect(articles).toHaveLength(2);
      expect(articles[0].title).toBe('Article One');
      expect(articles[0].url).toBe('https://example.com/article-1');
      expect(articles[0].summary).toBe('This is the first article summary.');
      expect(articles[0].source).toBe('Test Source');
      expect(articles[1].summary).not.toContain('<p>');
    });

    it('parses Atom feed', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom Article</title>
    <link href="https://example.com/atom-1" />
    <summary>Atom summary text.</summary>
    <published>2026-02-27T08:00:00Z</published>
  </entry>
</feed>`;

      const articles = parseRssFeed(xml, 'Atom Source');
      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe('Atom Article');
      expect(articles[0].url).toBe('https://example.com/atom-1');
      expect(articles[0].summary).toBe('Atom summary text.');
    });

    it('skips items without title', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <link>https://example.com/no-title</link>
    </item>
    <item>
      <title>Has Title</title>
      <link>https://example.com/has-title</link>
    </item>
  </channel>
</rss>`;

      const articles = parseRssFeed(xml, 'Test');
      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe('Has Title');
    });

    it('truncates long summaries to 300 chars', () => {
      const longDesc = 'A'.repeat(500);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Long Summary</title>
      <link>https://example.com/long</link>
      <description>${longDesc}</description>
    </item>
  </channel>
</rss>`;

      const articles = parseRssFeed(xml, 'Test');
      expect(articles[0].summary.length).toBeLessThanOrEqual(300);
    });
  });

  describe('fetchNewsletterArticles', () => {
    it('returns cached articles when available', async () => {
      const cachedArticles = [
        { title: 'Cached Article', url: 'https://example.com', summary: 'cached', pubDate: '2026-02-27', source: 'Test' },
      ];
      mockCacheGet.mockResolvedValue(cachedArticles);

      const result = await fetchNewsletterArticles('1w');
      expect(result).toEqual(cachedArticles);
      expect(mockCacheGet).toHaveBeenCalledWith('newsletter:articles:1w');
    });

    it('fetches from feeds when cache is empty', async () => {
      // Mock fetch to return a simple RSS feed
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(`<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Fresh Article</title>
    <link>https://example.com/fresh</link>
    <description>Fresh news</description>
    <pubDate>${new Date().toUTCString()}</pubDate>
  </item>
</channel></rss>`),
      });

      const result = await fetchNewsletterArticles('1w');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].title).toBe('Fresh Article');

      // Should cache results
      expect(mockCacheSet).toHaveBeenCalled();

      globalThis.fetch = originalFetch;
    });

    it('handles feed fetch failures gracefully', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await fetchNewsletterArticles('1w');
      expect(result).toEqual([]);

      globalThis.fetch = originalFetch;
    });

    it('limits results to 100 articles', async () => {
      const originalFetch = globalThis.fetch;
      // Each feed returns 5 articles, 26 feeds × 5 = 130, should be capped at 100
      const items = Array.from({ length: 5 }, (_, i) =>
        `<item><title>Article ${i}</title><link>https://example.com/${i}</link><description>Desc</description><pubDate>${new Date().toUTCString()}</pubDate></item>`
      ).join('');
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(`<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`),
      });

      const result = await fetchNewsletterArticles('1m');
      expect(result.length).toBeLessThanOrEqual(100);

      globalThis.fetch = originalFetch;
    });
  });

  describe('fetchFeed', () => {
    it('fetches and parses a single feed', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(`<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Single Feed Article</title>
    <link>https://example.com/single</link>
    <description>A test article</description>
    <pubDate>${new Date().toUTCString()}</pubDate>
  </item>
</channel></rss>`),
      });

      const articles = await fetchFeed({ name: 'Test Feed', url: 'https://example.com/rss', category: 'tech' });
      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe('Single Feed Article');
      expect(articles[0].source).toBe('Test Feed');

      globalThis.fetch = originalFetch;
    });

    it('returns empty array on fetch failure', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const articles = await fetchFeed({ name: 'Bad Feed', url: 'https://example.com/bad', category: 'world' });
      expect(articles).toEqual([]);

      globalThis.fetch = originalFetch;
    });
  });

  describe('formatArticlesForPrompt', () => {
    it('formats articles with numbered list', () => {
      const articles = [
        { title: 'Article A', url: 'https://a.com', summary: 'Summary A', pubDate: '2026-02-27', source: 'Reuters' },
        { title: 'Article B', url: 'https://b.com', summary: 'Summary B', pubDate: '2026-02-26', source: 'NPR' },
      ];

      const formatted = formatArticlesForPrompt(articles);
      expect(formatted).toContain('[1] Reuters');
      expect(formatted).toContain('"Article A"');
      expect(formatted).toContain('[2] NPR');
      expect(formatted).toContain('https://a.com');
    });
  });
});
