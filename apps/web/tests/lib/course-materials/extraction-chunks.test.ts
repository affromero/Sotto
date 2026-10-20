// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MATERIAL_TEXT_CHUNK_LIMITS,
  type MaterialTextChunk,
  type MaterialTextSource,
} from '@sotto/shared';
import {
  createMaterialTextChunkValidator,
  prepareMaterialPageText,
  validateMaterialTextChunks,
} from '@/lib/course-materials/extraction/chunks';

const source: MaterialTextSource = {
  origin: 'EMBEDDED_TEXT',
  method: 'owned-synthetic-extractor',
  version: '1',
};
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const prepare = (text: string) =>
  prepareMaterialPageText({ pageNumber: 1, source, text }, { codePoints: 3, utf8Bytes: 7 });

describe('complete material page text chunks', () => {
  it('preserves all Unicode content and stable page-local code point and UTF-8 offsets', () => {
    const text = '\uFEFFGrüße\r\n漢字🙂👩‍👩‍👧‍👦e\u0301\tעברית\u0000\n  final ';
    const { manifest, chunks: iterable } = prepare(text);
    const chunks = [...iterable];
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(text);
    expect(manifest.textSha256).toBe(sha(text));
    expect(manifest.codePointLength).toBe([...text].length);
    expect(manifest.utf8ByteLength).toBe(Buffer.byteLength(text, 'utf8'));
    for (const chunk of chunks) {
      expect([...text].slice(chunk.codePointStart, chunk.codePointEnd).join('')).toBe(chunk.text);
      expect(
        Buffer.from(text).subarray(chunk.utf8ByteStart, chunk.utf8ByteEnd).toString('utf8')
      ).toBe(chunk.text);
      expect(chunk.sha256).toBe(sha(chunk.text));
      expect(chunk.text.isWellFormed()).toBe(true);
      expect(chunk.codePointEnd - chunk.codePointStart).toBeLessThanOrEqual(3);
      expect(chunk.utf8ByteEnd - chunk.utf8ByteStart).toBeLessThanOrEqual(7);
    }
    validateMaterialTextChunks(manifest, chunks);
  });
  it('retains more than one million characters on one page without truncating the ending', () => {
    const text = '漢🙂e\u0301\r\n'.repeat(180_000) + 'FINAL_PAGE_FOCUS: als versus wenn';
    expect(text.length).toBeGreaterThan(1_000_000);
    const { manifest, chunks } = prepareMaterialPageText({
      pageNumber: 65,
      source,
      text,
    });
    expect(manifest.codePointLength).toBeGreaterThan(1_000_000);
    let reconstructed = '';
    for (const chunk of chunks) {
      expect(chunk.codePointEnd - chunk.codePointStart).toBeLessThanOrEqual(
        MATERIAL_TEXT_CHUNK_LIMITS.codePoints
      );
      expect(Buffer.byteLength(chunk.text, 'utf8')).toBeLessThanOrEqual(
        MATERIAL_TEXT_CHUNK_LIMITS.utf8Bytes
      );
      reconstructed += chunk.text;
    }
    expect(reconstructed).toBe(text);
    expect(reconstructed.endsWith('FINAL_PAGE_FOCUS: als versus wenn')).toBe(true);
    expect(manifest.chunkCount).toBeGreaterThan(50);
    validateMaterialTextChunks(manifest, chunks);
  });
  it('represents an empty extraction with zero chunks and the exact empty digest', () => {
    const prepared = prepare('');
    expect(prepared.manifest).toMatchObject({
      chunkCount: 0,
      codePointLength: 0,
      utf8ByteLength: 0,
      textSha256: sha(''),
    });
    expect([...prepared.chunks]).toEqual([]);
    validateMaterialTextChunks(prepared.manifest, prepared.chunks);
  });
  it('preserves whitespace and distinct Unicode normalization forms', () => {
    expect(prepare('é').manifest.textSha256).not.toBe(prepare('e\u0301').manifest.textSha256);
    const text = ' \r\n\t ';
    expect([...prepare(text).chunks].map((chunk) => chunk.text).join('')).toBe(text);
  });
  it('keeps embedded extraction and recognition as separate immutable channels', () => {
    const embedded = prepare('Printed sentence.');
    const recognized = prepareMaterialPageText({
      pageNumber: 1,
      source: {
        ...source,
        origin: 'VISUAL_RECOGNITION',
        method: 'explicit-recognizer',
      },
      text: 'Printed sentence.\nHandwritten correction?',
    });
    expect(recognized.manifest.source.origin).toBe('VISUAL_RECOGNITION');
    expect(recognized.manifest.textSha256).not.toBe(embedded.manifest.textSha256);
    expect(() => validateMaterialTextChunks(embedded.manifest, recognized.chunks)).toThrow();
  });
  it('offers restartable bounded chunk iteration without retaining a chunk array', () => {
    const prepared = prepare('abcdef🙂');
    const iterator = prepared.chunks[Symbol.iterator]();
    expect(iterator.next().value?.text).toBe('abc');
    iterator.return?.();
    validateMaterialTextChunks(prepared.manifest, prepared.chunks);
    expect([...prepared.chunks]).toHaveLength(prepared.manifest.chunkCount);
  });
  it('captures input provenance and limits before the caller mutates their objects', () => {
    const localSource = { ...source };
    const limits = { codePoints: 3, utf8Bytes: 7 };
    const input = { pageNumber: 1, source: localSource, text: 'abcdef' };
    const prepared = prepareMaterialPageText(input, limits);
    localSource.origin = 'VISUAL_RECOGNITION';
    input.text = 'changed';
    limits.codePoints = 1;
    expect([...prepared.chunks].map((chunk) => chunk.text)).toEqual(['abc', 'def']);
    expect(prepared.manifest.source.origin).toBe('EMBEDDED_TEXT');
  });
  it.each(['\uD800', 'a\uDC00b'])(
    'rejects malformed Unicode instead of replacing it: %j',
    (text) => {
      expect(() => prepare(text)).toThrow('unpaired Unicode surrogate');
    }
  );
  it('rejects an insufficient byte ceiling rather than dropping an unfittable code point', () => {
    expect(() =>
      prepareMaterialPageText(
        { pageNumber: 1, source, text: '🙂' },
        { codePoints: 3, utf8Bytes: 3 }
      )
    ).toThrow('cannot fit');
  });
  it.each([
    { codePoints: 0, utf8Bytes: 4 },
    { codePoints: 3, utf8Bytes: Infinity },
    { codePoints: 16_001, utf8Bytes: 4 },
  ])('rejects unsupported chunk limits %j', (limits) => {
    expect(() => prepareMaterialPageText({ pageNumber: 1, source, text: 'abc' }, limits)).toThrow(
      'Invalid material text chunk limits'
    );
  });
  it('rejects missing, duplicated, reordered and extra chunks', () => {
    const prepared = prepare('abcdefgh');
    const chunks = [...prepared.chunks];
    for (const altered of [
      chunks.slice(1),
      chunks.slice(0, -1),
      [chunks[0]!, ...chunks],
      [...chunks].reverse(),
      [...chunks, chunks[0]!],
    ])
      expect(() => validateMaterialTextChunks(prepared.manifest, altered)).toThrow();
  });
  it('rejects changed text, digest, page identity, origin and code point or byte offsets', () => {
    const prepared = prepare('abcdef');
    const chunks = [...prepared.chunks];
    const changes: Partial<MaterialTextChunk>[] = [
      { text: 'xyz' },
      { sha256: '0'.repeat(64) },
      { pageTextSha256: '0'.repeat(64) },
      { pageNumber: 2 },
      { origin: 'VISUAL_RECOGNITION' },
      { codePointStart: 1 },
      { utf8ByteEnd: 2 },
    ];
    for (const change of changes)
      expect(() =>
        validateMaterialTextChunks(prepared.manifest, [
          { ...chunks[0]!, ...change },
          ...chunks.slice(1),
        ])
      ).toThrow();
  });
  it('rejects a forged whole-page hash even when every chunk claims it', () => {
    const prepared = prepare('abcdef');
    const alteredHash = sha('different text');
    const chunks = [...prepared.chunks].map((chunk) => ({
      ...chunk,
      pageTextSha256: alteredHash,
    }));
    expect(() =>
      validateMaterialTextChunks({ ...prepared.manifest, textSha256: alteredHash }, chunks)
    ).toThrow('complete source text');
  });
  it('verifies content-bearing metadata before it can support a blank classification', () => {
    const prepared = prepare('visible content');
    expect(() =>
      validateMaterialTextChunks({ ...prepared.manifest, hasNonWhitespace: false }, prepared.chunks)
    ).toThrow('complete source text');
  });
  it('validates complete Unicode coverage incrementally across persistence batches', () => {
    const prepared = prepare('漢🙂e\u0301\u0000\r\nfinal');
    const validator = createMaterialTextChunkValidator(prepared.manifest);
    for (const chunk of prepared.chunks) validator.accept(chunk);
    expect(() => validator.finish()).not.toThrow();
  });
  it('cannot resume validation after rejecting a corrupt chunk', () => {
    const prepared = prepare('abcdef');
    const chunks = [...prepared.chunks];
    const validator = createMaterialTextChunkValidator(prepared.manifest);
    expect(() => validator.accept({ ...chunks[0]!, text: 'xyz' })).toThrow();
    expect(() => validator.accept(chunks[0]!)).toThrow('no longer open');
    expect(() => validator.finish()).toThrow('no longer open');
  });
  it('rejects missing final coverage and prevents later appends after that failure', () => {
    const prepared = prepare('abcdef');
    const chunks = [...prepared.chunks];
    const validator = createMaterialTextChunkValidator(prepared.manifest);
    validator.accept(chunks[0]!);
    expect(() => validator.finish()).toThrow('complete source text');
    expect(() => validator.accept(chunks[1]!)).toThrow('no longer open');
  });
  it('verifies the whole-page digest after accepting valid individual chunk digests', () => {
    const prepared = prepare('abcdef');
    const validator = createMaterialTextChunkValidator(prepared.manifest);
    for (const chunk of prepared.chunks) {
      const text = 'x'.repeat(chunk.text.length);
      validator.accept({ ...chunk, text, sha256: sha(text) });
    }
    expect(() => validator.finish()).toThrow('complete source text');
  });
  it('closes successful validation and rejects excess chunks or a second finalization', () => {
    const prepared = prepare('abc');
    const chunk = [...prepared.chunks][0]!;
    const validator = createMaterialTextChunkValidator(prepared.manifest);
    validator.accept(chunk);
    validator.finish();
    expect(() => validator.accept(chunk)).toThrow('no longer open');
    expect(() => validator.finish()).toThrow('no longer open');
    const excess = createMaterialTextChunkValidator(prepared.manifest);
    excess.accept(chunk);
    expect(() => excess.accept(chunk)).toThrow();
    expect(() => excess.finish()).toThrow('no longer open');
  });
  it('captures the manifest before the caller mutates it and accepts exact empty coverage', () => {
    const prepared = prepare('');
    const validator = createMaterialTextChunkValidator(prepared.manifest);
    prepared.manifest.textSha256 = sha('changed');
    expect(() => validator.finish()).not.toThrow();
  });
});
