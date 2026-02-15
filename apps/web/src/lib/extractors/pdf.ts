import { logger } from '../logger';
import type { ExtractedContent } from './types';

const MAX_CONTENT_LENGTH = 50000;

/**
 * Extract content from a PDF buffer.
 */
export async function extractPdfContent(buffer: Buffer): Promise<ExtractedContent> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  const textResult = await parser.getText();
  const text = textResult.text.substring(0, MAX_CONTENT_LENGTH);

  const infoResult = await parser.getInfo();
  const wordCount = text.split(/\s+/).filter((w: string) => w.length > 0).length;

  logger.info('PDF content extracted', {
    pages: String(infoResult.total),
    length: String(text.length),
  });

  return {
    text,
    markdown: text,
    title: infoResult.info?.Title || null,
    description: null,
    siteName: null,
    author: infoResult.info?.Author || null,
    publishedDate: infoResult.info?.CreationDate?.toISOString() || null,
    wordCount,
    sourceType: 'pdf',
    extractionMethod: 'pdf-parse',
  };
}
