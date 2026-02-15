import { extractHtmlContent } from './html';
import { extractPdfContent } from './pdf';
import { isYouTubeUrl, extractYouTubeContent } from './youtube';
import { logger } from '../logger';
import type { ExtractedContent } from './types';

export type { ExtractedContent } from './types';

/**
 * Extract content from a URL, routing to the appropriate extractor.
 * Order: YouTube → HTML (default)
 */
export async function extractContent(url: string): Promise<ExtractedContent> {
  logger.info('Extracting content', { url });

  if (isYouTubeUrl(url)) {
    return extractYouTubeContent(url);
  }

  return extractHtmlContent(url);
}

/**
 * Extract content from a PDF buffer.
 */
export async function extractFromPdfBuffer(buffer: Buffer): Promise<ExtractedContent> {
  return extractPdfContent(buffer);
}
