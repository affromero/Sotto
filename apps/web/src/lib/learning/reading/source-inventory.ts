import { z } from 'zod';
import { readingVocabularyResponseSchema } from './vocabulary-protocol';

const inventoryWordSchema = readingVocabularyResponseSchema.shape.words.element.extend({
  lemma: z.string().trim().min(1).max(500),
  gloss: z.string().trim().min(1).max(2000),
  pos: z.string().trim().min(1).max(100),
});
export const sourceInventorySchema = z
  .object({
    words: z.array(inventoryWordSchema).max(64),
    coverage: z
      .array(
        z
          .object({
            lineIndex: z.number().int().nonnegative(),
            entries: z.array(z.number().int().nonnegative()).max(64),
            classification: z.enum(['VOCABULARY', 'CONTEXT']),
          })
          .strict()
      )
      .max(128),
  })
  .strict();

export function sourceInventoryLines(text: string) {
  const lines: { index: number; text: string; start: number; end: number }[] = [];
  for (const match of text.matchAll(/[^\n]+/gu)) {
    if (!match[0].trim()) continue;
    lines.push({
      index: lines.length,
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return lines;
}

export function sourceInventoryJsonSchema(sourceWordCount: number, lineCount: number) {
  if (
    !Number.isSafeInteger(sourceWordCount) ||
    sourceWordCount < 1 ||
    !Number.isSafeInteger(lineCount) ||
    lineCount < 1 ||
    lineCount > 128
  )
    throw new Error('Source inventory requires bounded, nonempty source tables.');
  const word = inventoryWordSchema.extend({
    sourceSpan: z
      .object({
        startWordIndex: z
          .number()
          .int()
          .min(0)
          .max(sourceWordCount - 1),
        endWordIndex: z
          .number()
          .int()
          .min(0)
          .max(sourceWordCount - 1),
      })
      .strict(),
    questionIndices: z.array(z.number().int().nonnegative()).length(0),
  });
  return {
    name: 'source_vocabulary_inventory',
    schema: z.toJSONSchema(
      sourceInventorySchema.extend({
        words: z.array(word).max(64),
        coverage: z
          .array(
            sourceInventorySchema.shape.coverage.element.extend({
              lineIndex: z
                .number()
                .int()
                .min(0)
                .max(lineCount - 1),
            })
          )
          .length(lineCount),
      }),
      { target: 'draft-7' }
    ),
  };
}

export class SourceInventorySaturated extends Error {}
export class SourceInventoryIncomplete extends Error {}
