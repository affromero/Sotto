// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  reconcileSottoJobs,
  startSottoJobReconciliation,
} from '@/lib/sidedoor/jobs/core/job-reconciliation';
import { validateSottoQueueContract } from '@/lib/sidedoor/jobs/core/job-contracts';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;
suite('durable reconciliation with PostgreSQL and Redis', () => {
  let instance: SharedTestInstance;
  let queue: Queue;
  let connection: { host: string; port: number; db: number; maxRetriesPerRequest: null };
  beforeAll(async () => {
    const url = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use disposable local Redis database 15');
    connection = { host: url.hostname, port: Number(url.port), db: 15, maxRetriesPerRequest: null };
    instance = await createSharedTestInstance('job_reconciliation');
  });
  beforeEach(async () => {
    await instance.reset();
    queue = new Queue('notifications', { connection, prefix: `reconcile-${randomUUID()}` });
  });
  afterEach(async () => {
    await queue?.obliterate({ force: true });
    await queue?.close();
  });
  afterAll(async () => {
    await instance?.close();
  });
  const options = () => ({
    database: instance.database,
    queues: new Map([[queue.name, queue]]),
    signal: new AbortController().signal,
    cursor: null,
  });
  const fixture = async (version = 1) => {
    const prepared = prepareJob({
      namespace: SIDEDOOR_STATE_ID,
      handler: queue.name,
      version,
      payload: { text: 'private content' },
      scopes: [{ subjectId: 'profile:test', generation: 1 }],
      delivery: { attempts: 2, priority: 2, availableAt: 0 },
    });
    return sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).enqueue(prepared));
  };

  it('restores accepted but incomplete work after Redis loses its queue', async () => {
    const record = await fixture();
    expect((await reconcileSottoJobs(options())).results).toMatchObject([
      { id: record.job.id, status: 'delivered' },
    ]);
    await queue.obliterate({ force: true });
    expect((await reconcileSottoJobs(options())).results).toMatchObject([
      { id: record.job.id, status: 'delivered' },
    ]);
    expect((await queue.getJob(record.job.id))?.data).toEqual({
      operationId: record.job.id,
      fingerprint: record.fingerprint,
    });
    expect((await queue.getJob(record.job.id))?.data).not.toHaveProperty('text');
  });

  it('allows concurrent dispatchers to converge on one immutable queue job', async () => {
    const record = await fixture();
    const pages = await Promise.all([reconcileSottoJobs(options()), reconcileSottoJobs(options())]);
    for (const page of pages)
      expect(page.results).toMatchObject([{ id: record.job.id, status: 'delivered' }]);
    expect(await queue.getJobCounts('wait', 'prioritized')).toMatchObject({
      wait: 0,
      prioritized: 1,
    });
  });

  it('keeps unsupported work visible and still dispatches supported work', async () => {
    const unsupported = await fixture(99);
    const supported = await fixture();
    const page = await reconcileSottoJobs(options());
    expect(page.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: unsupported.job.id, status: 'failed' }),
        expect.objectContaining({ id: supported.job.id, status: 'delivered' }),
      ])
    );
    expect(await queue.getJob(unsupported.job.id)).toBeUndefined();
    expect(
      (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listIncomplete())).jobs
    ).toContainEqual({ id: unsupported.job.id, fingerprint: unsupported.fingerprint });
  });

  it('observes completion racing queue acceptance without reopening work', async () => {
    const record = await fixture();
    const worker = new Worker(
      queue.name,
      async (job) => {
        validateSottoQueueContract(queue.name, job);
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).complete(record.job.id, record.fingerprint)
        );
      },
      { connection, prefix: queue.opts.prefix }
    );
    try {
      await worker.waitUntilReady();
      const completed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Worker did not complete')), 5000);
        worker.on('completed', () => {
          clearTimeout(timer);
          resolve();
        });
        worker.on('failed', (...args) => {
          clearTimeout(timer);
          reject(args[1]);
        });
      });
      await reconcileSottoJobs(options());
      await completed;
      expect((await reconcileSottoJobs(options())).results).toEqual([]);
    } finally {
      await worker.close();
    }
  });

  it('runs automatic reconciliation and stops after a completed pass', async () => {
    const record = await fixture();
    let resolvePass!: () => void;
    const pass = new Promise<void>((resolve) => {
      resolvePass = resolve;
    });
    const failures: unknown[] = [];
    const loop = startSottoJobReconciliation({
      database: instance.database,
      queues: options().queues,
      withQueue: async (name, signal, operation) => {
        signal.throwIfAborted();
        expect(name).toBe(queue.name);
        return operation(queue);
      },
      onResults: (results) => {
        if (results.some((result) => result.id === record.job.id)) resolvePass();
      },
      onError: (error) => {
        failures.push(error);
        return undefined;
      },
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        pass,
        new Promise((resolve, reject) => {
          void pass.then(resolve, reject);
          timeout = setTimeout(() => reject(new Error('No reconciliation pass')), 5000);
        }),
      ]);
      await loop.stop();
      await loop.done;
      expect(failures).toEqual([]);
      expect((await queue.getJob(record.job.id))?.data.operationId).toBe(record.job.id);
    } finally {
      clearTimeout(timeout);
      await loop.stop();
    }
  });
});

describe('durable queue contract isolation', () => {
  it.each([
    'notifications.v99',
    'notifications.v01',
    'notifications.vnext',
    'pdf-generation.v1',
    'send_notification',
  ])('rejects incompatible durable references named %s', (name) => {
    expect(() =>
      validateSottoQueueContract('notifications', {
        name,
        data: { operationId: randomUUID(), fingerprint: 'a'.repeat(64) },
      })
    ).toThrow();
  });
  it('rejects raw notification payloads and accepts implemented durable names', () => {
    expect(() =>
      validateSottoQueueContract('notifications', {
        name: 'send_notification',
        data: { title: 'Lesson ready' },
      })
    ).toThrow('Raw queue payloads are not supported');
    expect(() =>
      validateSottoQueueContract('notifications', {
        name: 'notifications.v3',
        data: { operationId: randomUUID(), fingerprint: 'a'.repeat(64) },
      })
    ).not.toThrow();
  });
});
