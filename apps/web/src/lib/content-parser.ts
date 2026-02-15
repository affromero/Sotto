import { extractContent, extractFromPdfBuffer } from './extractors';

/**
 * Extract text content from a URL.
 * @deprecated Use extractContent() from '@/lib/extractors' for richer ExtractedContent.
 */
export async function extractFromUrl(url: string): Promise<string> {
  const result = await extractContent(url);
  return result.text;
}

/**
 * Extract text from a PDF buffer.
 * @deprecated Use extractFromPdfBuffer() from '@/lib/extractors' for richer ExtractedContent.
 */
export async function extractFromPdf(buffer: Buffer): Promise<string> {
  const result = await extractFromPdfBuffer(buffer);
  return result.text;
}
