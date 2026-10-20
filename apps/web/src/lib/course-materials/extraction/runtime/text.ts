import { createHash } from 'node:crypto';
import { readBoundedRegularFile } from '../../../providers/documents/files';
import { prepareMaterialPageText } from '../chunks';

/** Text files have no visual layer. Exact UTF-8 validation preserves their complete original content. */
export async function extractMaterialText(
  path: string,
  originalSha256: string,
  signal: AbortSignal
) {
  const bytes = await readBoundedRegularFile(path, {
    maximum: 64 * 1024 * 1024,
    allowEmpty: true,
    signal,
  });
  if (createHash('sha256').update(bytes).digest('hex') !== originalSha256)
    throw new Error('The complete original text checksum changed.');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const prepared = prepareMaterialPageText({
    text,
    pageNumber: 1,
    source: { origin: 'EMBEDDED_TEXT', method: 'EXACT_UTF8_SOURCE', version: '1' },
  });
  if (prepared.manifest.textSha256 !== originalSha256)
    throw new Error('The complete original text could not be preserved exactly.');
  return prepared;
}
