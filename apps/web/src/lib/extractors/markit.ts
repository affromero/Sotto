import { logger } from '../logger';
import { countWords, MAX_CONTENT_LENGTH } from './html';
import type { ExtractedContent } from './types';

// Lazy-loaded to avoid crashing CJS workers — the package only exports ESM

let markitInstance: any = null;

const PDF_EXTENSIONS = new Set(['.pdf']);
const DOCUMENT_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx', '.epub']);

async function getMarkit() {
  if (!markitInstance) {
    const { Markit } = await import('markit-ai');
    // No LLM functions — skip image descriptions to avoid cost.
    // Can be enabled later by passing createLlmFunctions(config).
    markitInstance = new Markit();
  }
  return markitInstance;
}

function resolveSourceType(extension: string): ExtractedContent['sourceType'] {
  if (PDF_EXTENSIONS.has(extension)) return 'pdf';
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document';
  return 'document';
}

/**
 * Extract content from a buffer using Markit.
 * Handles PDF, DOCX, PPTX, XLSX, EPUB, and other formats Markit supports.
 */
export async function extractViaMarkit(
  buffer: Buffer,
  info: { extension: string; url: string }
): Promise<ExtractedContent> {
  const markit = await getMarkit();

  logger.info('Extracting via Markit', { url: info.url, extension: info.extension });

  const result = await markit.convert(buffer, { extension: info.extension });
  const markdown = (result.markdown || '').substring(0, MAX_CONTENT_LENGTH);
  const text = markdown
    .replace(/[#*_`>\[\]()~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const truncatedText = text.substring(0, MAX_CONTENT_LENGTH);
  const wordCount = countWords(truncatedText);

  logger.info('Markit extraction complete', {
    url: info.url,
    wordCount: String(wordCount),
    markdownLength: String(markdown.length),
  });

  return {
    text: truncatedText,
    markdown,
    title: result.title || null,
    description: null,
    siteName: null,
    author: null,
    publishedDate: null,
    wordCount,
    sourceType: resolveSourceType(info.extension),
    extractionMethod: 'markit',
  };
}
