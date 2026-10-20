import { describe, expect, it } from 'vitest';
import {
  planVocabularyChunks,
  splitVocabularyChunk,
  vocabularyChunkContext,
} from '@/lib/vocabulary/index-chunks';
import { buildReadingVocabularyWordTable } from '@/lib/learning/reading/vocabulary-protocol';

describe('complete source ranges', () => {
  it.each([' ', '\n'])(
    'covers a long %j-separated source without clipping words or dropping its tail',
    (separator) => {
      const text = Array.from({ length: 3000 }, (_, index) => `Wort${index}`).join(separator);
      expect(text.length).toBeGreaterThan(12000);
      const ranges = planVocabularyChunks(text, 'de');
      expect(ranges.map((range) => text.slice(range.startOffset, range.endOffset)).join('')).toBe(
        text
      );
      const original = buildReadingVocabularyWordTable(text, 'de', text.length);
      for (const range of ranges) {
        const context = vocabularyChunkContext(text, range.startOffset, range.endOffset, 'de');
        expect(context.text.length).toBeLessThanOrEqual(12000);
        const local = buildReadingVocabularyWordTable(context.text, 'de');
        expect(
          local.map((word) => ({
            ...word,
            start: word.start + context.startOffset,
            end: word.end + context.startOffset,
          }))
        ).toEqual(
          original.filter(
            (word) => word.start >= context.startOffset && word.end <= context.endOffset
          )
        );
      }
      expect(ranges.at(-1)!.endOffset).toBe(text.length);
    }
  );
  it('owns whitespace padding without sending empty sections to the model', () => {
    const text = `${'\n'.repeat(20000)}Bahnhof${'\n'.repeat(20000)}Fahrkarte${'\n'.repeat(20000)}`;
    const ranges = planVocabularyChunks(text, 'de');
    expect(ranges.map((range) => text.slice(range.startOffset, range.endOffset)).join('')).toBe(
      text
    );
    expect(
      ranges.map(
        (range) => vocabularyChunkContext(text, range.startOffset, range.endOffset, 'de').text
      )
    ).toEqual(['Bahnhof', 'Fahrkarte']);
  });
  it('subdivides a saturated single-line source and keeps a boundary-crossing expression visible', () => {
    const text = 'eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf';
    const children = splitVocabularyChunk(text, 0, text.length, 'de');
    expect(children[0]!.endOffset).toBe(children[1]!.startOffset);
    expect(children.map((range) => text.slice(range.startOffset, range.endOffset)).join('')).toBe(
      text
    );
    expect(
      children.map(
        (range) => vocabularyChunkContext(text, range.startOffset, range.endOffset, 'de').text
      )
    ).toEqual([text, text]);
  });
});
