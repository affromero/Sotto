import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import {
  inspectReviewQueuePolicy,
  prepareReviewQueuePolicy,
  reviewRuntimePolicySchema,
  type ReviewQueuePolicyIntent,
} from './runtime/policy/queues';
import { z } from 'zod';
import { StorageCleanupJournal } from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '../../../apps/web/src/generated/prisma/client';
import { ALL_QUEUE_NAMES } from '../../../apps/web/src/lib/queue';
import { sottoAccessStore } from '../../../apps/web/src/lib/sidedoor/access/core/access-store';
import {
  SIDEDOOR_STATE_ID,
  sidedoorStateStore,
  sottoStorageInstance,
} from '../../../apps/web/src/lib/sidedoor/access/state/store';
import {
  readFailedSottoDelivery,
  readSottoWorkerJob,
  sottoJobOutbox,
} from '../../../apps/web/src/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '../../../apps/web/src/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  isSottoSynchronousJob,
  requireSottoJobVersion,
} from '../../../apps/web/src/lib/sidedoor/jobs/core/job-contracts';
import { worksheetPdfPayloadSchema } from '../../../apps/web/src/lib/sidedoor/jobs/stitch/worksheet-pdf-work';
import { captureCourseStorage } from '../../../apps/web/src/lib/sidedoor/storage/core/course-storage';

const lifecycle = createRequire(import.meta.url)('../queue-lifecycle.cjs') as {
  connectionIdentity(environment: ReviewQueueRuntime['environment'], namespace: string): string;
  run(input: unknown, runtime: unknown): Promise<{ drained: boolean }>;
};

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().nonnegative().safe();
const jobEvidenceSchema = z
  .object({
    id: z.uuid(),
    fingerprint: hash,
    delivered: z.boolean(),
    jobHash: hash,
    payloadHash: hash,
    scopesHash: hash,
    classHash: hash,
    courseHash: hash,
    profileHash: hash,
    classUpdatedAt: timestamp,
    currentClassUpdatedAt: timestamp,
    worksheetReferenceHash: hash,
  })
  .strict();

/** Private evidence comes from independent admission, never from this inspection's result. */
export const reviewFirstWorkerEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    namespace: z.literal(SIDEDOOR_STATE_ID),
    databaseIdentityHash: hash,
    storageIdentityHash: hash,
    jobs: z.array(jobEvidenceSchema).length(3),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.jobs.map((job) => job.id);
    if (new Set(ids).size !== 3 || !isDeepStrictEqual(ids, [...ids].sort()))
      context.addIssue({ code: 'custom', message: 'Exactly three ordered identities required' });
    if (value.jobs.some((job) => job.classUpdatedAt === job.currentClassUpdatedAt))
      context.addIssue({ code: 'custom', message: 'Only stale worksheet snapshots are admitted' });
  });
export type ReviewFirstWorkerEvidence = z.infer<typeof reviewFirstWorkerEvidenceSchema>;

const knownReferencesSchema = z
  .object({
    namespace: z.literal(SIDEDOOR_STATE_ID),
    jobs: z.array(z.object({ id: z.uuid() }).strict()).length(3),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.jobs.map((job) => job.id);
    if (new Set(ids).size !== 3 || !isDeepStrictEqual(ids, [...ids].sort()))
      context.addIssue({ code: 'custom', message: 'Exactly three ordered identities required' });
  });
type KnownReferences = z.infer<typeof knownReferencesSchema>;

const maxBytes = 262_144;
const maxRows = 10_000;
const timeoutMs = 15_000;

/** Deployment evidence hashing, separate from the SDK's authoritative job fingerprint. */
export function hashReviewFirstWorkerValue(value: unknown): string {
  let nodes = 0;
  function ordered(item: unknown, depth: number): unknown {
    assert(++nodes <= maxRows && depth <= 32, 'Evidence structure bound exceeded');
    if (Array.isArray(item)) return item.map((child) => ordered(child, depth + 1));
    if (item !== null && typeof item === 'object') {
      assert(Object.getPrototypeOf(item) === Object.prototype, 'Plain JSON evidence required');
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, ordered((item as Record<string, unknown>)[key], depth + 1)])
      );
    }
    assert(
      item === null ||
        typeof item === 'string' ||
        typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item)),
      'JSON evidence required'
    );
    return item;
  }
  const encoded = JSON.stringify(ordered(value, 0));
  assert(Buffer.byteLength(encoded) <= maxBytes, 'Evidence byte bound exceeded');
  return createHash('sha256').update(encoded).digest('hex');
}

function budget(deadline: number) {
  assert(Date.now() < deadline, 'First-worker inspection deadline exceeded');
}

async function readOnly<Result>(
  database: PrismaClient,
  operation: (transaction: Prisma.TransactionClient, deadline: number) => Promise<Result>
) {
  const deadline = Date.now() + timeoutMs;
  return database.$transaction(
    async (transaction) => {
      await transaction.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await transaction.$executeRawUnsafe("SET LOCAL statement_timeout='5s'");
      const settings = await transaction.$queryRawUnsafe<{ mode: string; isolation: string }[]>(
        "SELECT current_setting('transaction_read_only') AS mode, current_setting('transaction_isolation') AS isolation"
      );
      assert(settings[0]?.mode === 'on' && settings[0]?.isolation === 'serializable');
      const sizes = await transaction.$queryRawUnsafe<
        { count: bigint; maximum: number; total: bigint }[]
      >(
        'SELECT count(*) AS count, COALESCE(max(octet_length(state::text)),0)::int AS maximum, COALESCE(sum(octet_length(state::text)),0)::bigint AS total FROM "SidedoorState"'
      );
      assert(
        sizes.length === 1 &&
          sizes[0].count <= BigInt(maxRows) &&
          sizes[0].maximum <= 2 * 1024 * 1024 &&
          sizes[0].total <= BigInt(16 * 1024 * 1024),
        'Shared-state inspection bound exceeded'
      );
      const users = await transaction.$queryRawUnsafe<{ count: bigint }[]>(
        'SELECT count(*) AS count FROM "User"'
      );
      assert(users.length === 1 && users[0].count <= BigInt(maxRows), 'Profile bound exceeded');
      const result = await operation(transaction, deadline);
      budget(deadline);
      return result;
    },
    { isolationLevel: 'Serializable', timeout: timeoutMs, maxWait: 5000 }
  );
}

async function readWorksheetSnapshot(transaction: Prisma.TransactionClient) {
  const identity = await transaction.$queryRawUnsafe<Record<string, unknown>[]>(
    'SELECT current_database() AS "databaseName", current_schema() AS "schemaName", inet_server_addr()::text AS "serverAddress", inet_server_port() AS "serverPort", (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid"'
  );
  assert(identity.length === 1, 'Unique database identity required');
  const instance = await sottoStorageInstance(transaction).read();
  const state = await sidedoorStateStore(transaction).read();
  const access = await (await sottoAccessStore(transaction)).read();
  const site = state.configuration.site;
  assert(site !== null, 'Established storage configuration required');
  const storage = Object.fromEntries(
    [
      'storageProvider',
      'localStorageRoot',
      'objectStorageEndpoint',
      'objectStorageBucket',
      'objectStorageRegion',
      'objectStoragePublicUrl',
    ].map((key) => [key, site[key] ?? null])
  );
  return {
    databaseIdentityHash: hashReviewFirstWorkerValue(identity[0]),
    storageIdentityHash: hashReviewFirstWorkerValue({ instance, storage }),
    access,
  };
}

async function readWorksheetEvidence(
  transaction: Prisma.TransactionClient,
  reference: { id: string; fingerprint: string },
  access: Awaited<ReturnType<typeof readWorksheetSnapshot>>['access']
) {
  const outbox = sottoJobOutbox(transaction);
  const receipt = await outbox.receipt(reference.id);
  const record = await outbox.read(reference.id);
  assert(
    receipt?.status === 'pending' &&
      record &&
      !record.complete &&
      receipt.id === reference.id &&
      receipt.fingerprint === reference.fingerprint &&
      record.fingerprint === reference.fingerprint &&
      receipt.handler === 'worksheet-pdf' &&
      receipt.version === 1,
    'Unexpected durable receipt'
  );
  const durable = await readSottoWorkerJob(
    transaction,
    {
      id: reference.id,
      name: 'worksheet-pdf.v1',
      data: { operationId: reference.id, fingerprint: reference.fingerprint },
    },
    { handler: 'worksheet-pdf', version: 1, payload: worksheetPdfPayloadSchema }
  );
  assert(!durable.complete, 'Worksheet work is no longer pending');
  assert.equal(record.job.namespace, SIDEDOOR_STATE_ID);
  assert.equal(record.job.id, reference.id);
  assert.deepEqual(record.job.delivery, { attempts: 2, priority: 0, availableAt: 0 });
  assert.equal(durable.payload.appBaseUrl, 'https://demo.sotto.fm');
  const cls = await transaction.courseClass.findUnique({
    where: { id: durable.payload.classId },
    select: { id: true, courseId: true, updatedAt: true, worksheetPdfUrl: true },
  });
  assert(cls && cls.worksheetPdfUrl, 'Preserved worksheet class/reference missing');
  assert.notEqual(
    cls.updatedAt.getTime(),
    durable.payload.classUpdatedAt,
    'Only stale worksheet snapshots can be observed'
  );
  const ownership = await captureCourseStorage(transaction, cls.courseId);
  assert(isDeepStrictEqual(ownership.scopes, durable.scopes), 'Captured ownership changed');
  const profile = access.householdProfiles?.find((item) => item.id === ownership.userId);
  const principal = access.principals.find((item) => item.id === ownership.userId);
  assert(profile || principal, 'Canonical learner authority missing');
  const course = await transaction.course.findUniqueOrThrow({
    where: { id: cls.courseId },
    select: { id: true, userId: true, createdAt: true },
  });
  const actual = {
    id: reference.id,
    fingerprint: record.fingerprint,
    delivered: record.delivered,
    jobHash: hashReviewFirstWorkerValue(record.job),
    payloadHash: hashReviewFirstWorkerValue(durable.payload),
    scopesHash: hashReviewFirstWorkerValue(durable.scopes),
    classHash: hashReviewFirstWorkerValue({ id: cls.id, courseId: cls.courseId }),
    courseHash: hashReviewFirstWorkerValue({
      ...course,
      createdAt: course.createdAt.getTime(),
    }),
    profileHash: hashReviewFirstWorkerValue({
      id: ownership.userId,
      profile: profile ?? null,
      principal: principal
        ? {
            id: principal.id,
            epoch: principal.epoch,
            role: principal.role,
            createdAt: principal.createdAt,
          }
        : null,
    }),
    classUpdatedAt: durable.payload.classUpdatedAt,
    currentClassUpdatedAt: cls.updatedAt.getTime(),
    worksheetReferenceHash: hashReviewFirstWorkerValue(cls.worksheetPdfUrl),
  };
  return actual;
}

/** Initial capture and admission inspect the complete preactivation inventory. */
async function readReviewFirstWorker(database: PrismaClient, known: KnownReferences) {
  return readOnly(database, async (transaction, deadline) => {
    const snapshot = await readWorksheetSnapshot(transaction);
    const outbox = sottoJobOutbox(transaction);
    const jobs: ReviewFirstWorkerEvidence['jobs'] = [];
    const seen = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      budget(deadline);
      const page = await outbox.listIncomplete(cursor);
      for (const reference of page.jobs) {
        assert(!seen.has(reference.id) && seen.size < 3, 'Unexpected incomplete work');
        seen.add(reference.id);
        assert(
          known.jobs.some((item) => item.id === reference.id),
          'Unknown work identity'
        );
        jobs.push(await readWorksheetEvidence(transaction, reference, snapshot.access));
      }
      if (page.cursor !== null) {
        assert(page.jobs.length > 0 && !cursors.has(page.cursor) && cursors.size < 100);
        cursors.add(page.cursor);
      }
      cursor = page.cursor;
    } while (cursor !== null);
    assert.equal(seen.size, 3, 'Admitted historical work missing');
    // Discovery does not confer authority. Every retained row is checked by its canonical reader.
    const retained = await transaction.$queryRawUnsafe<{ id: unknown; namespace: unknown }[]>(
      "SELECT COALESCE(state->'job'->>'id',state->>'id') AS id, COALESCE(state->'job'->>'namespace',state->>'namespace') AS namespace FROM \"SidedoorState\" WHERE state->>'kind' IN ('outbox_job','outbox_erased') LIMIT 10001"
    );
    assert(retained.length <= maxRows, 'Retained job inspection bound exceeded');
    const retainedIds = new Set<string>();
    for (const row of retained) {
      budget(deadline);
      assert.equal(row.namespace, known.namespace, 'Unknown retained namespace');
      const id = z.uuid().parse(row.id);
      assert(!retainedIds.has(id), 'Duplicate retained job identity');
      retainedIds.add(id);
      const receipt = await outbox.receipt(id);
      assert(receipt, 'Retained work has no canonical receipt');
      if (receipt.status === 'erased') continue;
      const record = await outbox.read(id);
      assert(record && record.fingerprint === receipt.fingerprint);
      assert.equal(record.complete, receipt.status === 'complete');
      if (receipt.status === 'pending') assert(seen.has(id), 'Unindexed incomplete work');
    }
    return reviewFirstWorkerEvidenceSchema.parse({
      schemaVersion: 1,
      namespace: known.namespace,
      databaseIdentityHash: snapshot.databaseIdentityHash,
      storageIdentityHash: snapshot.storageIdentityHash,
      jobs: jobs.sort((left, right) => left.id.localeCompare(right.id)),
    });
  });
}

/** Observation only. Its private output requires separate independent admission before use. */
export async function captureReviewFirstWorkerEvidence(database: PrismaClient, input: unknown) {
  return readReviewFirstWorker(database, knownReferencesSchema.parse(input));
}

/** Revalidate separately admitted evidence. Capture output is never accepted implicitly. */
export async function inspectReviewFirstWorker(database: PrismaClient, input: unknown) {
  const evidence = reviewFirstWorkerEvidenceSchema.parse(input);
  const known = knownReferencesSchema.parse({
    namespace: evidence.namespace,
    jobs: evidence.jobs.map(({ id }) => ({ id })),
  });
  const actual = await readReviewFirstWorker(database, known);
  assert.deepEqual(actual, evidence, 'Admitted worksheet evidence changed');
  return { admitted: true as const, zeroWork: false as const, pending: 3 as const };
}

async function readAdmittedWorksheets(database: PrismaClient, evidence: ReviewFirstWorkerEvidence) {
  return readOnly(database, async (transaction, inspectionDeadline) => {
    const snapshot = await readWorksheetSnapshot(transaction);
    assert.equal(snapshot.databaseIdentityHash, evidence.databaseIdentityHash);
    assert.equal(snapshot.storageIdentityHash, evidence.storageIdentityHash);
    const jobs: ReviewFirstWorkerEvidence['jobs'] = [];
    for (const reference of evidence.jobs) {
      budget(inspectionDeadline);
      jobs.push(await readWorksheetEvidence(transaction, reference, snapshot.access));
    }
    return jobs;
  });
}

/** Historical count only. Canonical startup may admit other new work while paused. */
export async function inspectReviewPausedFirstWorker(database: PrismaClient, input: unknown) {
  const evidence = reviewFirstWorkerEvidenceSchema.parse(input);
  const actual = await readAdmittedWorksheets(database, evidence);
  for (const [index, job] of actual.entries()) {
    const admitted = evidence.jobs[index];
    assert(!admitted.delivered || job.delivered, 'Historical delivery acknowledgment regressed');
    assert.deepEqual(
      { ...job, delivered: admitted.delivered },
      admitted,
      'Historical evidence changed'
    );
  }
  return { admitted: true as const, zeroWork: false as const, pending: 3 as const };
}

/** Read actual consumers and active jobs while every admitted queue remains paused. */
export async function inspectReviewPausedConsumers(
  runtime: Pick<ReviewQueueRuntime, 'names' | 'createQueue' | 'policy'>,
  input: unknown
) {
  const expected = z
    .object({
      address: z.literal('172.30.99.11'),
      paused: z.literal(true),
      count: z.union([z.literal(0), z.literal(1)]),
    })
    .strict()
    .parse(input);
  await inspectReviewQueuePolicy(runtime, runtime.policy);
  assert.deepEqual([...runtime.names].sort(), [...ALL_QUEUE_NAMES].sort());
  const deadline = Date.now() + timeoutMs;
  for (const name of ALL_QUEUE_NAMES) {
    budget(deadline);
    const queue = runtime.createQueue(name);
    try {
      assert(await queue.isPaused(), 'Review queues must remain paused before activation');
      assert.equal(await queue.getActiveCount(), 0, 'Paused queues have active work');
      const workers = await queue.getWorkers();
      assert.equal(workers.length, expected.count, 'Unexpected actual queue consumer count');
      assert(
        workers.every((worker) => /^172\.30\.99\.11:\d+$/.test(worker.addr)),
        'Only the admitted full worker may consume review work'
      );
    } finally {
      await queue.close();
    }
  }
  return { consumers: ALL_QUEUE_NAMES.length, queuesPaused: true, workerAddress: expected.address };
}

/** Observe retained refusals after startup. New ordinary work has its own admission. */
export async function inspectReviewContinuation(
  database: PrismaClient,
  input: unknown,
  worksheetQueue: Queue
) {
  const evidence = reviewFirstWorkerEvidenceSchema.parse(input);
  assert.equal(worksheetQueue.name, 'worksheet-pdf', 'Actual worksheet queue required');
  const deadline = Date.now() + timeoutMs;
  const actual = await readAdmittedWorksheets(database, evidence);
  assert.deepEqual(
    actual,
    evidence.jobs.map((job) => ({ ...job, delivered: true })),
    'Historical evidence changed'
  );
  for (const reference of evidence.jobs) {
    budget(deadline);
    const record = await readFailedSottoDelivery({
      database,
      queue: worksheetQueue,
      operationId: reference.id,
      version: 1,
    });
    assert.equal(record.fingerprint, reference.fingerprint, 'Historical delivery changed');
    const queued = await worksheetQueue.getJob(reference.id);
    assert(queued, 'Historical failed delivery missing');
    assert.equal(queued.opts.jobId, reference.id, 'Historical job identity changed');
    assert.equal(queued.attemptsMade, 2, 'Historical attempts are not exhausted');
    assert.equal(queued.failedReason, 'Worksheet class changed before generation');
  }
  budget(deadline);
  return {
    retained: true as const,
    zeroWork: false as const,
    pending: 3 as const,
    failed: 3 as const,
    attempts: 2 as const,
  };
}

/** Raw dedicated DB0 inspection precedes every Queue constructor and metadata write. */
export async function inspectReviewRedisEmpty(redis: Pick<Redis, 'dbsize' | 'scan' | 'options'>) {
  assert.equal(redis.options.db ?? 0, 0, 'Dedicated review Redis database 0 required');
  assert(
    redis.options.commandTimeout !== undefined &&
      redis.options.commandTimeout > 0 &&
      redis.options.commandTimeout <= 5000,
    'Bounded review Redis commands required'
  );
  const deadline = Date.now() + timeoutMs;
  assert.equal(await redis.dbsize(), 0, 'Review Redis contains unknown state');
  let cursor = '0';
  let pages = 0;
  do {
    budget(deadline);
    const page = await redis.scan(cursor, 'COUNT', 100);
    assert(page[1].length === 0 && ++pages <= 100, 'Review Redis contains unknown state');
    cursor = page[0];
  } while (cursor !== '0');
  assert.equal(await redis.dbsize(), 0, 'Review Redis changed during inspection');
  budget(deadline);
  return { empty: true as const };
}

export interface ReviewQueueRuntime {
  database: PrismaClient;
  namespace: typeof SIDEDOOR_STATE_ID;
  environment: { DATABASE_URL: string; REDIS_URL: string };
  names: readonly string[];
  createQueue(name: string): Queue;
  policy: unknown;
  policyIntent: unknown;
  admitQueuePolicy(intent: ReviewQueuePolicyIntent): Promise<void>;
}

/** Explicit first metadata write. Partial failures retain pause state for controller recovery. */
export async function prepareReviewQueues(
  runtime: ReviewQueueRuntime,
  evidence: unknown,
  redis: Pick<Redis, 'dbsize' | 'scan' | 'options'>
) {
  assert.equal(runtime.namespace, SIDEDOOR_STATE_ID);
  const redisUrl = new URL(runtime.environment.REDIS_URL);
  assert(['redis:', 'rediss:'].includes(redisUrl.protocol));
  assert.equal(redisUrl.pathname, '/0');
  assert(!redis.options.path, 'TCP review Redis identity required');
  assert.equal(redis.options.host, redisUrl.hostname);
  assert.equal(redis.options.port, Number(redisUrl.port || 6379));
  assert(runtime.names.length > 0 && runtime.names.length <= 100);
  assert.equal(new Set(runtime.names).size, runtime.names.length);
  assert(runtime.names.every((name) => /^[a-z][a-z0-9-]{0,99}$/.test(name)));
  assert.deepEqual(
    [...runtime.names].sort(),
    [...ALL_QUEUE_NAMES].sort(),
    'Final queue inventory changed'
  );
  await inspectReviewFirstWorker(runtime.database, evidence);
  reviewRuntimePolicySchema.parse(runtime.policy);
  if (runtime.policyIntent === null) await inspectReviewRedisEmpty(redis);
  const deadline = Date.now() + timeoutMs;
  const queues: Queue[] = [];
  const manifest = {
    schemaVersion: 1,
    connectionIdentity: lifecycle.connectionIdentity(runtime.environment, runtime.namespace),
    queues: [...runtime.names].sort().map((name) => ({ name, paused: false })),
  };
  try {
    for (const name of [...runtime.names].sort()) {
      budget(deadline);
      const queue = runtime.createQueue(name);
      queues.push(queue);
      assert.equal(queue.opts.connection, redis, 'Queue must use the inspected Redis client');
      if (runtime.policyIntent === null) await queue.pause();
      else assert(await queue.isPaused(), 'Retained review queue was unpaused');
      assert.equal((await queue.getWorkers()).length, 0, 'Unexpected review consumer');
      assert.equal((await queue.getJobs(undefined, 0, 0)).length, 0, 'Unexpected queued work');
      assert.equal(await queue.getJobSchedulersCount(), 0, 'Unexpected scheduled work');
    }
    const ownedKeys = new Set(queues.flatMap((queue) => Object.values(queue.keys)));
    let cursor = '0';
    let pages = 0;
    do {
      budget(deadline);
      const page = await redis.scan(cursor, 'COUNT', 100);
      assert(
        ++pages <= 100 && page[1].every((key) => ownedKeys.has(key)),
        'Review Redis contains unowned preparation metadata'
      );
      cursor = page[0];
    } while (cursor !== '0');
    await prepareReviewQueuePolicy(
      queues,
      manifest.connectionIdentity,
      runtime.policyIntent,
      runtime.admitQueuePolicy
    );
    const drained = await lifecycle.run(
      { command: 'drained-all', manifest },
      {
        ...runtime,
        sottoJobOutbox,
        sottoJobExecutions,
        isSottoSynchronousJob,
        requireSottoJobVersion,
      }
    );
    assert.equal(drained.drained, true, 'Review execution remains active');
    await readOnly(runtime.database, async (transaction, inspectionDeadline) => {
      const cleanup = new StorageCleanupJournal(
        {
          query: (sql, values) =>
            transaction.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        runtime.namespace
      );
      let cursor: string | null = null;
      const cursors = new Set<string>();
      let inspected = 0;
      do {
        budget(inspectionDeadline);
        const page = await cleanup.listJobs(cursor);
        for (const item of page.jobs) {
          assert(++inspected <= maxRows, 'Cleanup inspection bound exceeded');
          const job = await cleanup.get(item.id);
          assert(
            job.phase === 'complete' &&
              job.pending === 0 &&
              job.unresolvedManifests === 0 &&
              job.remainingCollectors === 0,
            'Review storage cleanup remains unresolved'
          );
        }
        if (page.cursor !== null) {
          assert(page.jobs.length > 0 && !cursors.has(page.cursor) && cursors.size < 1000);
          cursors.add(page.cursor);
        }
        cursor = page.cursor;
      } while (cursor !== null);
    });
    await inspectReviewFirstWorker(runtime.database, evidence);
    for (const queue of queues) {
      assert(await queue.isPaused(), 'Review queue fence changed');
      assert.equal((await queue.getWorkers()).length, 0, 'Unexpected review consumer');
      assert.equal((await queue.getJobs(undefined, 0, 0)).length, 0, 'Unexpected queued work');
      assert.equal(await queue.getJobSchedulersCount(), 0, 'Unexpected scheduled work');
    }
    budget(deadline);
    return {
      prepared: true as const,
      manifest,
      queueConcurrency: 1 as const,
      zeroWork: false as const,
      pending: 3 as const,
    };
  } finally {
    const closed = await Promise.allSettled(queues.map((queue) => queue.close()));
    assert(
      closed.every((result) => result.status === 'fulfilled'),
      'Queue cleanup failed'
    );
  }
}
