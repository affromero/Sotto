// Shared helpers for importing learner-uploaded note/material files. Used by the
// course-notes import route and by notes-based placement. Text files are read
// directly; office/PDF/epub go through Markit. Oversized extracts fail explicitly.
import { extname } from 'path';
import { CompleteTextLimitError, extractViaMarkit } from '@/lib/extractors/markit';
import { AccessError, isAccessError } from 'thesidedoor-core/access';

export const MAX_IMPORTED_FILE_CHARS = 1000000;

const TEXT_EXTENSIONS = new Set([
  '.csv',
  '.html',
  '.json',
  '.log',
  '.markdown',
  '.md',
  '.mdx',
  '.rtf',
  '.text',
  '.tsv',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);
const MARKIT_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.epub']);

export function isTextMaterial(name: string, mimeType: string): boolean {
  return mimeType.startsWith('text/') || TEXT_EXTENSIONS.has(extname(name).toLowerCase());
}

/** Narrow a multipart form entry to an uploaded File. */
export function isUploadFile(value: unknown): value is File {
  return typeof value === 'object' && value !== null && 'arrayBuffer' in value && 'name' in value;
}

/** Preserve the complete supported extract instead of silently losing its ending. */
function normalizeImportedText(text: string): string {
  const trimmed = text.replace(/\0/g, '').trim();
  if (trimmed.length > MAX_IMPORTED_FILE_CHARS)
    throw new AccessError(
      'invalid',
      `The extracted document exceeds ${MAX_IMPORTED_FILE_CHARS} characters.`
    );
  return trimmed;
}

/**
 * Extract readable text from an uploaded note/material file, prefixed with the
 * file name. Throws for empty or unsupported files.
 */
async function extractUploadText(file: File): Promise<{ text: string; sourceText: string }> {
  const name = file.name || 'uploaded-notes';
  const extension = extname(name).toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (isTextMaterial(name, file.type)) {
    const text = normalizeImportedText(buffer.toString('utf8'));
    if (!text) throw new Error('Empty note file');
    return { text: `Uploaded course note: ${name}\n${text}`, sourceText: text };
  }

  if (MARKIT_EXTENSIONS.has(extension)) {
    const extracted = await extractViaMarkit(buffer, {
      extension,
      url: `upload://${encodeURIComponent(name)}`,
      completeTextLimit: MAX_IMPORTED_FILE_CHARS,
    }).catch((error: unknown) => {
      if (error instanceof CompleteTextLimitError)
        throw new AccessError(
          'invalid',
          `The extracted document exceeds ${MAX_IMPORTED_FILE_CHARS} characters.`
        );
      throw error;
    });
    const text = normalizeImportedText(extracted.markdown || extracted.text);
    if (!text) throw new Error('No readable text');
    return { text: `Uploaded course note: ${name}\n${text}`, sourceText: text };
  }

  throw new Error('Unsupported note file');
}

/**
 * Extract text from many uploaded files, dropping unreadable ones. Returns the
 * successful texts and the count that failed.
 */
export async function extractUploadTexts(files: File[]): Promise<{
  texts: string[];
  uploads: Array<{ file: File; text: string; sourceText: string }>;
  failed: number;
}> {
  const results = await Promise.allSettled(
    files.map(async (file) => ({ file, ...(await extractUploadText(file)) }))
  );
  for (const result of results)
    if (result.status === 'rejected' && isAccessError(result.reason)) throw result.reason;
  const uploads = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  return {
    texts: uploads.map((upload) => upload.text),
    uploads,
    failed: results.length - uploads.length,
  };
}
