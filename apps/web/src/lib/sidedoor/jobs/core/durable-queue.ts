import { createHash, randomUUID } from 'node:crypto';
import type { Job, Queue } from 'bullmq';
import { z } from 'zod';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import {
  captureEpisodeStorage,
  validateEpisodeStorage,
} from '@/lib/sidedoor/storage/core/episode-storage';
import {
  deliverSottoJob,
  readSottoWorkerJob,
  sottoJobOutbox,
} from '@/lib/sidedoor/jobs/core/job-delivery';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { classifyError, userMessage } from '@/lib/byok-errors';

const authoritySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('episode'),
      episodeId: z.string().min(1),
      ownerUserId: z.string().min(1),
      userId: z.string().min(1),
      pipelineGeneration: z.string().nullable(),
      snapshot: z.json(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('profile'),
      userId: z.string().min(1),
      createdAt: z.number().int().nonnegative(),
      instanceId: z.uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('instance'),
      instanceId: z.uuid(),
    })
    .strict(),
]);

export const durableEnvelopeSchema = z
  .object({
    type: z.string().min(1),
    payload: z.json(),
    authority: authoritySchema,
  })
  .strict();

export type DurableAuthority = z.infer<typeof authoritySchema>;
type DurableEnvelope = z.infer<typeof durableEnvelopeSchema>;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const workByJob = new WeakMap<
  object,
  {
    operationId: string;
    fingerprint: string;
    authority: DurableAuthority;
    markCleanupUnconfirmed?: () => void;
  }
>();

function jsonClone(value: unknown): JsonValue {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Durable queue payload must be JSON serializable');
  return z.json().parse(JSON.parse(encoded)) as JsonValue;
}

export function durableQueueOperationId(queueName: string, jobId?: string): string {
  if (!jobId) return randomUUID();
  const digest = createHash('sha256').update(`${queueName}\0${jobId}`).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

async function captureAuthority(database: Prisma.TransactionClient, payload: unknown) {
  const input =
    payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const episodeId = typeof input.episodeId === 'string' ? input.episodeId : null;
  const requestedUserId = typeof input.userId === 'string' ? input.userId : null;
  if (episodeId) {
    const episode = await database.episode.findUnique({
      where: { id: episodeId },
      select: { pipelineGeneration: true },
    });
    if (!episode) throw new Error('Durable episode work no longer exists');
    const snapshot = await captureEpisodeStorage(
      database,
      episodeId,
      requestedUserId ? [requestedUserId] : []
    );
    const userId = requestedUserId ?? snapshot.userId;
    return {
      authority: {
        kind: 'episode' as const,
        episodeId,
        ownerUserId: snapshot.userId,
        userId,
        pipelineGeneration: episode.pipelineGeneration,
        snapshot: jsonClone(snapshot),
      },
      scopes: snapshot.scopes,
    };
  }
  const instance = await sottoStorageInstance(database).read();
  if (requestedUserId) {
    const profile = await database.user.findUnique({
      where: { id: requestedUserId },
      select: { createdAt: true },
    });
    if (!profile) throw new Error('Durable work recipient no longer exists');
    return {
      authority: {
        kind: 'profile' as const,
        userId: requestedUserId,
        createdAt: profile.createdAt.getTime(),
        instanceId: instance.instanceId,
      },
      scopes: [
        { subjectId: instance.subjectId, generation: instance.generation },
        { subjectId: `profile:${requestedUserId}`, generation: profile.createdAt.getTime() },
      ].sort((left, right) => left.subjectId.localeCompare(right.subjectId)),
    };
  }
  return {
    authority: { kind: 'instance' as const, instanceId: instance.instanceId },
    scopes: [{ subjectId: instance.subjectId, generation: instance.generation }],
  };
}

export async function validateDurableAuthority(
  database: Prisma.TransactionClient,
  authority: DurableAuthority
): Promise<{ userId: string } | null> {
  if (authority.kind === 'episode') {
    const episode = await database.episode.findUnique({
      where: { id: authority.episodeId },
      select: { pipelineGeneration: true },
    });
    if (!episode || episode.pipelineGeneration !== authority.pipelineGeneration)
      throw new Error('Durable episode generation changed');
    const snapshot = authority.snapshot as Awaited<ReturnType<typeof captureEpisodeStorage>>;
    await validateEpisodeStorage(
      database,
      authority.episodeId,
      snapshot,
      authority.userId === authority.ownerUserId ? [] : [authority.userId]
    );
    if (snapshot.userId !== authority.ownerUserId) throw new Error('Durable episode owner changed');
    return { userId: authority.userId };
  }
  const instance = await sottoStorageInstance(database).read();
  if (instance.instanceId !== authority.instanceId)
    throw new Error('Durable work instance changed');
  if (authority.kind === 'instance') return null;
  const profile = await database.user.findUnique({
    where: { id: authority.userId },
    select: { createdAt: true },
  });
  if (!profile || profile.createdAt.getTime() !== authority.createdAt)
    throw new Error('Durable work recipient changed');
  return { userId: authority.userId };
}

/** Authorize a source operation and commit its application claim with outbox admission. */
export async function admitDurableQueueJob<Payload>(options: {
  queue: Queue;
  type: string;
  payload: Payload;
  jobId: string;
  authorize: (database: Prisma.TransactionClient) => Promise<{ userId?: string } | void>;
  mutate: (database: Prisma.TransactionClient, operationId: string) => Promise<void>;
  priority?: number;
  attempts?: number;
  version?: number;
}): Promise<Job<Payload>> {
  const operationId = durableQueueOperationId(options.queue.name, options.jobId);
  const version = options.version ?? (options.queue.name === 'notifications' ? 4 : 1);
  const record = await sottoTransaction(prisma, async (database) => {
    const authorized = await options.authorize(database);
    await options.mutate(database, operationId);
    const captured = await captureAuthority(database, options.payload);
    const recipient = await validateDurableAuthority(database, captured.authority);
    if (authorized?.userId && recipient?.userId !== authorized.userId)
      throw new Error('Durable source recipient differs from its authorization');
    const outbox = sottoJobOutbox(database);
    const existing = await outbox.read(operationId);
    return outbox.enqueue(
      prepareJob({
        id: operationId,
        namespace: SIDEDOOR_STATE_ID,
        handler: options.queue.name,
        version,
        payload: jsonClone({
          type: options.type,
          payload: jsonClone(options.payload),
          authority: captured.authority,
        }),
        scopes: captured.scopes,
        delivery: {
          attempts: options.attempts ?? 3,
          priority: options.priority ?? 0,
          availableAt: existing?.job.delivery.availableAt ?? Date.now(),
        },
      })
    );
  });
  await deliverSottoJob({
    database: prisma,
    queue: options.queue,
    operationId,
    fingerprint: record.fingerprint,
    version,
  });
  const queued = await options.queue.getJob(operationId);
  if (!queued) throw new Error('Durable source delivery disappeared after verification');
  return queued as unknown as Job<Payload>;
}

/**
 * Commit the stage transition, child admission, and parent completion together.
 * Redis delivery starts only after the database transaction commits.
 */
export async function transitionDurableQueueJob<Payload>(options: {
  job: Job<unknown>;
  queue: Queue;
  type: string;
  payload: Payload;
  mutate: (database: Prisma.TransactionClient) => Promise<void>;
  priority?: number;
  attempts?: number;
  jobId: string;
  version?: number;
}): Promise<Job<Payload>> {
  const operationId = durableQueueOperationId(options.queue.name, options.jobId);
  const version = options.version ?? (options.queue.name === 'notifications' ? 4 : 1);
  const record = await sottoTransaction(prisma, async (database) => {
    const parent = workByJob.get(options.job);
    if (!parent) throw new Error('Durable parent binding is missing');
    const parentRecipient = await validateDurableAuthority(database, parent.authority);
    const captured = await captureAuthority(database, options.payload);
    const childRecipient = await validateDurableAuthority(database, captured.authority);
    if (parentRecipient?.userId !== childRecipient?.userId)
      throw new Error('Durable child recipient differs from its parent');
    const outbox = sottoJobOutbox(database);
    const existing = await outbox.read(operationId);
    const prepared = prepareJob({
      id: operationId,
      namespace: SIDEDOOR_STATE_ID,
      handler: options.queue.name,
      version,
      payload: jsonClone({
        type: options.type,
        payload: jsonClone(options.payload),
        authority: captured.authority,
      }),
      scopes: captured.scopes,
      delivery: {
        attempts: options.attempts ?? 3,
        priority: options.priority ?? 0,
        availableAt: existing?.job.delivery.availableAt ?? Date.now(),
      },
    });
    await options.mutate(database);
    const child = await outbox.enqueue(prepared);
    await outbox.complete(parent.operationId, parent.fingerprint);
    return child;
  });
  await deliverSottoJob({
    database: prisma,
    queue: options.queue,
    operationId,
    fingerprint: record.fingerprint,
    version,
  });
  const queued = await options.queue.getJob(operationId);
  if (!queued) throw new Error('Durable child delivery disappeared after verification');
  return queued as unknown as Job<Payload>;
}

interface DurableChild<Payload = unknown> {
  queue: Queue;
  type: string;
  payload: Payload;
  jobId: string;
  priority?: number;
  attempts?: number;
  version?: number;
}

/** Commit a mutation, any number of child admissions, and optional parent completion together. */
export async function admitDurableQueueBatch(options: {
  parentJob?: Job<unknown>;
  authorize?: (database: Prisma.TransactionClient) => Promise<{ userId?: string } | void>;
  prepare: (database: Prisma.TransactionClient) => Promise<readonly DurableChild[]>;
}): Promise<void> {
  const admitted = await sottoTransaction(prisma, async (database) => {
    const parent = options.parentJob ? workByJob.get(options.parentJob) : undefined;
    if (options.parentJob && !parent) throw new Error('Durable parent binding is missing');
    const expected = parent
      ? await validateDurableAuthority(database, parent.authority)
      : await options.authorize?.(database);
    const children = await options.prepare(database);
    const records = [];
    for (const child of children) {
      const operationId = durableQueueOperationId(child.queue.name, child.jobId);
      const version = child.version ?? (child.queue.name === 'notifications' ? 4 : 1);
      const captured = await captureAuthority(database, child.payload);
      const recipient = await validateDurableAuthority(database, captured.authority);
      if (expected?.userId && recipient?.userId !== expected.userId)
        throw new Error('Durable child recipient differs from its authorization');
      const outbox = sottoJobOutbox(database);
      const existing = await outbox.read(operationId);
      const record = await outbox.enqueue(
        prepareJob({
          id: operationId,
          namespace: SIDEDOOR_STATE_ID,
          handler: child.queue.name,
          version,
          payload: jsonClone({
            type: child.type,
            payload: jsonClone(child.payload),
            authority: captured.authority,
          }),
          scopes: captured.scopes,
          delivery: {
            attempts: child.attempts ?? 3,
            priority: child.priority ?? 0,
            availableAt: existing?.job.delivery.availableAt ?? Date.now(),
          },
        })
      );
      records.push({ child, operationId, version, record });
    }
    if (parent) await sottoJobOutbox(database).complete(parent.operationId, parent.fingerprint);
    return records;
  });
  for (const { child, operationId, version, record } of admitted)
    await deliverSottoJob({
      database: prisma,
      queue: child.queue,
      operationId,
      fingerprint: record.fingerprint,
      version,
    });
}

/** Load and validate a generic durable queue envelope. Raw Redis payloads are rejected. */
export async function loadDurableQueueJob<Payload>(
  database: Prisma.TransactionClient,
  queued: Job<unknown>,
  handler: string,
  version: number
) {
  const work = await readSottoWorkerJob(database, queued, {
    handler,
    version,
    payload: durableEnvelopeSchema,
  });
  if (work.complete) return work;
  await validateDurableAuthority(database, work.payload.authority);
  return {
    ...work,
    payload: work.payload as DurableEnvelope & { payload: Payload },
  };
}

export function bindDurableQueueJob<Payload>(
  queued: Job<unknown>,
  payload: Payload,
  work: { operationId: string; fingerprint: string; payload: DurableEnvelope }
): Job<Payload> {
  const bound = new Proxy(queued as Job<Payload>, {
    get(target, property, receiver) {
      if (property === 'data') return payload;
      return Reflect.get(target, property, receiver);
    },
  });
  workByJob.set(bound, {
    operationId: work.operationId,
    fingerprint: work.fingerprint,
    authority: work.payload.authority,
  });
  return bound;
}

export function durableJobProviderExecution(
  job: Job<unknown>,
  userId: string,
  signal?: AbortSignal
): SottoProviderExecution {
  const work = workByJob.get(job);
  if (!work) throw new Error('Provider execution requires admitted durable work');
  return {
    userId,
    signal,
    authorize: async (database) => {
      signal?.throwIfAborted();
      const recipient = await validateDurableAuthority(database, work.authority);
      if (!recipient || recipient.userId !== userId)
        throw new Error('Durable provider recipient does not match admitted work');
      return recipient;
    },
    onCleanupError: () => work.markCleanupUnconfirmed?.(),
  };
}

export function bindDurableQueueCleanup(
  job: Job<unknown>,
  markCleanupUnconfirmed: () => void
): void {
  const work = workByJob.get(job);
  if (!work) throw new Error('Durable work binding is missing');
  work.markCleanupUnconfirmed = markCleanupUnconfirmed;
}

/** Cleanup uncertainty must survive nested aggregate and causal errors. */
export function isDurableQueueCleanupFailure(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length) {
    const current = pending.pop();
    if (current === null || current === undefined || seen.has(current)) continue;
    seen.add(current);
    if (current instanceof Error) {
      if (/CleanupError$/.test(current.name) || current.name === 'ProviderCleanupError')
        return true;
      if (current.cause !== undefined) pending.push(current.cause);
    }
    if (current instanceof AggregateError) pending.push(...current.errors);
  }
  return false;
}

export async function completeDurableQueueJob(
  database: Prisma.TransactionClient,
  job: Job<unknown>
): Promise<void> {
  const work = workByJob.get(job);
  if (!work) throw new Error('Durable work binding is missing');
  await validateDurableAuthority(database, work.authority);
  await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
}

/** Commit terminal episode failure, its local event, and the learner notification intent together. */
export async function reconcileDurableQueueFailure(options: {
  database: typeof prisma;
  job: Job<unknown>;
  handler: string;
  version: number;
  failedReason: string;
}) {
  return sottoTransaction(options.database, async (database) => {
    const work = await loadDurableQueueJob<Record<string, unknown>>(
      database,
      options.job,
      options.handler,
      options.version
    );
    if (work.complete) return null;
    const episodeId =
      typeof work.payload.payload.episodeId === 'string' ? work.payload.payload.episodeId : null;
    if (!episodeId) return null;
    const episode = await database.episode.findUnique({
      where: { id: episodeId },
      select: { status: true, userId: true, pipelineGeneration: true },
    });
    if (!episode) throw new Error('Durable failure episode is missing');
    const admittedGeneration =
      work.payload.authority.kind === 'episode' ? work.payload.authority.pipelineGeneration : null;
    if (episode.pipelineGeneration !== admittedGeneration) {
      await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
      return null;
    }
    const recipient = await validateDurableAuthority(database, work.payload.authority);
    if (!recipient || recipient.userId !== episode.userId)
      throw new Error('Durable failure recipient changed');
    if (!(await sottoJobOutbox(database).complete(work.operationId, work.fingerprint))) return null;
    if (['READY', 'SCRIPT_READY', 'FAILED'].includes(episode.status)) return null;

    const errorKind = classifyError(options.failedReason);
    const failureReason = userMessage(errorKind, 'the provider', options.handler);
    const errorId = randomUUID();
    await database.episode.update({
      where: { id: episodeId },
      data: {
        failedAtStatus: episode.status,
        status: 'FAILED',
        failureReason,
        technicalError: errorKind,
        errorId,
        failedAt: new Date(),
      },
    });
    await database.pipelineEvent.create({
      data: {
        episodeId,
        stage: options.handler,
        type: 'error',
        message: failureReason,
        metadata: { errorId, errorKind, operationId: work.operationId },
      },
    });

    const notificationId = durableQueueOperationId('notifications', `${work.operationId}:failed`);
    const notification = await sottoJobOutbox(database).enqueue(
      prepareJob({
        id: notificationId,
        namespace: SIDEDOOR_STATE_ID,
        handler: 'notifications',
        version: 4,
        payload: jsonClone({
          type: 'send_notification',
          payload: {
            notificationId: durableQueueOperationId(
              'notification-record',
              `${work.operationId}:failed`
            ),
            userId: episode.userId,
            type: 'EPISODE_FAILED',
            title: 'Generation failed',
            message: `${failureReason} (ref: ${errorId})`,
            data: { episodeId },
          },
          authority: work.payload.authority,
        }),
        scopes: work.scopes,
        delivery: { attempts: 5, priority: 0, availableAt: 0 },
      })
    );
    return {
      operationId: notification.job.id,
      fingerprint: notification.fingerprint,
      version: notification.job.version,
    };
  });
}
