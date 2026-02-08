import { logger } from './logger';

/**
 * Extract text content from a URL
 */
export async function extractFromUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status}`);
  }

  const html = await response.text();
  // Basic HTML to text extraction (strip tags)
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  logger.info('Content extracted from URL', { url, length: String(text.length) });
  return text.substring(0, 50000); // Limit to ~50k chars
}

/**
 * Extract text from a PDF buffer
 */
export async function extractFromPdf(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse = await import('pdf-parse') as any;
  const parse = pdfParse.default ?? pdfParse;
  const data = await parse(buffer);
  logger.info('Content extracted from PDF', { pages: String(data.numpages), length: String(data.text.length) });
  return data.text.substring(0, 50000);
}
