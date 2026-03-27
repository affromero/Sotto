import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import * as cheerio from 'cheerio';
import { logger } from '../logger';
import { safeFetch } from '../url-validator';
import type { ExtractedContent, ExtractedTable, ExtractedFigure } from './types';

export const MAX_CONTENT_LENGTH = 50000;
const FETCH_TIMEOUT_MS = 15000;

const STRIP_SELECTORS = [
  'script',
  'style',
  'nav',
  'footer',
  'header',
  'aside',
  'noscript',
  'iframe',
  'svg',
  'form',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '.sidebar',
  '.nav',
  '.footer',
  '.header',
  '.advertisement',
  '.ad',
  '.cookie-banner',
  '.popup',
].join(', ');

/**
 * Extract content from an HTML page using Readability with cheerio fallback.
 */
export async function extractHtmlContent(url: string): Promise<ExtractedContent> {
  const html = await fetchHtml(url);
  return extractHtmlFromString(html, url);
}

/**
 * Extract content from a pre-fetched HTML string.
 * Use this when the HTML has already been fetched (e.g., by the MIME-routing layer).
 */
export async function extractHtmlFromString(html: string, url: string): Promise<ExtractedContent> {
  const ogMeta = extractOpenGraphMeta(html);

  // Extract structured data from the full HTML (before Readability strips it)
  const tables = extractTables(html);
  const figures = extractFigures(html, url);

  // Try Readability first
  const readabilityResult = tryReadability(html, url);
  if (readabilityResult && readabilityResult.content) {
    const markdown = htmlToMarkdown(readabilityResult.content);
    const text = stripHtml(readabilityResult.content);
    const truncatedText = text.substring(0, MAX_CONTENT_LENGTH);
    const truncatedMarkdown = markdown.substring(0, MAX_CONTENT_LENGTH);

    return {
      text: truncatedText,
      markdown: truncatedMarkdown,
      title: readabilityResult.title ?? ogMeta.title,
      description: readabilityResult.excerpt ?? ogMeta.description,
      siteName: readabilityResult.siteName ?? ogMeta.siteName,
      author: readabilityResult.byline ?? ogMeta.author,
      publishedDate: ogMeta.publishedDate,
      wordCount: countWords(truncatedText),
      sourceType: 'html',
      extractionMethod: 'readability',
      ...(tables.length > 0 && { tables }),
      ...(figures.length > 0 && { figures }),
    };
  }

  // Fallback to cheerio-only extraction
  logger.info('Readability returned null, falling back to cheerio', { url });
  const $ = cheerio.load(html);
  $(STRIP_SELECTORS).remove();

  const bodyHtml = $('article').html() || $('main').html() || $('body').html() || '';
  const markdown = htmlToMarkdown(bodyHtml);
  const text = stripHtml(bodyHtml);
  const truncatedText = text.substring(0, MAX_CONTENT_LENGTH);
  const truncatedMarkdown = markdown.substring(0, MAX_CONTENT_LENGTH);

  return {
    text: truncatedText,
    markdown: truncatedMarkdown,
    title: $('title').text().trim() || ogMeta.title,
    description:
      $('meta[name="description"]').attr('content')?.trim() || ogMeta.description,
    siteName: ogMeta.siteName,
    author:
      $('meta[name="author"]').attr('content')?.trim() || ogMeta.author,
    publishedDate: ogMeta.publishedDate,
    wordCount: countWords(truncatedText),
    sourceType: 'html',
    extractionMethod: 'cheerio-fallback',
    ...(tables.length > 0 && { tables }),
    ...(figures.length > 0 && { figures }),
  };
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await safeFetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; SottoBot/1.0; +https://sotto.fm)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function tryReadability(html: string, url: string) {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    return reader.parse();
  } catch (err) {
    logger.warn('Readability parse failed', { error: (err as Error).message });
    return null;
  }
}

interface OgMeta {
  title: string | null;
  description: string | null;
  siteName: string | null;
  author: string | null;
  publishedDate: string | null;
}

function extractOpenGraphMeta(html: string): OgMeta {
  const $ = cheerio.load(html);
  return {
    title: $('meta[property="og:title"]').attr('content')?.trim() || null,
    description: $('meta[property="og:description"]').attr('content')?.trim() || null,
    siteName: $('meta[property="og:site_name"]').attr('content')?.trim() || null,
    author:
      $('meta[property="article:author"]').attr('content')?.trim() ||
      $('meta[name="author"]').attr('content')?.trim() ||
      null,
    publishedDate:
      $('meta[property="article:published_time"]').attr('content')?.trim() ||
      $('meta[name="date"]').attr('content')?.trim() ||
      $('time[datetime]').attr('datetime')?.trim() ||
      null,
  };
}

/**
 * Convert HTML to simple Markdown via cheerio DOM walk.
 * Handles headings, links, bold, italic, lists, paragraphs.
 */
function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html, { xml: false });

  // Replace elements with markdown equivalents
  $('h1').each((_, el) => {
    $(el).replaceWith(`\n# ${$(el).text().trim()}\n`);
  });
  $('h2').each((_, el) => {
    $(el).replaceWith(`\n## ${$(el).text().trim()}\n`);
  });
  $('h3').each((_, el) => {
    $(el).replaceWith(`\n### ${$(el).text().trim()}\n`);
  });
  $('h4, h5, h6').each((_, el) => {
    $(el).replaceWith(`\n#### ${$(el).text().trim()}\n`);
  });

  $('a').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (href && text) {
      $(el).replaceWith(`[${text}](${href})`);
    }
  });

  $('strong, b').each((_, el) => {
    $(el).replaceWith(`**${$(el).text().trim()}**`);
  });
  $('em, i').each((_, el) => {
    $(el).replaceWith(`*${$(el).text().trim()}*`);
  });

  $('li').each((_, el) => {
    $(el).replaceWith(`- ${$(el).text().trim()}\n`);
  });

  $('br').replaceWith('\n');
  $('p').each((_, el) => {
    $(el).replaceWith(`\n${$(el).text().trim()}\n`);
  });

  $('blockquote').each((_, el) => {
    const text = $(el)
      .text()
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    $(el).replaceWith(`\n${text}\n`);
  });

  // Get text and clean up
  return $.text()
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

const MAX_TABLES = 10;
const MAX_ROWS_PER_TABLE = 50;
const MAX_FIGURES = 20;
const MIN_FIGURE_DIMENSION = 200;

function extractTables(html: string): ExtractedTable[] {
  const $ = cheerio.load(html);
  const tables: ExtractedTable[] = [];

  $('table').each((_, tableEl) => {
    if (tables.length >= MAX_TABLES) return false;

    const $table = $(tableEl);
    const caption = $table.find('caption').text().trim() || null;

    const headers: string[] = [];
    $table.find('thead th, thead td, tr:first-child th').each((_, th) => {
      headers.push($(th).text().trim());
    });

    const rows: string[][] = [];
    const rowSelector = headers.length > 0 ? 'tbody tr' : 'tr';
    $table.find(rowSelector).each((_, tr) => {
      if (rows.length >= MAX_ROWS_PER_TABLE) return false;
      const cells: string[] = [];
      $(tr).find('td, th').each((__, cell) => {
        cells.push($(cell).text().trim());
      });
      if (cells.length > 0 && cells.some((c) => c.length > 0)) {
        rows.push(cells);
      }
    });

    // Skip trivial tables (layout tables with 1 row/col, or empty)
    if (rows.length === 0 || (headers.length === 0 && rows.length < 2)) return;

    tables.push({ caption, headers, rows, sourceLabel: null });
  });

  return tables;
}

function extractFigures(html: string, baseUrl: string): ExtractedFigure[] {
  const $ = cheerio.load(html);
  const figures: ExtractedFigure[] = [];
  const seenUrls = new Set<string>();

  // Extract <figure> elements first (higher quality — typically editorial images)
  $('figure img, article img, main img, .post-content img, .entry-content img').each((_, img) => {
    if (figures.length >= MAX_FIGURES) return false;

    const $img = $(img);
    const src = $img.attr('src') || $img.attr('data-src');
    if (!src) return;

    // Filter out tiny images (icons, tracking pixels, avatars)
    const width = parseInt($img.attr('width') || '0', 10);
    const height = parseInt($img.attr('height') || '0', 10);
    if ((width > 0 && width < MIN_FIGURE_DIMENSION) || (height > 0 && height < MIN_FIGURE_DIMENSION)) return;

    // Filter out common non-content images by URL pattern
    if (/\b(icon|logo|avatar|badge|sprite|tracking|pixel|ad[_-])\b/i.test(src)) return;

    let absoluteUrl: string;
    try {
      const parsed = new URL(src, baseUrl);
      // Only allow http/https URLs — prevent SSRF via file://, data:, etc.
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
      absoluteUrl = parsed.href;
    } catch {
      return;
    }

    if (seenUrls.has(absoluteUrl)) return;
    seenUrls.add(absoluteUrl);

    const $figure = $img.closest('figure');
    const caption = $figure.find('figcaption').text().trim() || null;
    const altText = $img.attr('alt')?.trim() || null;

    const ext = absoluteUrl.split('?')[0].split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
    const mimeType = mimeMap[ext] || 'image/jpeg';

    figures.push({ url: absoluteUrl, caption, altText, sourceLabel: null, mimeType });
  });

  return figures;
}
