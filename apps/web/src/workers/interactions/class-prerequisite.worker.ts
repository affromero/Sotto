import type { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { readSottoWorkerJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  sottoJobExecutions,
  withSottoJobExecution,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { isDurableQueueCleanupFailure } from '@/lib/sidedoor/jobs/core/durable-queue';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import { prerequisiteWorkSchema } from '@/lib/classes/help/lifecycle/prerequisite-admission';
import { generatePrerequisiteAddendum } from '@/lib/classes/help/content/prerequisite-generation';
import { PrerequisiteDisclosureError } from '@/lib/classes/help/content/prerequisite-source';
import {
  failPrerequisiteWork,
  publishPrerequisiteOutcome,
  readPrerequisiteWorkStatus,
  recoverPrerequisiteOutcome,
  requirePendingPrerequisiteWork,
  startPrerequisiteWork,
} from '@/lib/classes/help/prerequisite-outcome';

export async function processClassPrerequisite(job: Job<unknown>, signal?: AbortSignal) {
  signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(40 * 60_000)]);
  const contract = { handler: 'interactions', version: 5, payload: prerequisiteWorkSchema };
  const work = await sottoTransaction(
    prisma,
    (database) => readSottoWorkerJob(database, job, contract),
    { signal }
  );
  if (work.complete) return;
  const identity = { id: work.operationId, fingerprint: work.fingerprint };
  if (await sottoTransaction(prisma, (database) => recoverPrerequisiteOutcome(database, identity)))
    return;
  const { fence } = work.payload;
  const binding = {
    classId: fence.classId,
    userId: fence.userId,
    sourceHash: fence.sourceHash,
    hash: fence.snapshotHash,
    ownership: fence.ownership,
  };
  let entered = false;
  let unknown = false;
  try {
    await withSottoJobExecution({
      database: prisma,
      parentId: identity.id,
      fingerprint: identity.fingerprint,
      signal,
      isCleanupFailure: (error) => unknown || isDurableQueueCleanupFailure(error),
      validate: async (database) => {
        const current = await readSottoWorkerJob(database, job, contract);
        if (current.complete) return false;
        await requirePendingPrerequisiteWork(database, identity, 'QUEUED');
        return true;
      },
      run: async ({ directory, markCleanupUnconfirmed }) => {
        entered = true;
        await sottoTransaction(prisma, (database) => startPrerequisiteWork(database, identity), {
          signal,
        });
        await job.updateProgress(10);
        const authorize = async (
          database: Parameters<typeof requirePendingPrerequisiteWork>[0]
        ) => {
          await requirePendingPrerequisiteWork(database, identity, 'RUNNING');
          return { userId: fence.userId };
        };
        const execution = {
          userId: fence.userId,
          signal,
          learningSelection: fence.selection,
          isolatedWorkspace: { directory, markCleanupUnconfirmed },
          onCleanupError: markCleanupUnconfirmed,
          authorize,
          providerRequest: learningPreparationProviderRequest(
            {
              selection: fence.selection,
              admit: async (database, request) => {
                await authorize(database);
                return learningPreparationGrant(database, fence, 'prerequisite').admit(
                  fence.grant,
                  request
                );
              },
              settle: (database, request, outcome) =>
                learningPreparationGrant(database, fence, 'prerequisite').settle(
                  fence.grant,
                  request,
                  outcome
                ),
            },
            signal,
            () => {
              unknown = true;
              markCleanupUnconfirmed();
            }
          ),
        };
        const content = await generatePrerequisiteAddendum(binding, execution);
        await sottoTransaction(
          prisma,
          (database) => publishPrerequisiteOutcome(database, identity, execution, content),
          { signal }
        );
      },
    });
    await sottoTransaction(prisma, async (database) => {
      if (!(await recoverPrerequisiteOutcome(database, identity)))
        throw new Error('The prerequisite result is unavailable.');
    });
    await job.updateProgress(100);
  } catch (error) {
    await sottoTransaction(prisma, async (database) => {
      const status = await readPrerequisiteWorkStatus(database, identity);
      if (status === 'COMPLETED') return;
      if (entered && (status === 'QUEUED' || status === 'RUNNING')) {
        await failPrerequisiteWork(
          database,
          identity,
          unknown,
          error instanceof PrerequisiteDisclosureError ? 'UNSAFE' : 'FAILED'
        );
        return;
      }
      if (
        !entered &&
        status === 'QUEUED' &&
        !(await sottoJobExecutions(database).blockingStatus(identity.id, identity.fingerprint))
      )
        await failPrerequisiteWork(database, identity, false);
    });
    throw new Error('Prerequisite teaching could not be prepared.', { cause: error });
  }
}
