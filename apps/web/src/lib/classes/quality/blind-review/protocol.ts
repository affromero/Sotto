import { z } from 'zod';
import { buildReviewSourceParts } from '../source-parts/chunks';

export const blindReviewIssueSchema = z.enum([
  'ambiguous',
  'incorrect',
  'unnatural',
  'unsupported',
  'level',
  'uncertain',
]);

export const blindReviewQuestionsSchema = z
  .array(
    z
      .object({
        index: z.number().int().min(0).max(4),
        acceptableOptionIndices: z.array(z.number().int().min(0).max(3)).max(4),
        issues: z.array(blindReviewIssueSchema).max(6),
      })
      .strict()
  )
  .min(1)
  .max(5);

/** Exact source anchors only. The complete passage remains the review context. */
export function buildBlindReviewSourceParts(passage: string): string[] {
  return buildReviewSourceParts(passage, 240);
}

export function blindReviewResponseSchema(sourceParts: readonly string[]) {
  const indices = sourceParts.map((_, index) => index);
  return z
    .object({
      passageFindings: z
        .array(
          z
            .object({
              sourcePartIndex: z.literal(indices.length ? indices : [0]),
              issue: blindReviewIssueSchema,
              reason: z.string().min(1).max(300).regex(/\S/),
            })
            .strict()
        )
        .max(sourceParts.length ? 3 : 0),
      issues: z.array(blindReviewIssueSchema).max(6),
      questions: blindReviewQuestionsSchema,
    })
    .strict();
}
