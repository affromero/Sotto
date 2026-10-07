import { isDurableQueueCleanupFailure } from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  captureGenerationFailure,
  generationFailureSchema,
  retainParallelGenerationFailures,
} from '@/lib/classes/quality/generation-failure';

/** Inspect every settled branch before the caller propagates its original first failure. */
export function recordFullPracticeFailures(
  results: readonly PromiseSettledResult<unknown>[],
  onCleanupError?: (error: unknown) => void
) {
  if (results.length !== 4)
    throw new Error('Full practice requires four settled generation branches.');
  const stages = ['grammar', 'reading', 'listening', 'writing'] as const;
  const failures = results.flatMap((result, index) =>
    result.status === 'rejected' ? [{ stage: stages[index]!, error: result.reason as unknown }] : []
  );
  if (!failures.length) return undefined;
  const cleanupFailure = failures.find((failure) => isDurableQueueCleanupFailure(failure.error));
  if (cleanupFailure) onCleanupError?.(cleanupFailure.error);
  retainParallelGenerationFailures(failures[0]!.error, failures, Boolean(cleanupFailure));
  return generationFailureSchema.parse({
    ...captureGenerationFailure(failures[0]!.error),
    stages: failures.map((failure) => {
      const detail = captureGenerationFailure(failure.error);
      return {
        stage: failure.stage,
        category: detail.category,
        ...(detail.teachingFailure ? { teachingFailure: detail.teachingFailure } : {}),
        ...(detail.attemptFailures ? { attemptFailures: detail.attemptFailures } : {}),
      };
    }),
  });
}
