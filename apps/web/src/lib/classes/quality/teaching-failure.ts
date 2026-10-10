import { z } from 'zod';

const teachingQualityVerdictItemSchema = z
  .object({
    index: z.number().int().min(0),
    acceptable: z.boolean(),
    issues: z
      .array(z.enum(['incorrect', 'unnatural', 'unsupported', 'infeasible', 'level', 'uncertain']))
      .max(6),
    feedback: z.array(z.string().trim().min(1).max(300)).max(7),
  })
  .strict();

export const teachingQualityVerdictSchema = z
  .object({
    items: z
      .array(teachingQualityVerdictItemSchema.extend({ index: z.number().int().min(0).max(4) }))
      .min(1)
      .max(5),
  })
  .strict();

export const MAX_TEACHING_REVIEW_ITEMS = 50;

/** Separate global indices for bounded nonintro review batches. */
export const teachingQualityAggregateVerdictSchema = z
  .object({
    items: z
      .array(
        teachingQualityVerdictItemSchema.extend({
          index: z
            .number()
            .int()
            .min(0)
            .max(MAX_TEACHING_REVIEW_ITEMS - 1),
        })
      )
      .min(1)
      .max(MAX_TEACHING_REVIEW_ITEMS),
  })
  .strict()
  .superRefine(({ items }, context) => {
    if (
      new Set(items.map(({ index }) => index)).size !== items.length ||
      items.some(({ index }) => index >= items.length)
    )
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Teaching evidence must cover each item once.',
      });
  });

/** Aggregated intro evidence may contain up to 19 addresses after bounded batches. */
export const introTeachingQualityVerdictSchema = z
  .object({
    items: z
      .array(teachingQualityVerdictItemSchema.extend({ index: z.number().int().min(0).max(18) }))
      .min(1)
      .max(19),
  })
  .strict()
  .superRefine(({ items }, context) => {
    if (
      new Set(items.map(({ index }) => index)).size !== items.length ||
      items.some(({ index }) => index >= items.length)
    )
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Intro review evidence must cover each address once.',
      });
  });

const MAX_CANDIDATE_BYTES = 32 * 1024;
const reviewEvidenceSchema = z
  .object({
    candidate: z
      .string()
      .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_CANDIDATE_BYTES)
      .nullable(),
    omitted: z.literal('size_limit').optional(),
    verdict: z.union([teachingQualityAggregateVerdictSchema, introTeachingQualityVerdictSchema]),
  })
  .strict()
  .refine((review) => (review.candidate === null) === (review.omitted === 'size_limit'));

export const teachingFailureSchema = z
  .object({
    kind: z.enum(['intro', 'explanations', 'writing', 'listening', 'speaking', 'vocabulary']),
    reviews: z.array(reviewEvidenceSchema).min(1).max(2),
  })
  .strict()
  .superRefine((failure, context) => {
    const schema =
      failure.kind === 'intro'
        ? introTeachingQualityVerdictSchema
        : teachingQualityAggregateVerdictSchema;
    failure.reviews.forEach((review, index) => {
      if (!schema.safeParse(review.verdict).success)
        context.addIssue({
          code: 'custom',
          path: ['reviews', index, 'verdict'],
          message: 'Teaching review evidence does not match its content kind.',
        });
    });
  });

export type TeachingFailure = z.infer<typeof teachingFailureSchema>;

const retainedFailures = new WeakMap<object, TeachingFailure>();

export function retainTeachingFailure(error: unknown, failure: TeachingFailure | undefined): void {
  if (!failure || ((typeof error !== 'object' || error === null) && typeof error !== 'function'))
    return;
  if (retainedFailures.has(error)) return;
  const parsed = teachingFailureSchema.safeParse(failure);
  if (parsed.success) retainedFailures.set(error, parsed.data);
}

export function retainedTeachingFailure(error: unknown): TeachingFailure | undefined {
  if ((typeof error !== 'object' || error === null) && typeof error !== 'function')
    return undefined;
  const failure = retainedFailures.get(error);
  return failure ? structuredClone(failure) : undefined;
}

/** Private normalized output only. Prompts and provider credentials are never captured. */
export function captureTeachingFailure(
  kind: TeachingFailure['kind'],
  items: readonly unknown[],
  verdict:
    z.infer<typeof teachingQualityVerdictSchema> | z.infer<typeof introTeachingQualityVerdictSchema>
): TeachingFailure {
  const checkedVerdict =
    kind === 'intro'
      ? introTeachingQualityVerdictSchema.parse(verdict)
      : teachingQualityAggregateVerdictSchema.parse(verdict);
  const candidate = JSON.stringify(items);
  const review =
    Buffer.byteLength(candidate, 'utf8') <= MAX_CANDIDATE_BYTES
      ? { candidate, verdict: checkedVerdict }
      : { candidate: null, omitted: 'size_limit' as const, verdict: checkedVerdict };
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
