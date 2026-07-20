import { logger } from '../logger';
import type { ExtractedContent, ExtractedFigure, ExtractedTable } from './types';

const MAX_CONTENT_LENGTH = 50000;
const MAX_FIGURES = 20;
const MAX_TABLES = 10;
const MAX_ROWS_PER_TABLE = 50;
const MIN_IMAGE_BYTES = 10000; // Skip tiny images (icons, decorations)

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

  // Extract figures from PDF pages
  const figures = await extractPdfFigures(buffer);

  // Extract table-like structures from text
  const tables = extractPdfTables(text);

  logger.info('PDF content extracted', {
    pages: String(infoResult.total),
    length: String(text.length),
    figures: String(figures.length),
    tables: String(tables.length),
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
    ...(figures.length > 0 && { figures }),
    ...(tables.length > 0 && { tables }),
  };
}

async function extractPdfFigures(buffer: Buffer): Promise<ExtractedFigure[]> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const figures: ExtractedFigure[] = [];

    const pageCount = Math.min(doc.numPages, 50); // Cap at 50 pages
    for (let i = 1; i <= pageCount && figures.length < MAX_FIGURES; i++) {
      const page = await doc.getPage(i);
      const ops = await page.getOperatorList();

      for (let j = 0; j < ops.fnArray.length && figures.length < MAX_FIGURES; j++) {
        // OPS.paintImageXObject = 85
        if (ops.fnArray[j] === 85) {
          const imgName = ops.argsArray[j]?.[0];
          if (!imgName) continue;

          try {
            const img = await page.objs.get(imgName);
            if (!img?.data || img.data.length < MIN_IMAGE_BYTES) continue;

            // Convert raw image data to a data URI for now — will be uploaded to R2 downstream
            const { encodeImageToDataUri } = await import('./pdf-image-utils');
            const dataUri = encodeImageToDataUri(img);
            if (!dataUri) continue;

            figures.push({
              url: dataUri,
              caption: `Figure from page ${i}`,
              altText: null,
              sourceLabel: `Page ${i}`,
              mimeType: 'image/png',
            });
          } catch {
            // Skip individual image extraction failures
          }
        }
      }
    }

    return figures;
  } catch (err) {
    logger.warn('PDF figure extraction failed, continuing without figures', {
      error: (err as Error).message,
    });
    return [];
  }
}

function extractPdfTables(text: string): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  const lines = text.split('\n');

  let currentRows: string[][] = [];
  let lastColCount = 0;

  for (const line of lines) {
    if (tables.length >= MAX_TABLES) break;

    // Detect tab-separated or multi-space-separated rows (common PDF table output)
    const cells = line
      .split(/\t|  {2,}/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (cells.length >= 2) {
      if (lastColCount === 0 || cells.length === lastColCount) {
        currentRows.push(cells);
        lastColCount = cells.length;
        if (currentRows.length >= MAX_ROWS_PER_TABLE) {
          flushTable();
        }
      } else {
        flushTable();
        currentRows.push(cells);
        lastColCount = cells.length;
      }
    } else {
      flushTable();
    }
  }
  flushTable();

  function flushTable() {
    if (currentRows.length >= 2) {
      const headers = currentRows[0];
      const rows = currentRows.slice(1);
      tables.push({ caption: null, headers, rows, sourceLabel: null });
    }
    currentRows = [];
    lastColCount = 0;
  }

  return tables;
}
