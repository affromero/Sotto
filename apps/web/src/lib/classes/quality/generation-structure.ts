import { z } from 'zod';
import { teachingFailureSchema } from './teaching-failure';

const MAX_CANDIDATE_BYTES = 32 * 1024;
const structureIssueSchema = z
  .object({
    code: z.enum([
      'invalid_json',
      'invalid_container',
      'wrong_count',
      'invalid_item',
      'script_vocabulary_duplicate_number',
      'script_vocabulary_ambiguous_identity',
      'script_vocabulary_missing_identity',
    ]),
    index: z.number().int().min(0).max(4).optional(),
  })
  .strict();

const structureAttemptSchema = z
  .object({
    attempt: z.union([z.literal(1), z.literal(2)]),
    type: z.literal('structure'),
    kind: z.enum(['speaking', 'writing', 'listening']),
    candidate: z
      .string()
      .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_CANDIDATE_BYTES)
      .nullable(),
    omitted: z.literal('size_limit').optional(),
    issues: z.array(structureIssueSchema).min(1).max(20),
  })
  .strict()
  .refine((value) => (value.candidate === null) === (value.omitted === 'size_limit'));

const teachingAttemptSchema = z
  .object({
    attempt: z.union([z.literal(1), z.literal(2)]),
    type: z.literal('teaching'),
    failure: teachingFailureSchema,
  })
  .strict();

const generationAttemptFailureSchema = z.discriminatedUnion('type', [
  structureAttemptSchema,
  teachingAttemptSchema,
]);

export const generationAttemptFailuresSchema = z
  .array(generationAttemptFailureSchema)
  .min(1)
  .max(2)
  .refine((attempts) => {
    const numbers = attempts.map(({ attempt }) => attempt);
    return (
      new Set(numbers).size === numbers.length &&
      numbers.every((n, i) => i === 0 || n > numbers[i - 1]!)
    );
  });

export type GenerationStructureIssue = z.infer<typeof structureIssueSchema>;
export type GenerationAttemptFailure = z.infer<typeof generationAttemptFailureSchema>;

const attemptFailuresByError = new WeakMap<object, GenerationAttemptFailure[]>();

/** Attach bounded actual attempt evidence without changing the thrown error or serializing it. */
export function recordGenerationAttemptFailures(
  error: object,
  failures: readonly GenerationAttemptFailure[]
): void {
  attemptFailuresByError.set(error, generationAttemptFailuresSchema.parse(failures));
}

export function generationAttemptFailures(error: unknown): GenerationAttemptFailure[] | undefined {
  if ((typeof error !== 'object' || error === null) && typeof error !== 'function')
    return undefined;
  const failures = attemptFailuresByError.get(error);
  return failures ? generationAttemptFailuresSchema.parse(failures) : undefined;
}

export function captureStructureAttempt(
  kind: 'speaking' | 'writing' | 'listening',
  attempt: 1 | 2,
  candidate: string | null,
  issues: readonly GenerationStructureIssue[]
): GenerationAttemptFailure {
  const bounded =
    candidate !== null && Buffer.byteLength(candidate, 'utf8') <= MAX_CANDIDATE_BYTES
      ? { candidate, issues: [...issues] }
      : { candidate: null, omitted: 'size_limit' as const, issues: [...issues] };
  return structureAttemptSchema.parse({ attempt, type: 'structure', kind, ...bounded });
}

export function captureTeachingAttempt(
  attempt: 1 | 2,
  failure: z.infer<typeof teachingFailureSchema>
): GenerationAttemptFailure {
  return teachingAttemptSchema.parse({ attempt, type: 'teaching', failure });
}
