// Shared helpers for importing learner-uploaded note/material files. Used by the
// course-notes import route and by notes-based placement. Text files are read
// directly; office/PDF/epub go through Markit. Output is clipped to a safe size.
import { extname } from 'path';
import { extractViaMarkit } from '@/lib/extractors/markit';

export const MAX_IMPORTED_FILE_CHARS = 3000;

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

/** Narrow a multipart form entry to an uploaded File. */
export function isUploadFile(value: FormDataEntryValue): value is File {
  return typeof value === 'object' && value !== null && 'arrayBuffer' in value && 'name' in value;
}

/** Strip NULs, trim, and cap to MAX_IMPORTED_FILE_CHARS with a trimmed marker. */
export function clipImportedText(text: string): string {
  const trimmed = text.replace(/\0/g, '').trim();
  if (trimmed.length <= MAX_IMPORTED_FILE_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_IMPORTED_FILE_CHARS).trim()}\n[Trimmed from a longer upload.]`;
}

/**
 * Extract readable text from an uploaded note/material file, prefixed with the
 * file name. Throws for empty or unsupported files.
 */
export async function extractUploadText(file: File): Promise<string> {
  const name = file.name || 'uploaded-notes';
  const extension = extname(name).toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (file.type.startsWith('text/') || TEXT_EXTENSIONS.has(extension)) {
    const text = clipImportedText(buffer.toString('utf8'));
    if (!text) throw new Error('Empty note file');
    return `Uploaded course note: ${name}\n${text}`;
  }

  if (MARKIT_EXTENSIONS.has(extension)) {
    const extracted = await extractViaMarkit(buffer, {
      extension,
      url: `upload://${encodeURIComponent(name)}`,
    });
    const text = clipImportedText(extracted.markdown || extracted.text);
    if (!text) throw new Error('No readable text');
    return `Uploaded course note: ${name}\n${text}`;
  }

  throw new Error('Unsupported note file');
}

/**
 * Extract text from many uploaded files, dropping unreadable ones. Returns the
 * successful texts and the count that failed.
 */
export async function extractUploadTexts(
  files: File[],
): Promise<{ texts: string[]; failed: number }> {
  const results = await Promise.allSettled(files.map(extractUploadText));
  const texts = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  return { texts, failed: results.length - texts.length };
}
