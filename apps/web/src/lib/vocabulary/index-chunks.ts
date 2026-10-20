import { buildReadingVocabularyWordTable } from '../learning/reading/vocabulary-protocol';

function documentWords(text: string, targetLang: string) {
  return buildReadingVocabularyWordTable(text, targetLang, Math.max(1, text.length));
}

/** Exact contiguous UTF16 ownership ranges, including padding. Dense lines split on whole words. */
export function planVocabularyChunks(text: string, targetLang: string) {
  if (!text.trim())
    throw new Error('This material needs a text transcription before vocabulary can be indexed.');
  const words = documentWords(text, targetLang);
  const ranges: { startOffset: number; endOffset: number }[] = [];
  let first = 0;
  let startOffset = 0;
  for (let index = 0; index < words.length; index++) {
    const next = words[index + 1];
    const span = text.slice(words[first]!.start, words[index]!.end);
    if (span.length > 11000)
      throw new Error('A source token exceeds the vocabulary indexing limit.');
    const enough =
      span.length >= 1600 ||
      (next && next.start - words[first]!.start >= 1600) ||
      span.split('\n').length >= 8;
    if (next && !enough) continue;
    const endOffset = next?.start ?? text.length;
    ranges.push({ startOffset, endOffset });
    startOffset = endOffset;
    first = index + 1;
  }
  return ranges;
}

/** Neighboring words preserve a phrase crossing a range boundary; only core-starting entries publish. */
export function vocabularyChunkContext(
  text: string,
  startOffset: number,
  endOffset: number,
  targetLang: string
) {
  const words = documentWords(text, targetLang);
  const first = words.findIndex((word) => word.start >= startOffset);
  const last = words.findLastIndex((word) => word.start < endOffset);
  if (first < 0 || last < first) throw new Error('Source section has no complete lexical tokens.');
  const before = words
    .slice(Math.max(0, first - 8), first)
    .filter((word) => words[first]!.start - word.start <= 256);
  const after = words
    .slice(last + 1, last + 9)
    .filter((word) => word.end - words[last]!.end <= 256);
  const contextStart = before[0]?.start ?? words[first]!.start;
  const contextEnd = after.at(-1)?.end ?? words[last]!.end;
  return {
    startOffset: contextStart,
    endOffset: contextEnd,
    text: text.slice(contextStart, contextEnd),
  };
}

export function splitVocabularyChunk(
  text: string,
  startOffset: number,
  endOffset: number,
  targetLang: string
) {
  const words = documentWords(text, targetLang).filter(
    (word) => word.start >= startOffset && word.start < endOffset
  );
  if (words.length < 2)
    throw new Error(
      'This source entry could not be verified. Review its transcription before retrying.'
    );
  const split = words[Math.floor(words.length / 2)]!.start;
  return [
    { startOffset, endOffset: split },
    { startOffset: split, endOffset },
  ];
}
