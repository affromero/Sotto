import { z } from 'zod';

/** Private model output. Stored vocabulary keeps its existing question-ID contract. */
export const readingVocabularyResponseSchema = z
  .object({
    words: z
      .array(
        z
          .object({
            lemma: z.string().trim().min(1),
            gloss: z.string().trim().min(1),
            pos: z.string().trim().min(1),
            sourceSpan: z
              .object({
                startWordIndex: z.number().int().nonnegative(),
                endWordIndex: z.number().int().nonnegative(),
              })
              .strict(),
            questionIndices: z.array(z.number().int().nonnegative()),
          })
          .strict()
      )
      .min(1)
      .max(12),
  })
  .strict();

export type ReadingPassageWord = { surface: string; start: number; end: number };

/** Private indices retain exact UTF16 offsets into the original passage. */
export function buildReadingVocabularyWordTable(
  passageText: string,
  targetLang: string,
  maxChars = 12000
): ReadingPassageWord[] {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1 || passageText.length > maxChars)
    throw new Error('The reading passage exceeds the vocabulary extraction limit.');
  if (!targetLang || !Intl.Segmenter.supportedLocalesOf(targetLang).length)
    throw new Error('Reading vocabulary requires a supported segmentation language.');
  const segmenter = new Intl.Segmenter(targetLang, { granularity: 'word' });
  const words = [...segmenter.segment(passageText)]
    .filter((segment) => segment.isWordLike)
    .map(({ segment, index }) => ({ surface: segment, start: index, end: index + segment.length }));
  if (!words.length) throw new Error('Reading vocabulary requires a nonempty passage word table.');
  return words;
}

/** A quotation must cover complete source tokens, not a substring of another word. */
export function hasSourceVocabularyQuote(
  source: string,
  quote: string,
  targetLang: string
): boolean {
  const words = buildReadingVocabularyWordTable(source, targetLang);
  const ends = new Set(words.map((word) => word.end));
  return words.some(
    (word) => source.startsWith(quote, word.start) && ends.has(word.start + quote.length)
  );
}

export function buildReadingVocabularyJsonSchema(questionCount: number, sourceWordCount: number) {
  if (!Number.isSafeInteger(questionCount) || questionCount < 1)
    throw new Error('Reading vocabulary requires a positive safe question count.');
  if (!Number.isSafeInteger(sourceWordCount) || sourceWordCount < 1)
    throw new Error('Reading vocabulary requires a positive safe source-word count.');
  const word = readingVocabularyResponseSchema.shape.words.element.extend({
    sourceSpan: readingVocabularyResponseSchema.shape.words.element.shape.sourceSpan.extend({
      startWordIndex: z
        .number()
        .int()
        .nonnegative()
        .max(sourceWordCount - 1),
      endWordIndex: z
        .number()
        .int()
        .nonnegative()
        .max(sourceWordCount - 1),
    }),
    questionIndices: z
      .array(
        z
          .number()
          .int()
          .nonnegative()
          .max(questionCount - 1)
      )
      .max(questionCount),
  });
  return {
    name: 'reading_vocabulary_extraction',
    schema: z.toJSONSchema(
      readingVocabularyResponseSchema.extend({ words: z.array(word).min(1).max(12) }),
      { target: 'draft-7' }
    ),
  };
}

/** Imported source vocabulary has quotations, never invented assessment associations. */
export function buildSourceVocabularyJsonSchema(sourceWordCount: number) {
  if (!Number.isSafeInteger(sourceWordCount) || sourceWordCount < 1)
    throw new Error('Source vocabulary requires a positive safe source-word count.');
  const word = readingVocabularyResponseSchema.shape.words.element.extend({
    sourceSpan: readingVocabularyResponseSchema.shape.words.element.shape.sourceSpan.extend({
      startWordIndex: z
        .number()
        .int()
        .nonnegative()
        .max(sourceWordCount - 1),
      endWordIndex: z
        .number()
        .int()
        .nonnegative()
        .max(sourceWordCount - 1),
    }),
    questionIndices: z.array(z.number().int().nonnegative()).length(0),
  });
  return {
    name: 'source_vocabulary_extraction',
    schema: z.toJSONSchema(
      readingVocabularyResponseSchema.extend({ words: z.array(word).min(1).max(12) }),
      { target: 'draft-7' }
    ),
  };
}

function vocabularyMetadataRepairSchema(wordCount: number) {
  if (!Number.isSafeInteger(wordCount) || wordCount < 1 || wordCount > 12)
    throw new Error('Vocabulary metadata repair requires one through twelve original words.');
  return z
    .object({
      words: z
        .array(
          z
            .object({
              wordIndex: z
                .number()
                .int()
                .min(0)
                .max(wordCount - 1),
              lemma: z.string().trim().min(1),
              gloss: z.string().trim().min(1),
              pos: z.string().trim().min(1),
            })
            .strict()
        )
        .length(wordCount),
    })
    .strict();
}

/** Metadata repair cannot author source quotations or assessment associations. */
export function buildVocabularyMetadataRepairJsonSchema(wordCount: number) {
  return {
    name: 'vocabulary_metadata_repair',
    schema: z.toJSONSchema(vocabularyMetadataRepairSchema(wordCount), { target: 'draft-7' }),
  };
}

/** Apply a complete indexed repair to the validated original words in their original order. */
export function compileVocabularyMetadataRepair<
  Word extends { lemma: string; gloss: string; pos: string },
>(content: string, words: readonly Word[]): Word[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ReadingVocabularyProtocolError('malformed_json');
  }
  const repair = vocabularyMetadataRepairSchema(words.length).safeParse(parsed);
  if (!repair.success) throw new ReadingVocabularyProtocolError('invalid_shape');
  const byIndex = new Map(repair.data.words.map((word) => [word.wordIndex, word]));
  if (byIndex.size !== words.length)
    throw new ReadingVocabularyProtocolError('replacement_identity');
  const lemmas = new Set<string>();
  return words.map((word, wordIndex) => {
    const { lemma, gloss, pos } = byIndex.get(wordIndex)!;
    if (lemmas.has(lemma))
      throw new ReadingVocabularyProtocolError('source_attribution', [
        { code: 'dup_lemma', wordIndex },
      ]);
    lemmas.add(lemma);
    return { ...word, lemma, gloss, pos };
  });
}

const protocolMessages = {
  malformed_json: 'Reading vocabulary extraction returned malformed JSON.',
  invalid_shape: 'Reading vocabulary extraction returned invalid vocabulary.',
  source_attribution:
    'Reading vocabulary attribution does not match the supplied passage and questions.',
  replacement_identity: 'Reading vocabulary correction changed the original source identities.',
} as const;

export type ReadingVocabularyProtocolCode = keyof typeof protocolMessages;

export type ReadingAttributionViolation = {
  code: 'dup_lemma' | 'invalid_source_span' | 'dup_question_index' | 'out_of_range';
  wordIndex: number;
};

/** Static protocol diagnostics never retain provider output or parser errors. */
export class ReadingVocabularyProtocolError extends Error {
  readonly code: ReadingVocabularyProtocolCode;
  readonly violations: readonly ReadingAttributionViolation[];

  constructor(
    code: ReadingVocabularyProtocolCode,
    violations: readonly ReadingAttributionViolation[] = []
  ) {
    super(protocolMessages[code]);
    this.name = 'ReadingVocabularyProtocolError';
    this.code = code;
    this.violations = violations.slice(0, 48);
  }
}
