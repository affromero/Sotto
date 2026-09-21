import type { Queue } from 'bullmq';
import { reconcileOutboxPage, type JobDeliveryResult } from 'thesidedoor-core/runtime/outbox';
import { runTaskLoop } from 'thesidedoor-core/runtime/task-loop';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  deliverSottoJob,
  sottoJobOutbox,
  SottoTerminalDeliveryError,
} from '@/lib/sidedoor/jobs/core/job-delivery';
import { completeInitialStitchFailure } from '@/lib/sidedoor/jobs/initial/initial-stitch-failure';
import {
  requireSottoJobVersion,
  SottoJobContractError,
} from '@/lib/sidedoor/jobs/core/job-contracts';
import { sidedoorStateStore, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

interface ReconciliationOptions {
  database: PrismaClient;
  queues: ReadonlyMap<string, Queue>;
  signal: AbortSignal;
  cursor: string | null;
  withQueue?: <Result>(
    name: string,
    signal: AbortSignal,
    operation: (queue: Queue) => Promise<Result>
  ) => Promise<Result>;
}

/** Database admission and listing finish before any Redis operation begins. */
export async function reconcileSottoJobs(options: ReconciliationOptions) {
  const { database, queues, signal } = options;
  return reconcileOutboxPage({
    cursor: options.cursor,
    signal,
    listIncomplete: (cursor) =>
      sottoTransaction(
        database,
        async (tx) => {
          await sidedoorStateStore(tx).read();
          await sottoStorageInstance(tx).read();
          return sottoJobOutbox(tx).listIncomplete(cursor);
        },
        { signal }
      ),
    deliver: async (reference) => {
      const receipt = await sottoTransaction(
        database,
        (tx) => sottoJobOutbox(tx).receipt(reference.id),
        { signal }
      );
      if (!receipt || receipt.fingerprint !== reference.fingerprint)
        throw new SottoJobContractError(
          'index_conflict',
          'Durable job index does not match its receipt'
        );
      if (receipt.status !== 'pending') return receipt.status;
      requireSottoJobVersion(receipt.handler, receipt.version);
      const queue = queues.get(receipt.handler);
      if (!queue || queue.name !== receipt.handler)
        throw new SottoJobContractError('queue_unavailable', 'Durable job queue is unavailable');
      signal.throwIfAborted();
      const deliver = (target: Queue) =>
        deliverSottoJob({
          database,
          queue: target,
          operationId: reference.id,
          fingerprint: reference.fingerprint,
          version: receipt.version,
        });
      try {
        return await (options.withQueue
          ? options.withQueue(receipt.handler, signal, deliver)
          : deliver(queue));
      } catch (error) {
        if (
          !(error instanceof SottoTerminalDeliveryError) ||
          error.observation.state !== 'failed' ||
          error.observation.handler !== 'audio-stitching' ||
          error.observation.version !== 2
        )
          throw error;
        const settled = await sottoTransaction(
          database,
          (tx) => completeInitialStitchFailure(tx, error.observation, signal),
          { signal }
        );
        return settled.kind === 'erased' ? 'erased' : 'complete';
      }
    },
  });
}

/** Callers observe done and await stop before closing queues or database connections. */
export function startSottoJobReconciliation(options: {
  database: PrismaClient;
  queues: ReadonlyMap<string, Queue>;
  withQueue: NonNullable<ReconciliationOptions['withQueue']>;
  onResults: (results: readonly JobDeliveryResult[]) => void;
  onError: (error: unknown) => undefined;
}) {
  const controller = new AbortController();
  let cursor: string | null = null;
  const done = runTaskLoop({
    signal: controller.signal,
    intervalMs: 1_000,
    onError: options.onError,
    task: async (signal) => {
      const page = await reconcileSottoJobs({ ...options, signal, cursor });
      cursor = page.cursor;
      options.onResults(page.results);
    },
  });
  return {
    done,
    stop: async () => {
      controller.abort();
      await done;
    },
  };
}
