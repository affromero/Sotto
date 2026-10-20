// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  captureCanonicalVocabularySource,
  validateCanonicalVocabularySource,
  canonicalVocabularySourceHash,
} from '@/lib/vocabulary/source/snapshot';
import {
  planCanonicalVocabularyChunks,
  canonicalVocabularyContext,
  canonicalVocabularyWordOffsets,
  splitCanonicalVocabularyChunk,
} from '@/lib/vocabulary/source/ranges';
import { readMaterialTextRange } from '@/lib/course-materials/extraction/readers';
import {
  decodeVocabularySourceQuote,
  requireVocabularyTextMetadata,
} from '@/lib/vocabulary/source/publication';
import { canonicalSourceFixture } from './fixtures';

describe('canonical vocabulary source receipts', () => {
  it('preserves BOM, NUL and astral text and converts provider UTF16 spans to exact source points', async () => {
    const fixture = canonicalSourceFixture(['\uFEFF𠮷 Bahnhof\u0000 Fahrkarte e\u0301 Ende']);
    const source = await captureCanonicalVocabularySource(fixture.database, fixture.material);
    expect(
      await readMaterialTextRange(fixture.database, source.inventory, 0, source.inventory.length)
    ).toBe(fixture.text);
    const context = await canonicalVocabularyContext(
      fixture.database,
      source,
      0,
      source.inventory.length,
      'de'
    );
    expect(context.coreStart).toBe(0);
    expect(context.coreEnd).toBe(context.text.length);
    const split = splitCanonicalVocabularyChunk(context, 0, source.inventory.length, 'de');
    expect(split[0]!.startOffset).toBe(0);
    expect(split[1]!.endOffset).toBe(source.inventory.length);
    const start = context.text.indexOf('Bahnhof'),
      end = context.text.indexOf(' Fahrkarte') + ' Fahrkarte'.length;
    const positions = canonicalVocabularyWordOffsets(context, start, end);
    expect([...fixture.text].slice(positions.startOffset, positions.endOffset).join('')).toBe(
      'Bahnhof\u0000 Fahrkarte'
    );
    expect(positions.startOffset).not.toBe(context.startOffset + start);
    const bytes = Buffer.from(context.text.slice(start, end), 'utf8');
    expect(decodeVocabularySourceQuote({ quote: null, quoteBytes: bytes })).toBe(
      'Bahnhof\u0000 Fahrkarte'
    );
    expect(() =>
      canonicalVocabularyWordOffsets(context, context.text.indexOf('𠮷') + 1, 4)
    ).toThrow(/Unicode code point/);
  });
  it('rejects changed byte identities even when a replacement chunk supplies a valid new SHA', async () => {
    const fixture = canonicalSourceFixture(['Bahnhof Fahrkarte']);
    const source = await captureCanonicalVocabularySource(fixture.database, fixture.material);
    fixture.rows[0]!.textBytes = Buffer.from('Fahrhof Fahrkarte');
    fixture.rows[0]!.sha256 = createHash('sha256').update(fixture.rows[0]!.textBytes).digest('hex');
    await expect(
      readMaterialTextRange(fixture.database, source.inventory, 0, source.inventory.length)
    ).rejects.toThrow(/pinned material source chunk/);
  });
  it('does not infer complete source coverage from missing page records or missing text chunks', async () => {
    const fixture = canonicalSourceFixture(['Bahnhof', 'Fahrkarte']);
    const source = await captureCanonicalVocabularySource(fixture.database, fixture.material);
    fixture.rows.splice(0, 1);
    await expect(
      readMaterialTextRange(fixture.database, source.inventory, 0, source.inventory.length)
    ).rejects.toThrow(/incomplete/);
    fixture.run.pages.pop();
    await expect(
      captureCanonicalVocabularySource(fixture.database, fixture.material)
    ).rejects.toThrow(/page accounting is incomplete/);
  });
  it('fences original, processing revision and extraction run changes and hashes JSONB key order consistently', async () => {
    const fixture = canonicalSourceFixture(['Bahnhof Fahrkarte']);
    const source = await captureCanonicalVocabularySource(fixture.database, fixture.material);
    expect(
      canonicalVocabularySourceHash({
        ...source,
        inventory: {
          ...source.inventory,
          streams: source.inventory.streams.map((stream) => ({
            ...stream,
            manifest: { ...stream.manifest },
          })),
        },
      })
    ).toBe(canonicalVocabularySourceHash(source));
    await expect(
      validateCanonicalVocabularySource(
        fixture.database,
        { ...fixture.material, processingRevision: 2 },
        source
      )
    ).rejects.toThrow(/revision changed/);
    await expect(
      validateCanonicalVocabularySource(
        fixture.database,
        { ...fixture.material, originalSha256: 'b'.repeat(64) },
        source
      )
    ).rejects.toThrow(/revision changed/);
    fixture.run.id = randomUUID();
    await expect(
      validateCanonicalVocabularySource(fixture.database, fixture.material, source)
    ).rejects.toThrow(/run or page manifests/);
  });
  it('covers all65pages beyond one million characters including the final page through bounded reads', async () => {
    const pages = Array.from(
      { length: 65 },
      (_, index) =>
        `Page${index + 1}\n${'Bahnhof Fahrkarte Wohnung Schlüssel '.repeat(500)}Ende${index + 1}`
    );
    const fixture = canonicalSourceFixture(pages);
    expect(fixture.text.length).toBeGreaterThan(1_000_000);
    const source = await captureCanonicalVocabularySource(fixture.database, fixture.material);
    const ranges = await planCanonicalVocabularyChunks(fixture.database, source, 'de');
    expect(ranges[0]!.startOffset).toBe(0);
    expect(ranges.at(-1)!.endOffset).toBe([...fixture.text].length);
    expect(
      ranges.every(
        (range, index) => index === 0 || ranges[index - 1]!.endOffset === range.startOffset
      )
    ).toBe(true);
    expect(
      fixture.reads
        .filter((read) => read.end !== undefined)
        .every((read) => read.end! - read.start! <= 12000)
    ).toBe(true);
    const tail = ranges.at(-1)!;
    expect(
      (
        await canonicalVocabularyContext(
          fixture.database,
          source,
          tail.startOffset,
          tail.endOffset,
          'de'
        )
      ).text
    ).toContain('Ende65');
  });
  it('preserves boundary phrase context and disjoint ownership after saturation splitting', async () => {
    const fixture = canonicalSourceFixture([`${'Bahnhof Fahrkarte '.repeat(500)}letzte Fahrkarte`]);
    const source = await captureCanonicalVocabularySource(fixture.database, fixture.material);
    const ranges = await planCanonicalVocabularyChunks(fixture.database, source, 'de');
    const range = ranges[1]!;
    const context = await canonicalVocabularyContext(
      fixture.database,
      source,
      range.startOffset,
      range.endOffset,
      'de'
    );
    expect(context.startOffset).toBeLessThan(range.startOffset);
    expect(context.endOffset).toBeGreaterThan(range.endOffset);
    const halves = splitCanonicalVocabularyChunk(context, range.startOffset, range.endOffset, 'de');
    expect(halves[0]!.startOffset).toBe(range.startOffset);
    expect(halves[0]!.endOffset).toBe(halves[1]!.startOffset);
    expect(halves[1]!.endOffset).toBe(range.endOffset);
  });
  it('accounts punctuation-only text without inventing lexical tokens and preserves unsupported metadata errors', async () => {
    const fixture = canonicalSourceFixture(['...\u0000\n'.repeat(2000)]);
    const source = await captureCanonicalVocabularySource(fixture.database, fixture.material);
    const ranges = await planCanonicalVocabularyChunks(fixture.database, source, 'de');
    expect(ranges.at(-1)!.endOffset).toBe(source.inventory.length);
    expect(
      (
        await canonicalVocabularyContext(
          fixture.database,
          source,
          ranges[0]!.startOffset,
          ranges[0]!.endOffset,
          'de'
        )
      ).hasWords
    ).toBe(false);
    expect(() =>
      requireVocabularyTextMetadata({ lemma: 'word', gloss: 'invalid\u0000metadata', pos: 'noun' })
    ).toThrow(/unsupported database text/);
    expect(decodeVocabularySourceQuote({ quote: 'Historical quote', quoteBytes: null })).toBe(
      'Historical quote'
    );
    expect(() => decodeVocabularySourceQuote({ quote: null, quoteBytes: null })).toThrow(
      /unavailable/
    );
  });
});
