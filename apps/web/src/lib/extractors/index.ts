import { extractHtmlContent } from './html';
import { extractPdfContent } from './pdf';
import { logger } from '../logger';
import type { ExtractedContent } from './types';

export type { ExtractedContent } from './types';

/**
 * Extract content from a URL, routing to the appropriate extractor.
 * Order: YouTube (Phase 5) → HTML (default)
 */
export async function extractContent(url: string): Promise<ExtractedContent> {
  logger.info('Extracting content', { url });

  // Phase 5 will add YouTube detection here

  return extractHtmlContent(url);
}

/**
 * Extract content from a PDF buffer.
 */
export async function extractFromPdfBuffer(buffer: Buffer): Promise<ExtractedContent> {
  return extractPdfContent(buffer);
}
