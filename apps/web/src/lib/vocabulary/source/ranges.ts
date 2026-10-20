import type { LearningDatabase } from '../../learning/database';
import { readMaterialTextRange } from '../../course-materials/extraction/readers';
import { buildReadingVocabularyWordTable } from '../../learning/reading/vocabulary-protocol';
import {
  planVocabularyChunks,
  vocabularyChunkContext,
  splitVocabularyChunk,
} from '../index-chunks';
import type { CanonicalVocabularySource } from './snapshot';

function words(text: string, targetLang: string) {
  if (
    ![...new Intl.Segmenter(targetLang, { granularity: 'word' }).segment(text)].some(
      (part) => part.isWordLike
    )
  )
    return [];
  return buildReadingVocabularyWordTable(text, targetLang, text.length);
}
const pointAt = (text: string, offset: number) => [...text.slice(0, offset)].length;
const unitAt = (text: string, offset: number) =>
  [...text].slice(0, Math.max(0, offset)).join('').length;

/** Plan all source points through bounded windows, cutting only at complete lexical boundaries. */
export async function planCanonicalVocabularyChunks(
  database: LearningDatabase,
  source: CanonicalVocabularySource,
  targetLang: string
) {
  const ranges = [];
  let startOffset = 0;
  while (startOffset < source.inventory.length) {
    const stop = Math.min(source.inventory.length, startOffset + 6000);
    const text = await readMaterialTextRange(database, source.inventory, startOffset, stop);
    const tokens = words(text, targetLang);
    let end = text.length;
    if (tokens.length) {
      end = planVocabularyChunks(text, targetLang)[0]!.endOffset;
      if (
        end === text.length &&
        stop < source.inventory.length &&
        tokens.at(-1)!.end === text.length
      )
        end = tokens.at(-1)!.start;
    }
    if (end <= 0) throw new Error('A source token exceeds the bounded vocabulary indexing window.');
    const endOffset = startOffset + pointAt(text, end);
    ranges.push({ startOffset, endOffset });
    startOffset = endOffset;
  }
  return ranges;
}

/** Neighboring complete words support boundary phrases without changing code-point ownership. */
export async function canonicalVocabularyContext(
  database: LearningDatabase,
  source: CanonicalVocabularySource,
  start: number,
  end: number,
  targetLang: string
) {
  let windowStart = Math.max(0, start - 512);
  const windowEnd = Math.min(source.inventory.length, end + 512);
  let text = await readMaterialTextRange(database, source.inventory, windowStart, windowEnd);
  const tokens = words(text, targetLang);
  if (
    !tokens.some(
      (word) =>
        word.start >= unitAt(text, start - windowStart) &&
        word.start < unitAt(text, end - windowStart)
    )
  )
    return {
      text,
      startOffset: windowStart,
      endOffset: windowEnd,
      coreStart: unitAt(text, start - windowStart),
      coreEnd: unitAt(text, end - windowStart),
      hasWords: false,
    };
  let trimStart = 0,
    trimEnd = text.length;
  if (
    windowStart > 0 &&
    tokens[0]!.start === 0 &&
    tokens[0]!.end <= unitAt(text, start - windowStart)
  )
    trimStart = tokens[0]!.end;
  if (
    windowEnd < source.inventory.length &&
    tokens.at(-1)!.end === text.length &&
    tokens.at(-1)!.start >= unitAt(text, end - windowStart)
  )
    trimEnd = tokens.at(-1)!.start;
  windowStart += pointAt(text, trimStart);
  text = text.slice(trimStart, trimEnd);
  const context = vocabularyChunkContext(
    text,
    unitAt(text, start - windowStart),
    unitAt(text, end - windowStart),
    targetLang
  );
  return {
    text: context.text,
    startOffset: windowStart + pointAt(text, context.startOffset),
    endOffset: windowStart + pointAt(text, context.endOffset),
    coreStart: unitAt(context.text, start - windowStart - pointAt(text, context.startOffset)),
    coreEnd: unitAt(context.text, end - windowStart - pointAt(text, context.startOffset)),
    hasWords: true,
  };
}

export function canonicalVocabularyWordOffsets(
  context: { text: string; startOffset: number },
  start: number,
  end: number
) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > context.text.length ||
    !context.text.slice(0, start).isWellFormed() ||
    !context.text.slice(0, end).isWellFormed()
  )
    throw new Error('Vocabulary source span splits an exact Unicode code point.');
  return {
    startOffset: context.startOffset + pointAt(context.text, start),
    endOffset: context.startOffset + pointAt(context.text, end),
  };
}

export function splitCanonicalVocabularyChunk(
  context: Awaited<ReturnType<typeof canonicalVocabularyContext>>,
  start: number,
  end: number,
  targetLang: string
) {
  const ranges = splitVocabularyChunk(
    context.text,
    unitAt(context.text, start - context.startOffset),
    unitAt(context.text, end - context.startOffset),
    targetLang
  );
  const middle = canonicalVocabularyWordOffsets(
    context,
    ranges[0]!.startOffset,
    ranges[0]!.endOffset
  ).endOffset;
  return [
    { startOffset: start, endOffset: middle },
    { startOffset: middle, endOffset: end },
  ];
}
