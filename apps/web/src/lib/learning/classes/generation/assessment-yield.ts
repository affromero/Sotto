import { DelayedError, type Job } from 'bullmq';
import type { PrismaClient } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { readSottoWorkerJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { assessmentWorkSchema, AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { requireAssessmentExecutionAdmission } from './assessment-work';
import { verifyAssessmentAudioJobsDrained } from '../audio/assessment-audio-drain';

const failedTransitions = new WeakMap<
  Error,
  { identity: { id: string; fingerprint: string }; authority: object | undefined }
>();

/** Only this module can create evidence that the queue transition failed. */
export function assessmentYieldFailureIdentity(error: unknown) {
  if (!(error instanceof Error)) return null;
  const evidence = failedTransitions.get(error);
  return evidence ? { ...evidence, identity: { ...evidence.identity } } : null;
}

/** Requeue after the parent drains, including when its audio just became ready. */
export async function yieldAssessmentForAudio(input: {
  database: PrismaClient;
  job: Job<unknown>;
  execution: SottoProviderExecution;
  token: string | undefined;
  signal: AbortSignal;
  authority?: object;
}): Promise<never> {
  const admitted = await sottoTransaction(
    input.database,
    async (database) => {
      const work = await readSottoWorkerJob(database, input.job, {
        handler: 'interactions',
        version: 6,
        payload: assessmentWorkSchema,
      });
      if (work.complete) throw new AssessmentFenceConflict();
      const identity = { id: work.operationId, fingerprint: work.fingerprint };
      const pending = await requireAssessmentExecutionAdmission(
        database,
        identity,
        input.execution
      );
      if (pending.current.status !== 'RUNNING') throw new AssessmentFenceConflict();
      if (pending.current.requirements.skills.LISTENING.state !== 'REQUIRED')
        throw new AssessmentFenceConflict();
      const audio = await verifyAssessmentAudioJobsDrained(database, identity, input.execution);
      return { identity, audio };
    },
    { signal: input.signal }
  );
  input.signal.throwIfAborted();
  try {
    if (!input.token) throw new AssessmentFenceConflict();
    await input.job.moveToDelayed(
      Date.now() + (admitted.audio.status === 'WAITING' ? 5000 : 0),
      input.token
    );
  } catch (error) {
    const failure = new Error('Assessment delivery could not be delayed', { cause: error });
    failedTransitions.set(failure, { identity: admitted.identity, authority: input.authority });
    throw failure;
  }
  throw new DelayedError();
}
