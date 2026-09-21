import type { Queue, Job } from 'bullmq';
import { z } from 'zod';
import { JobOutbox, JobSnapshot, type OutboxJob } from 'thesidedoor-core/runtime/outbox';
import { AccessError } from 'thesidedoor-core/access';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

const referenceSchema = z
  .object({
    operationId: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export class SottoTerminalDeliveryError extends Error {
  readonly observation: Readonly<{
    state: 'failed' | 'completed' | 'unknown';
    operationId: string;
    fingerprint: string;
    handler: string;
    version: number;
  }>;
  constructor(observation: SottoTerminalDeliveryError['observation']) {
    super(`Queue job is ${observation.state} without a durable completion receipt`);
    this.name = 'SottoTerminalDeliveryError';
    this.observation = Object.freeze({ ...observation });
  }
}

function validateQueueJob(record: OutboxJob, existing: Job) {
  const parsed = referenceSchema.safeParse(existing.data);
  if (
    existing.id !== record.job.id ||
    existing.queueName !== record.job.handler ||
    existing.name !== `${record.job.handler}.v${record.job.version}` ||
    !parsed.success ||
    parsed.data.operationId !== record.job.id ||
    parsed.data.fingerprint !== record.fingerprint ||
    existing.opts.attempts !== record.job.delivery.attempts ||
    existing.opts.priority !== record.job.delivery.priority ||
    (existing.opts.delay ?? 0) !== Math.max(0, record.job.delivery.availableAt - existing.timestamp)
  )
    throw new Error('Existing queue job conflicts with immutable durable work');
}

/** Read-only evidence for an explicit retry. The failed Redis job remains untouched. */
export async function readFailedSottoDelivery(options: {
  database: PrismaClient;
  queue: Queue;
  operationId: string;
  version: number;
}) {
  const { database, queue, operationId, version } = options;
  const queued = await queue.getJob(operationId);
  if (!queued) throw new AccessError('conflict', 'The failed queue job is missing');
  const record = await sottoTransaction(database, (tx) => sottoJobOutbox(tx).read(operationId));
  if (!record || record.job.handler !== queue.name || record.job.version !== version)
    throw new AccessError('conflict', 'The failed queue job does not match canonical work');
  validateQueueJob(record, queued);
  if ((await queued.getState()) !== 'failed')
    throw new AccessError('conflict', 'Only a failed delivery can be retried');
  return record;
}

export function sottoJobOutbox(database: Prisma.TransactionClient) {
  return new JobOutbox(
    {
      query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    },
    'postgres',
    SIDEDOOR_STATE_ID
  );
}

export function sottoJobSnapshot(database: Prisma.TransactionClient) {
  return new JobSnapshot(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
}

/** Load authoritative work in the same transaction as application admission or completion. */
export async function readSottoWorkerJob<Payload>(
  database: Prisma.TransactionClient,
  queued: { id?: string; name: string; data: unknown },
  contract: { handler: string; version: number; payload: z.ZodType<Payload> }
) {
  const reference = referenceSchema.parse(queued.data);
  if (
    queued.id !== reference.operationId ||
    queued.name !== `${contract.handler}.v${contract.version}`
  )
    throw new Error('Queue job identity does not match the worker contract');
  const outbox = sottoJobOutbox(database);
  const receipt = await outbox.receipt(reference.operationId);
  if (
    !receipt ||
    receipt.fingerprint !== reference.fingerprint ||
    receipt.handler !== contract.handler ||
    receipt.version !== contract.version
  )
    throw new Error('Queue reference does not match durable work');
  if (receipt.status === 'erased') return { complete: true as const, erased: true as const };
  const record = await outbox.read(reference.operationId);
  if (
    !record ||
    record.fingerprint !== reference.fingerprint ||
    record.job.handler !== contract.handler ||
    record.job.version !== contract.version
  )
    throw new Error('Queue reference does not match durable work');
  if (record.complete) return { complete: true as const };
  return {
    complete: false as const,
    operationId: record.job.id,
    fingerprint: record.fingerprint,
    scopes: record.job.scopes,
    payload: contract.payload.parse(record.job.payload),
  };
}

/**
 * The durable handler is the exact queue name; version identifies its payload contract.
 * Queue data contains only a reference. Workers must load and validate the database job.
 * Redis acceptance never means application completion, and failed jobs need explicit recovery.
 */
export async function deliverSottoJob(options: {
  database: PrismaClient;
  queue: Queue;
  operationId: string;
  version: number;
  fingerprint?: string;
}): Promise<'delivered' | 'complete' | 'erased'> {
  const { database, queue, operationId, version } = options;
  async function inspect(tx: Prisma.TransactionClient, fingerprint?: string) {
    const outbox = sottoJobOutbox(tx);
    const receipt = await outbox.receipt(operationId);
    if (!receipt) throw new Error('Durable job is missing');
    if (receipt.handler !== queue.name || receipt.version !== version)
      throw new Error('Durable job queue or version does not match this worker');
    if (fingerprint !== undefined && receipt.fingerprint !== fingerprint)
      throw new Error('Durable job identity changed during delivery');
    if (receipt.status !== 'pending') return { status: receipt.status };
    const record = await outbox.read(operationId);
    if (!record || record.fingerprint !== receipt.fingerprint)
      throw new Error('Durable job payload does not match its receipt');
    return { status: 'pending' as const, record };
  }
  const read = (fingerprint?: string) =>
    sottoTransaction(database, (tx) => inspect(tx, fingerprint));
  const initial = await read(options.fingerprint);
  if (initial.status !== 'pending') return initial.status;
  const record = initial.record;
  const reference = { operationId, fingerprint: record.fingerprint };
  const name = `${record.job.handler}.v${record.job.version}`;
  let existing = await queue.getJob(operationId);
  if (!existing) {
    const now = Date.now();
    await queue.add(name, reference, {
      jobId: operationId,
      attempts: record.job.delivery.attempts,
      priority: record.job.delivery.priority,
      timestamp: now,
      delay: Math.max(0, record.job.delivery.availableAt - now),
    });
    // Another dispatcher may have inserted this ID. Verify what Redis actually retained.
    existing = await queue.getJob(operationId);
  }
  if (!existing) {
    const current = await read(record.fingerprint);
    if (current.status !== 'pending') return current.status;
    throw new Error('Accepted queue job disappeared before delivery verification');
  }
  validateQueueJob(record, existing);
  const state = await existing.getState();
  if (state === 'failed' || state === 'completed' || state === 'unknown') {
    const current = await read(record.fingerprint);
    if (current.status !== 'pending') return current.status;
    throw new SottoTerminalDeliveryError({
      state,
      operationId,
      fingerprint: record.fingerprint,
      handler: record.job.handler,
      version: record.job.version,
    });
  }
  return sottoTransaction(database, async (tx) => {
    const current = await inspect(tx, record.fingerprint);
    if (current.status !== 'pending') return current.status;
    await sottoJobOutbox(tx).acknowledgeDelivery(operationId, record.fingerprint);
    return 'delivered';
  });
}
