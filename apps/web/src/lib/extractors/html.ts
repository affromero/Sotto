import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import * as cheerio from 'cheerio';
import { logger } from '../logger';
import { validateUrl } from '../url-validator';
import type { ExtractedContent } from './types';

const MAX_CONTENT_LENGTH = 50000;
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
  const ogMeta = extractOpenGraphMeta(html);

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
  };
}

async function fetchHtml(url: string): Promise<string> {
  await validateUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; SottoBot/1.0; +https://sotto.fm)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
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

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}
