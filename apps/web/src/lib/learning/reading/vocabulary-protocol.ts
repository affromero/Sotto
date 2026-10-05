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
            sourceForm: z.string().min(1),
            questionIndices: z.array(z.number().int().nonnegative()),
          })
          .strict()
      )
      .min(1)
      .max(12),
  })
  .strict();

export function buildReadingVocabularyJsonSchema(questionCount: number) {
  if (!Number.isSafeInteger(questionCount) || questionCount < 1)
    throw new Error('Reading vocabulary requires a positive safe question count.');
  const word = readingVocabularyResponseSchema.shape.words.element.extend({
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

/** Static protocol diagnostics never retain provider output or parser errors. */
export class ReadingVocabularyProtocolError extends Error {
  readonly code: ReadingVocabularyProtocolCode;

  constructor(code: ReadingVocabularyProtocolCode) {
    super(protocolMessages[code]);
    this.name = 'ReadingVocabularyProtocolError';
    this.code = code;
  }
}
