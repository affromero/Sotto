import { extractHtmlFromString } from './html';
import { countWords, MAX_CONTENT_LENGTH } from './html';
import { extractViaMarkit } from './markit';
import { extractPdfContent } from './pdf';
import { isPinchtabAvailable, extractViaPinchtab } from './pinchtab';
import { textToMarkdown } from './text-to-markdown';
import { isYouTubeUrl, extractYouTubeContent } from './youtube';
import { safeFetch } from '../url-validator';
import { logger } from '../logger';
import type { ExtractedContent } from './types';

export type { ExtractedContent, ExtractedTable, ExtractedFigure, ExtractedStatistic } from './types';

const MIN_WORD_COUNT = 50;
const FETCH_TIMEOUT_MS = 15000;

/** MIME types that indicate HTML content */
const HTML_MIME_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
]);

/** MIME types for document formats handled by Markit (Phase 2) */
const DOCUMENT_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/epub+zip',
]);

/** Extension-to-type mapping for when Content-Type is generic */
const EXTENSION_MAP: Record<string, 'pdf' | 'document'> = {
  '.pdf': 'pdf',
  '.docx': 'document',
  '.pptx': 'document',
  '.xlsx': 'document',
  '.epub': 'document',
};

/**
 * Parse the MIME type from a Content-Type header, stripping charset and params.
 */
function parseMimeType(contentType: string | null): string | null {
  if (!contentType) return null;
  return contentType.split(';')[0].trim().toLowerCase();
}

/**
 * Extract the file extension from a URL path (e.g., '.pdf' from 'https://example.com/paper.pdf').
 */
function getUrlExtension(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const lastDot = pathname.lastIndexOf('.');
    if (lastDot === -1) return null;
    return pathname.substring(lastDot).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Detect the content category from MIME type and URL extension.
 * Returns 'html' | 'pdf' | 'document' | null.
 */
function detectContentType(mimeType: string | null, url: string): 'html' | 'pdf' | 'document' | null {
  if (mimeType) {
    if (HTML_MIME_TYPES.has(mimeType)) return 'html';
    if (mimeType === 'application/pdf') return 'pdf';
    if (DOCUMENT_MIME_TYPES.has(mimeType)) return 'document';
  }

  // For generic/missing MIME types, fall back to URL extension
  if (!mimeType || mimeType === 'application/octet-stream') {
    const ext = getUrlExtension(url);
    if (ext && ext in EXTENSION_MAP) return EXTENSION_MAP[ext];
  }

  return null;
}

/**
 * Extract content from a URL, routing to the appropriate extractor.
 *
 * Routing order:
 * 1. YouTube → dedicated transcript extractor
 * 2. Fetch URL, inspect Content-Type
 * 3. PDF → pdf-parse extractor (Markit in Phase 2)
 * 4. Document (DOCX/PPTX/XLSX/EPUB) → error until Markit (Phase 2)
 * 5. HTML (default) → Readability/cheerio, with Pinchtab fallback for thin content
 */
export async function extractContent(url: string): Promise<ExtractedContent> {
  logger.info('Extracting content', { url });

  if (isYouTubeUrl(url)) {
    return extractYouTubeContent(url);
  }

  // Fetch with generic Accept header — critical for content negotiation
  // so servers return PDF/DOCX instead of HTML wrapper pages
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await safeFetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SottoBot/1.0; +https://sotto.fm)',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } finally {
    clearTimeout(timeout);
  }

  const mimeType = parseMimeType(response.headers.get('content-type'));
  const contentCategory = detectContentType(mimeType, url);

  logger.info('Content-Type detected', { url, mimeType, contentCategory });

  // Route by detected content type
  if (contentCategory === 'pdf') {
    const buffer = Buffer.from(await response.arrayBuffer());
    const extension = getUrlExtension(url) || '.pdf';
    try {
      return await extractViaMarkit(buffer, { extension, url });
    } catch (err) {
      logger.warn('Markit PDF extraction failed, falling back to pdf-parse', {
        url,
        error: (err as Error).message,
      });
      return extractPdfContent(buffer);
    }
  }

  if (contentCategory === 'document') {
    const buffer = Buffer.from(await response.arrayBuffer());
    const extension = getUrlExtension(url) || '.bin';
    return extractViaMarkit(buffer, { extension, url });
  }

  // Default: treat as HTML
  const html = await response.text();
  const htmlResult = await extractHtmlFromString(html, url);

  if (htmlResult.wordCount >= MIN_WORD_COUNT) {
    return htmlResult;
  }

  // Pinchtab fallback for thin HTML content (JS-heavy SPAs)
  if (!isPinchtabAvailable()) {
    logger.info('Thin extraction, Pinchtab not configured', { url, wordCount: htmlResult.wordCount });
    return htmlResult;
  }

  try {
    logger.info('Thin extraction, trying Pinchtab fallback', { url, wordCount: htmlResult.wordCount });
    const pinchtabText = await extractViaPinchtab(url);
    const pinchtabWordCount = countWords(pinchtabText);

    if (pinchtabWordCount > htmlResult.wordCount) {
      logger.info('Pinchtab produced richer content', {
        url,
        staticWords: htmlResult.wordCount,
        pinchtabWords: pinchtabWordCount,
      });
      const truncated = pinchtabText.substring(0, MAX_CONTENT_LENGTH);
      const markdown = textToMarkdown(truncated);
      return {
        text: truncated,
        markdown: markdown || truncated,
        title: htmlResult.title,
        description: htmlResult.description,
        siteName: htmlResult.siteName,
        author: htmlResult.author,
        publishedDate: htmlResult.publishedDate,
        wordCount: pinchtabWordCount,
        sourceType: 'html',
        extractionMethod: 'pinchtab',
        ...(htmlResult.tables && { tables: htmlResult.tables }),
        ...(htmlResult.figures && { figures: htmlResult.figures }),
        ...(htmlResult.keyStatistics && { keyStatistics: htmlResult.keyStatistics }),
      };
    }

    logger.info('Pinchtab did not improve extraction', { url });
    return htmlResult;
  } catch (err) {
    logger.warn('Pinchtab fallback failed', { url, error: (err as Error).message });
    return htmlResult;
  }
}

/**
 * Extract content from a PDF buffer.
 * Tries Markit first (better markdown), falls back to pdf-parse.
 */
export async function extractFromPdfBuffer(buffer: Buffer): Promise<ExtractedContent> {
  try {
    return await extractViaMarkit(buffer, { extension: '.pdf', url: 'buffer://pdf' });
  } catch (err) {
    logger.warn('Markit PDF buffer extraction failed, falling back to pdf-parse', {
      error: (err as Error).message,
    });
    return extractPdfContent(buffer);
  }
}
