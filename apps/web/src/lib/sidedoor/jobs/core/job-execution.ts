import { WaitingError, type Job } from 'bullmq';
import { isSottoDurableJob } from '@/lib/sidedoor/jobs/core/job-contracts';

/** Requeue cooperative native cancellation only after the processor has settled cleanup. */
export async function executeSottoJob<Payload>(
  job: Job<Payload>,
  processor: (job: Job<Payload>, signal?: AbortSignal, token?: string) => Promise<unknown>,
  token?: string,
  signal?: AbortSignal
): Promise<unknown> {
  try {
    return await processor(job, signal, token);
  } catch (error) {
    const nativeAbort =
      signal?.aborted &&
      (error === signal.reason ||
        (error instanceof Error && error.name === 'AbortError' && error.cause === signal.reason));
    if (!isSottoDurableJob(job) || !nativeAbort) throw error;
    try {
      if (!token) throw new Error('Cancellation requires the active worker lock token');
      await job.moveToWait(token);
    } catch (transitionError) {
      throw new AggregateError(
        [error, transitionError],
        'Cancelled work could not be returned to the queue',
        { cause: error }
      );
    }
    throw new WaitingError();
  }
}
