import type { Job, Queue } from 'bullmq';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { ProcessInteractionPayload } from '@/lib/queue';
import {
  completeDurableQueueJob,
  bindDurableQueueJob,
  durableJobProviderExecution,
  durableQueueJobIdentity,
  durableQueueOperationId,
  isDurableQueueCleanupFailure,
  loadDurableQueueJob,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { readInteractionEpisode } from '@/lib/sidedoor/jobs/interaction-access';
import {
  sottoJobExecutions,
  withSottoJobExecution,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoStateWriteTransaction } from '@/lib/sidedoor/access/state/write-transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';

/** Settle an answer saved by the worker before completion became atomic. */
export async function completePublishedInteraction(
  database: Prisma.TransactionClient,
  job: Job<ProcessInteractionPayload>,
  signal?: AbortSignal
): Promise<boolean> {
  const { episodeId, interactionId, userId, question, timestamp } = job.data;
  if (
    durableQueueJobIdentity(job).operationId !==
    durableQueueOperationId('interactions', `interaction-${interactionId}`)
  )
    return false;
  const actor = await durableJobProviderExecution(job, userId, signal).authorize(database);
  if (actor.userId !== userId) return false;
  const episode = await readInteractionEpisode(database, episodeId);
  if (episode.userId !== userId && episode.visibility !== 'UNLISTED') return false;
  await database.$queryRaw`SELECT id FROM "Interaction" WHERE id = ${interactionId} FOR UPDATE`;
  const current = await database.interaction.findUnique({
    where: { id: interactionId, episodeId },
    select: { userId: true, question: true, timestamp: true, status: true, answer: true },
  });
  if (
    !current ||
    current.userId !== userId ||
    current.question !== question ||
    current.timestamp !== timestamp ||
    current.answer === null ||
    !['ANSWERED', 'RESOLVED', 'INCORPORATING', 'INCORPORATED'].includes(current.status)
  )
    return false;
  await completeDurableQueueJob(database, job);
  return true;
}

/** Reconcile a terminal queue record only after its prior execution is drained. */
export async function reconcilePublishedInteraction(input: {
  database: PrismaClient;
  queue: Queue;
  operationId: string;
  fingerprint: string;
  state: 'failed' | 'completed';
  signal: AbortSignal;
}): Promise<'complete' | 'erased' | null> {
  if (input.queue.name !== 'interactions') return null;
  const queued = await input.queue.getJob(input.operationId);
  if (!queued || (await queued.getState()) !== input.state) return null;
  const load = (database: Prisma.TransactionClient) =>
    loadDurableQueueJob<ProcessInteractionPayload>(database, queued, 'interactions', 1);
  const work = await sottoTransaction(input.database, load, { signal: input.signal });
  if (work.complete) return 'erased' in work && work.erased ? 'erased' : 'complete';
  if (work.operationId !== input.operationId || work.fingerprint !== input.fingerprint) return null;
  const outcome = await withSottoJobExecution({
    database: input.database,
    parentId: input.operationId,
    fingerprint: input.fingerprint,
    signal: input.signal,
    isCleanupFailure: isDurableQueueCleanupFailure,
    validate: async (database) => {
      const current = await load(database);
      return (
        !current.complete &&
        current.operationId === input.operationId &&
        current.fingerprint === input.fingerprint &&
        !(await sottoJobExecutions(database).blockingStatus(input.operationId, input.fingerprint))
      );
    },
    run: async () => {
      if ((await queued.getState()) !== input.state) return null;
      return sottoStateWriteTransaction(
        input.database,
        async (database) => {
          const current = await load(database);
          if (current.complete)
            return 'erased' in current && current.erased ? 'erased' : 'complete';
          if (
            current.operationId !== input.operationId ||
            current.fingerprint !== input.fingerprint
          )
            return null;
          return (await completePublishedInteraction(
            database,
            bindDurableQueueJob(queued, current.payload.payload, current),
            input.signal
          ))
            ? 'complete'
            : null;
        },
        input.signal
      );
    },
  });
  if (outcome) return outcome;
  return sottoTransaction(
    input.database,
    async (database) => {
      const receipt = await sottoJobOutbox(database).receipt(input.operationId);
      if (!receipt || receipt.fingerprint !== input.fingerprint) return null;
      return receipt.status === 'complete' || receipt.status === 'erased' ? receipt.status : null;
    },
    { signal: input.signal }
  );
}
