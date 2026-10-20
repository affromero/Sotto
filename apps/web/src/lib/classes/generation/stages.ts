import { logger } from '../../logger';
import { isDurableQueueCleanupFailure } from '../../sidedoor/jobs/core/durable-queue';
import { retainParallelGenerationFailures } from '../quality/generation-failure';

type Stage = 'grammar' | 'reading' | 'listening' | 'writing';

/** Admit at most two branches and drain admitted work before returning authority. */
export async function runClassGenerationStages(
  tasks: readonly { stage: Stage; run: () => Promise<void> }[],
  context: {
    classId: string;
    attempt: number;
    signal?: AbortSignal;
    onCleanupError?: (error: unknown) => void;
  }
): Promise<void> {
  context.signal?.throwIfAborted();
  const failures: Array<{ stage: Stage; error: unknown }> = [];
  let next = 0;
  async function worker() {
    while (next < tasks.length && failures.length === 0 && !context.signal?.aborted) {
      const task = tasks[next++]!;
      const started = performance.now();
      let outcome = 'succeeded';
      try {
        await task.run();
      } catch (error) {
        outcome = 'failed';
        failures.push({ stage: task.stage, error });
      } finally {
        logger.info('Class generation stage completed', {
          classId: context.classId,
          attempt: context.attempt,
          stage: task.stage,
          durationMs: Math.round(performance.now() - started),
          outcome,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, tasks.length) }, () => worker()));
  if (failures.length) {
    const cleanup = failures.find(({ error }) => isDurableQueueCleanupFailure(error));
    if (cleanup) context.onCleanupError?.(cleanup.error);
    const first = failures[0]!.error;
    retainParallelGenerationFailures(first, failures, Boolean(cleanup));
    throw first;
  }
  context.signal?.throwIfAborted();
}
