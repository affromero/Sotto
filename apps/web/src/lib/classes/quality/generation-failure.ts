import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { SectionQualityError } from '../section-quality';
import { ReviewerProtocolError, TeachingQualityRejectionError } from './teaching-quality';
import { teachingFailureSchema } from './teaching-failure';

const generationFailureCategorySchema = z.enum([
  'teaching_rejected',
  'review_protocol',
  'section_quality',
  'database_conflict',
  'generation_failed',
]);

export type GenerationFailureCategory = z.infer<typeof generationFailureCategorySchema>;

const failureDetailSchema = z
  .object({
    category: generationFailureCategorySchema,
    teachingFailure: teachingFailureSchema.optional(),
  })
  .strict();
const stageFailureSchema = failureDetailSchema.extend({
  stage: z.enum(['grammar', 'reading', 'listening', 'writing']),
});
export const generationFailureSchema = failureDetailSchema.extend({
  stages: z
    .array(stageFailureSchema)
    .min(1)
    .max(4)
    .refine((stages) => new Set(stages.map(({ stage }) => stage)).size === stages.length)
    .optional(),
});
export type GenerationFailure = z.infer<typeof generationFailureSchema>;
const parallelFailures = new WeakMap<
  object,
  { stages: z.infer<typeof stageFailureSchema>[]; cleanupUnconfirmed: boolean }
>();

function captureFailureDetail(error: unknown): z.infer<typeof failureDetailSchema> {
  return failureDetailSchema.parse({
    category: classifyGenerationFailure(error),
    ...(error instanceof TeachingQualityRejectionError && error.teachingFailure
      ? { teachingFailure: error.teachingFailure }
      : {}),
  });
}

/** Retain settled child failures while preserving the original thrown error and cleanup identity. */
export function retainParallelGenerationFailures(
  error: unknown,
  failures: readonly {
    stage: z.infer<typeof stageFailureSchema>['stage'];
    error: unknown;
  }[],
  cleanupUnconfirmed: boolean
): void {
  if ((typeof error !== 'object' || error === null) && typeof error !== 'function') return;
  const stages = generationFailureSchema.parse({
    ...captureFailureDetail(error),
    stages: failures.map((failure) => ({
      stage: failure.stage,
      ...captureFailureDetail(failure.error),
    })),
  }).stages;
  if (stages) parallelFailures.set(error, { stages, cleanupUnconfirmed });
}

export function generationCleanupUnconfirmed(error: unknown): boolean {
  if ((typeof error !== 'object' || error === null) && typeof error !== 'function') return false;
  return parallelFailures.get(error)?.cleanupUnconfirmed === true;
}

export function captureGenerationFailure(error: unknown): GenerationFailure {
  const stages =
    (typeof error === 'object' && error !== null) || typeof error === 'function'
      ? parallelFailures.get(error)?.stages
      : undefined;
  return generationFailureSchema.parse({
    ...captureFailureDetail(error),
    ...(stages ? { stages } : {}),
  });
}

/** Classify trusted terminal errors without retaining provider messages or transport bodies. */
export function classifyGenerationFailure(error: unknown): GenerationFailureCategory {
  if (error instanceof TeachingQualityRejectionError) return 'teaching_rejected';
  if (error instanceof ReviewerProtocolError) return 'review_protocol';
  if (error instanceof SectionQualityError) return 'section_quality';
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' ||
      (error.code === 'P2010' && (error.meta?.code === '40001' || error.meta?.code === '40P01')))
  )
    return 'database_conflict';
  return 'generation_failed';
}
