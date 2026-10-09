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
  targetLang: string
): ReadingPassageWord[] {
  if (passageText.length > 12000)
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
