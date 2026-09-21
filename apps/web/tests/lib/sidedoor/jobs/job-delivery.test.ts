// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { StorageCleanupJournal, prepareStorageCleanup } from 'thesidedoor-core/storage';
import { z } from 'zod';
import {
  deliverSottoJob,
  readSottoWorkerJob,
  sottoJobOutbox,
} from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;
suite('durable BullMQ delivery with PostgreSQL and Redis', () => {
  let instance: SharedTestInstance;
  let queue: Queue;
  let connection: { host: string; port: number; db: number; maxRetriesPerRequest: null };
  beforeAll(async () => {
    const url = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use isolated local Redis database 15');
    connection = { host: url.hostname, port: Number(url.port), db: 15, maxRetriesPerRequest: null };
    instance = await createSharedTestInstance('job_delivery');
  });
  beforeEach(async () => {
    await instance.reset();
    queue = new Queue(`outbox-test-${randomUUID()}`, { connection });
  });
  afterEach(async () => {
    if (queue) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });
  afterAll(async () => {
    await instance?.close();
  });
  async function fixture(availableAt = 0, attempts = 1) {
    const prepared = prepareJob({
      namespace: SIDEDOOR_STATE_ID,
      handler: queue.name,
      version: 1,
      payload: { text: 'private lesson content' },
      scopes: [{ subjectId: 'profile:test', generation: 1 }],
      delivery: { attempts, priority: 2, availableAt },
    });
    return sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).enqueue(prepared));
  }
  const deliver = (operationId: string) =>
    deliverSottoJob({ database: instance.database, queue, operationId, version: 1 });
  it('rejects a stale reconciliation fingerprint before writing to Redis', async () => {
    const record = await fixture();
    await expect(
      deliverSottoJob({
        database: instance.database,
        queue,
        operationId: record.job.id,
        version: 1,
        fingerprint: '0'.repeat(64),
      })
    ).rejects.toThrow('identity changed');
    expect(await queue.getJob(record.job.id)).toBeUndefined();
    expect(
      (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listPending())).jobs
    ).toEqual([{ id: record.job.id, fingerprint: record.fingerprint }]);
    expect(
      await deliverSottoJob({
        database: instance.database,
        queue,
        operationId: record.job.id,
        version: 1,
        fingerprint: record.fingerprint,
      })
    ).toBe('delivered');
  });
  it.each(['before', 'during'])(
    'recognizes erasure %s Redis acceptance without reopening work',
    async (when) => {
      const record = await fixture();
      const captured = record.job.scopes[0]!;
      const deletion = prepareStorageCleanup({ namespace: SIDEDOOR_STATE_ID, ...captured });
      const erase = () =>
        sottoTransaction(instance.database, async (tx) => {
          await new StorageCleanupJournal(
            {
              query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
            },
            'postgres',
            SIDEDOOR_STATE_ID
          ).createJob(deletion);
          const outbox = sottoJobOutbox(tx);
          await outbox.complete(record.job.id, record.fingerprint);
          await outbox.erase(record.job.id, record.fingerprint, captured);
        });
      if (when === 'before') await erase();
      else {
        const add = queue.add.bind(queue);
        vi.spyOn(queue, 'add').mockImplementationOnce(async (...args) => {
          const accepted = await add(...args);
          await erase();
          return accepted;
        });
      }
      expect(await deliver(record.job.id)).toBe('erased');
      expect(await deliver(record.job.id)).toBe('erased');
      if (when === 'before') expect(await queue.getJob(record.job.id)).toBeUndefined();
      else
        expect((await queue.getJob(record.job.id))?.data).toEqual({
          operationId: record.job.id,
          fingerprint: record.fingerprint,
        });
      await expect(
        deliverSottoJob({
          database: instance.database,
          queue,
          operationId: record.job.id,
          version: 2,
        })
      ).rejects.toThrow('does not match');
    }
  );
  it('loads private work only from the database and observes committed completion', async () => {
    const record = await fixture();
    await deliver(record.job.id);
    const queued = (await queue.getJob(record.job.id))!;
    const contract = {
      handler: queue.name,
      version: 1,
      payload: z.object({ text: z.string() }).strict(),
    };
    const read = () =>
      sottoTransaction(instance.database, (tx) => readSottoWorkerJob(tx, queued, contract));
    expect(await read()).toEqual({
      complete: false,
      operationId: record.job.id,
      fingerprint: record.fingerprint,
      scopes: record.job.scopes,
      payload: { text: 'private lesson content' },
    });
    await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).complete(record.job.id, record.fingerprint)
    );
    expect(await read()).toEqual({ complete: true });
  });
  it.each(['id', 'name', 'fingerprint', 'extra-data', 'handler', 'version', 'schema'])(
    'rejects a worker %s mismatch',
    async (mismatch) => {
      const record = await fixture();
      const queued = {
        id: mismatch === 'id' ? randomUUID() : record.job.id,
        name: mismatch === 'name' ? 'other.v1' : `${queue.name}.v1`,
        data: {
          operationId: record.job.id,
          fingerprint: mismatch === 'fingerprint' ? '0'.repeat(64) : record.fingerprint,
          ...(mismatch === 'extra-data' ? { text: 'untrusted replacement' } : {}),
        },
      };
      await expect(
        sottoTransaction(instance.database, (tx) =>
          readSottoWorkerJob(tx, queued, {
            handler: mismatch === 'handler' ? 'other' : queue.name,
            version: mismatch === 'version' ? 2 : 1,
            payload: z.object({
              text: mismatch === 'schema' ? z.string().regex(/^invalid$/) : z.string(),
            }),
          })
        )
      ).rejects.toThrow();
    }
  );
  it('deduplicates concurrent delivery and preserves scheduling without copying private payloads', async () => {
    const record = await fixture(Date.now() + 60_000);
    expect(await Promise.all([deliver(record.job.id), deliver(record.job.id)])).toEqual([
      'delivered',
      'delivered',
    ]);
    const stored = await queue.getJob(record.job.id);
    expect(stored?.data).toEqual({ operationId: record.job.id, fingerprint: record.fingerprint });
    expect(await stored?.getState()).toBe('delayed');
    expect(await queue.getJobCounts('delayed')).toMatchObject({ delayed: 1 });
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(record.job.id))
    ).toMatchObject({ delivered: true, complete: false });
  });
  it.each(['payload', 'name', 'options'])(
    'rejects a conflicting existing %s without changing it',
    async (conflict) => {
      const record = await fixture();
      await queue.add(
        conflict === 'name' ? 'unrelated' : `${queue.name}.v1`,
        {
          operationId: record.job.id,
          fingerprint: conflict === 'payload' ? '0'.repeat(64) : record.fingerprint,
        },
        { jobId: record.job.id, attempts: conflict === 'options' ? 2 : 1, priority: 2 }
      );
      const before = await queue.getJob(record.job.id);
      await expect(deliver(record.job.id)).rejects.toThrow('conflicts');
      const after = await queue.getJob(record.job.id);
      expect(after?.name).toBe(before?.name);
      expect(after?.data).toEqual(before?.data);
      expect(after?.opts).toEqual(before?.opts);
      expect(
        await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(record.job.id))
      ).toMatchObject({ delivered: false });
    }
  );
  it('recovers queue acceptance after the acknowledgement transaction fails', async () => {
    const record = await fixture();
    await instance.database.$executeRawUnsafe(
      `ALTER TABLE "SidedoorState" ADD CONSTRAINT reject_delivery CHECK (NOT (state->>'kind' = 'outbox_job' AND state->>'delivered' = 'true'))`
    );
    try {
      await expect(deliver(record.job.id)).rejects.toThrow();
      expect(await queue.getJob(record.job.id)).toBeDefined();
      expect(
        (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listPending())).jobs
      ).toHaveLength(1);
    } finally {
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "SidedoorState" DROP CONSTRAINT reject_delivery'
      );
    }
    expect(await deliver(record.job.id)).toBe('delivered');
    expect(await queue.getJobCounts('prioritized')).toMatchObject({ prioritized: 1 });
  });
  it('recreates lost Redis work from the incomplete index and skips permanently completed work', async () => {
    const record = await fixture();
    await deliver(record.job.id);
    await queue.obliterate({ force: true });
    const incomplete = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).listIncomplete()
    );
    expect(incomplete.jobs).toEqual([{ id: record.job.id, fingerprint: record.fingerprint }]);
    await deliver(incomplete.jobs[0]!.id);
    expect((await queue.getJob(record.job.id))?.data).toMatchObject({
      fingerprint: record.fingerprint,
    });
    await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).complete(record.job.id, record.fingerprint)
    );
    await queue.obliterate({ force: true });
    expect(await deliver(record.job.id)).toBe('complete');
    expect(await queue.getJob(record.job.id)).toBeUndefined();
  });
  it.each([false, true])('reconciles promoted delayed work, including retry=%s', async (retry) => {
    const name = queue.name;
    await queue.close();
    queue = new Queue(name, {
      connection,
      defaultJobOptions: { backoff: { type: 'fixed', delay: 20 } },
    });
    const record = await fixture(Date.now() + 100, 2);
    await deliver(record.job.id);
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const worker = new Worker(
      queue.name,
      async (job) => {
        if (retry && job.attemptsMade === 0) throw new Error('Temporary transport failure');
        started.resolve();
        await release.promise;
      },
      { connection, autorun: false }
    );
    const running = worker.run();
    try {
      await started.promise;
      expect(await deliver(record.job.id)).toBe('delivered');
      expect(await (await queue.getJob(record.job.id))?.getState()).toBe('active');
    } finally {
      release.resolve();
      await worker.close();
      await running;
    }
  });

  it.each(['failed', 'completed'] as const)(
    'surfaces %s work without a database completion receipt',
    async (state) => {
      const record = await fixture();
      await deliver(record.job.id);
      const worker = new Worker(
        queue.name,
        async () => {
          if (state === 'failed') throw new Error('Provider failed');
          return 'done';
        },
        { connection, autorun: false }
      );
      const settled = new Promise<void>((resolve) => worker.once(state, () => resolve()));
      const running = worker.run();
      try {
        await settled;
        await expect(deliver(record.job.id)).rejects.toThrow(
          `${state} without a durable completion`
        );
        expect(await (await queue.getJob(record.job.id))?.getState()).toBe(state);
      } finally {
        await worker.close();
        await running;
      }
    }
  );
});
