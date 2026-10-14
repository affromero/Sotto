import type { Job } from 'bullmq';
import { createHash } from 'node:crypto';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { readSottoWorkerJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  withSottoJobExecution,
  sottoJobExecutions,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { isDurableQueueCleanupFailure } from '@/lib/sidedoor/jobs/core/durable-queue';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import { interpretPencilHomework } from '@/lib/learning/pencil/homework-vision';
import {
  pencilHomeworkWorkSchema,
  readPencilOutcome,
  requirePencilWork,
  retainPencilOutcome,
} from '@/lib/learning/pencil/homework-work';

export async function processPencilHomework(
  job: Job<unknown>,
  signal = AbortSignal.timeout(600_000)
) {
  const contract = { handler: 'pencil-homework', version: 1, payload: pencilHomeworkWorkSchema };
  const work = await sottoTransaction(
    prisma,
    async (database) => {
      const durable = await readSottoWorkerJob(database, job, contract);
      if (!durable.complete)
        await requirePencilWork(database, durable.payload.classId, durable.payload, durable.scopes);
      return durable;
    },
    { signal }
  );
  if (work.complete) return;
  const operation = {
    id: work.operationId,
    courseId: work.payload.courseId,
    userId: work.payload.userId,
  };
  const attempt = {
    id: work.operationId,
    fingerprint: createHash('sha256').update(JSON.stringify(work.payload)).digest('hex'),
  };
  let unknown = false;
  let dispatched = false;
  const validate = async (database: Parameters<typeof requirePencilWork>[0]) => {
    await requirePencilWork(database, work.payload.classId, work.payload, work.scopes);
  };
  try {
    await withSottoJobExecution({
      database: prisma,
      parentId: work.operationId,
      fingerprint: work.fingerprint,
      signal,
      isCleanupFailure: (error) => unknown || isDurableQueueCleanupFailure(error),
      validate: async (database) => {
        const current = await readSottoWorkerJob(database, job, contract);
        if (current.complete) return false;
        await validate(database);
        if (await readPencilOutcome(database, work.operationId, work.fingerprint))
          throw new Error(
            'A previous interpretation outcome is retained. It will not be replayed.'
          );
        return true;
      },
      run: async ({ directory, markCleanupUnconfirmed }) => {
        const admitted = await sottoTransaction(
          prisma,
          async (database) => {
            await validate(database);
            return learningPreparationGrant(database, operation, 'pencil').admit(
              work.payload.grant,
              attempt
            );
          },
          { signal }
        );
        if (!admitted.dispatch)
          throw new Error(
            'The saved interpretation was already dispatched. It will not be replayed.'
          );
        dispatched = true;
        await job.updateProgress(10);
        const proposal = await interpretPencilHomework(work.payload.task, work.payload.image, {
          userId: work.payload.userId,
          signal,
          learningSelection: work.payload.selection,
          isolatedWorkspace: { directory, markCleanupUnconfirmed },
          onCleanupError: markCleanupUnconfirmed,
          authorize: async (database) => {
            await validate(database);
            return { userId: work.payload.userId };
          },
          providerRequest: learningPreparationProviderRequest(
            {
              selection: work.payload.selection,
              admit: async (database, request) => {
                await validate(database);
                return learningPreparationGrant(database, operation, 'pencil').admit(
                  work.payload.grant,
                  request
                );
              },
              settle: (database, request, outcome) =>
                learningPreparationGrant(database, operation, 'pencil').settle(
                  work.payload.grant,
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
        });
        await sottoTransaction(
          prisma,
          async (database) => {
            await validate(database);
            await learningPreparationGrant(database, operation, 'pencil').settle(
              work.payload.grant,
              attempt,
              'succeeded'
            );
            await learningPreparationGrant(database, operation, 'pencil').complete(
              work.payload.grant
            );
            await retainPencilOutcome(database, work.operationId, work.fingerprint, {
              status: 'READY',
              proposal,
            });
          },
          { signal }
        );
        dispatched = false;
      },
    });
    await sottoTransaction(prisma, async (database) => {
      await validate(database);
      await sottoJobExecutions(database).requireParentDrained(work.operationId, work.fingerprint);
      await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
    });
    await job.updateProgress(100);
  } catch (failure) {
    await sottoTransaction(prisma, async (database) => {
      await validate(database);
      const record = await sottoJobOutbox(database).read(work.operationId);
      if (record?.complete) return;
      const grant = learningPreparationGrant(database, operation, 'pencil');
      const retained = await readPencilOutcome(database, work.operationId, work.fingerprint);
      if (!retained) {
        if (dispatched) await grant.settle(work.payload.grant, attempt, 'unknown');
        await grant.revoke(work.payload.grant);
      }
      const blocked = await sottoJobExecutions(database).blockingStatus(
        work.operationId,
        work.fingerprint
      );
      if (!retained)
        await retainPencilOutcome(database, work.operationId, work.fingerprint, {
          status: 'FAILED',
          error:
            unknown || blocked
              ? 'The interpretation has an unconfirmed outcome. It will not be replayed. Your ink is saved.'
              : 'Your marks could not be interpreted. ' +
                (failure instanceof Error
                  ? failure.message.slice(0, 500)
                  : 'Check the server configuration.'),
        });
      if (!blocked && !unknown)
        await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
    });
    throw failure;
  }
}
