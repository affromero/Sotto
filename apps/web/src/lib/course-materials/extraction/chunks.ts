import { createHash } from 'node:crypto';
import {
  MATERIAL_EXTRACTION_SCHEMA_VERSION,
  MATERIAL_TEXT_CHUNK_LIMITS,
  materialPageTextManifestSchema,
  materialTextChunkSchema,
  materialTextSourceSchema,
  type MaterialPageTextManifest,
  type MaterialTextChunk,
  type MaterialTextSource,
} from '@sotto/shared';

export interface MaterialTextChunkLimits {
  codePoints: number;
  utf8Bytes: number;
}

function validateLimits(limits: MaterialTextChunkLimits) {
  for (const key of ['codePoints', 'utf8Bytes'] as const) {
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > MATERIAL_TEXT_CHUNK_LIMITS[key]
    )
      throw new Error('Invalid material text chunk limits.');
  }
}

/** Offsets are half-open and local to the exact page text origin. No normalization. */
function* segments(text: string, limits: MaterialTextChunkLimits) {
  let unitStart = 0;
  let unitEnd = 0;
  let codePointStart = 0;
  let utf8ByteStart = 0;
  let points = 0;
  let bytes = 0;
  for (const point of text) {
    const pointBytes = Buffer.byteLength(point, 'utf8');
    if (pointBytes > limits.utf8Bytes)
      throw new Error('The UTF-8 chunk byte limit cannot fit a source code point.');
    if (points > 0 && (points === limits.codePoints || bytes + pointBytes > limits.utf8Bytes)) {
      yield {
        text: text.slice(unitStart, unitEnd),
        codePointStart,
        codePointEnd: codePointStart + points,
        utf8ByteStart,
        utf8ByteEnd: utf8ByteStart + bytes,
      };
      unitStart = unitEnd;
      codePointStart += points;
      utf8ByteStart += bytes;
      points = 0;
      bytes = 0;
    }
    unitEnd += point.length;
    points += 1;
    bytes += pointBytes;
  }
  if (points > 0)
    yield {
      text: text.slice(unitStart, unitEnd),
      codePointStart,
      codePointEnd: codePointStart + points,
      utf8ByteStart,
      utf8ByteEnd: utf8ByteStart + bytes,
    };
}

/**
 * Accept one already extracted page string. No document-wide concatenation or cap.
 * The manifest describes source text, not successful storage. Validate persisted
 * chunks before committing their manifest as complete coverage.
 */
export function prepareMaterialPageText(
  input: { pageNumber: number; source: MaterialTextSource; text: string },
  chunkLimits: MaterialTextChunkLimits = MATERIAL_TEXT_CHUNK_LIMITS
): { manifest: MaterialPageTextManifest; chunks: Iterable<MaterialTextChunk> } {
  const limits = { ...chunkLimits };
  validateLimits(limits);
  if (!input.text.isWellFormed())
    throw new Error('Material text contains an unpaired Unicode surrogate.');
  const source = materialTextSourceSchema.parse(input.source);
  const pageNumber = input.pageNumber;
  const text = input.text;
  const hash = createHash('sha256');
  let chunkCount = 0;
  let codePointLength = 0;
  let utf8ByteLength = 0;
  for (const segment of segments(text, limits)) {
    hash.update(segment.text, 'utf8');
    chunkCount += 1;
    codePointLength = segment.codePointEnd;
    utf8ByteLength = segment.utf8ByteEnd;
  }
  const manifest = materialPageTextManifestSchema.parse({
    schemaVersion: MATERIAL_EXTRACTION_SCHEMA_VERSION,
    pageNumber,
    source,
    textSha256: hash.digest('hex'),
    codePointLength,
    utf8ByteLength,
    chunkCount,
    hasNonWhitespace: /\S/u.test(text),
  });
  const pageTextSha256 = manifest.textSha256;
  function* chunks(): Generator<MaterialTextChunk> {
    let index = 0;
    for (const segment of segments(text, limits)) {
      yield {
        schemaVersion: MATERIAL_EXTRACTION_SCHEMA_VERSION,
        pageNumber,
        origin: source.origin,
        pageTextSha256,
        index,
        ...segment,
        sha256: createHash('sha256').update(segment.text, 'utf8').digest('hex'),
      };
      index += 1;
    }
  }
  return { manifest, chunks: { [Symbol.iterator]: chunks } };
}

export interface MaterialTextChunkValidator {
  accept(chunk: MaterialTextChunk): void;
  finish(): void;
}

/** Validate bounded chunks as they arrive. Only finish establishes complete coverage. */
export function createMaterialTextChunkValidator(
  input: MaterialPageTextManifest
): MaterialTextChunkValidator {
  const manifest = materialPageTextManifestSchema.parse(input);
  const pageHash = createHash('sha256');
  let index = 0;
  let codePointOffset = 0;
  let byteOffset = 0;
  let hasNonWhitespace = false;
  let closed = false;
  let failed = false;
  function requireOpen() {
    if (closed || failed) throw new Error('Material text chunk validation is no longer open.');
  }
  function accept(inputChunk: MaterialTextChunk) {
    requireOpen();
    try {
      const chunk = materialTextChunkSchema.parse(inputChunk);
      if (
        index >= manifest.chunkCount ||
        !chunk.text.isWellFormed() ||
        chunk.index !== index ||
        chunk.pageNumber !== manifest.pageNumber ||
        chunk.origin !== manifest.source.origin ||
        chunk.pageTextSha256 !== manifest.textSha256 ||
        chunk.codePointStart !== codePointOffset ||
        chunk.utf8ByteStart !== byteOffset ||
        chunk.codePointEnd > manifest.codePointLength ||
        chunk.utf8ByteEnd > manifest.utf8ByteLength ||
        chunk.codePointEnd !== codePointOffset + [...chunk.text].length ||
        chunk.utf8ByteEnd !== byteOffset + Buffer.byteLength(chunk.text, 'utf8') ||
        chunk.sha256 !== createHash('sha256').update(chunk.text, 'utf8').digest('hex')
      )
        throw new Error('Material text chunks have conflicting content, identity or offsets.');
      pageHash.update(chunk.text, 'utf8');
      index += 1;
      codePointOffset = chunk.codePointEnd;
      byteOffset = chunk.utf8ByteEnd;
      hasNonWhitespace ||= /\S/u.test(chunk.text);
    } catch (error) {
      failed = true;
      throw error;
    }
  }
  function finish() {
    requireOpen();
    closed = true;
    if (
      index !== manifest.chunkCount ||
      codePointOffset !== manifest.codePointLength ||
      byteOffset !== manifest.utf8ByteLength ||
      hasNonWhitespace !== manifest.hasNonWhitespace ||
      pageHash.digest('hex') !== manifest.textSha256
    )
      throw new Error('Material text chunks do not cover the complete source text.');
  }
  return { accept, finish };
}

/** Validate complete ordered coverage without assembling a page or document string. */
export function validateMaterialTextChunks(
  input: MaterialPageTextManifest,
  chunks: Iterable<MaterialTextChunk>
): void {
  const validator = createMaterialTextChunkValidator(input);
  for (const chunk of chunks) validator.accept(chunk);
  validator.finish();
}
