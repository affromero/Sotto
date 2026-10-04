import { z } from 'zod';

export const teachingQualityVerdictSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(4),
            acceptable: z.boolean(),
            issues: z
              .array(
                z.enum([
                  'incorrect',
                  'unnatural',
                  'unsupported',
                  'infeasible',
                  'level',
                  'uncertain',
                ])
              )
              .max(6),
            feedback: z.array(z.string().trim().min(1).max(300)).max(6),
          })
          .strict()
      )
      .min(1)
      .max(5),
  })
  .strict();

const MAX_CANDIDATE_BYTES = 32 * 1024;
const reviewEvidenceSchema = z
  .object({
    candidate: z
      .string()
      .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_CANDIDATE_BYTES)
      .nullable(),
    omitted: z.literal('size_limit').optional(),
    verdict: teachingQualityVerdictSchema,
  })
  .strict()
  .refine((review) => (review.candidate === null) === (review.omitted === 'size_limit'));

export const teachingFailureSchema = z
  .object({
    kind: z.enum(['intro', 'explanations', 'writing', 'listening', 'speaking', 'vocabulary']),
    reviews: z.array(reviewEvidenceSchema).min(1).max(2),
  })
  .strict();

export type TeachingFailure = z.infer<typeof teachingFailureSchema>;

/** Private normalized output only. Prompts and provider credentials are never captured. */
export function captureTeachingFailure(
  kind: TeachingFailure['kind'],
  items: readonly unknown[],
  verdict: z.infer<typeof teachingQualityVerdictSchema>
): TeachingFailure {
  const candidate = JSON.stringify(items);
  const review =
    Buffer.byteLength(candidate, 'utf8') <= MAX_CANDIDATE_BYTES
      ? { candidate, verdict }
      : { candidate: null, omitted: 'size_limit' as const, verdict };
  return teachingFailureSchema.parse({ kind, reviews: [review] });
}

export function combineTeachingFailures(
  initial: TeachingFailure | undefined,
  replacement: TeachingFailure | undefined
): TeachingFailure | undefined {
  if (!initial) return replacement;
  if (!replacement) return initial;
  if (initial.kind !== replacement.kind) throw new Error('Teaching failure kinds changed.');
  return teachingFailureSchema.parse({
    kind: initial.kind,
    reviews: [...initial.reviews, ...replacement.reviews],
  });
}
