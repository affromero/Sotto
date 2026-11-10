// @vitest-environment private-redis
import { randomUUID } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { prepareStorageCleanup, StorageCleanupJournal } from 'thesidedoor-core/storage';
import { deliverSottoJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { enqueueDurableQueueJob } from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  sottoJobExecutions,
  withSottoJobExecution,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  reconcileSottoJobs,
  startSottoJobReconciliation,
} from '@/lib/sidedoor/jobs/core/job-reconciliation';
import {
  sottoJobFailureCode,
  validateSottoQueueContract,
} from '@/lib/sidedoor/jobs/core/job-contracts';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { materialStorageScopes } from '@/lib/course-materials';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const connectionBoundary = vi.hoisted(() => ({ failNextClose: false }));
vi.mock('@/lib/sidedoor/storage/core/storage-connection', async (original) => {
  const actual = await original<typeof import('@/lib/sidedoor/storage/core/storage-connection')>();
  return {
    ...actual,
    openSottoStorageConnection: async (
      ...args: Parameters<typeof actual.openSottoStorageConnection>
    ) => {
      const connection = await actual.openSottoStorageConnection(...args);
      return {
        ...connection,
        close: async () => {
          await connection.close();
          if (connectionBoundary.failNextClose) {
            connectionBoundary.failNextClose = false;
            const error = new Error('Connection cleanup could not be confirmed');
            error.name = 'PostgresConnectionCleanupError';
            throw error;
          }
        },
      };
    },
  };
});

const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SOTTO_TEST_PRIVATE_REDIS_URL
    ? describe
    : describe.skip;
suite('durable reconciliation with PostgreSQL and Redis', () => {
  let instance: SharedTestInstance;
  let queue: Queue;
  let connection: { host: string; port: number; db: number; maxRetriesPerRequest: null };
  beforeAll(async () => {
    const url = new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/0')
      throw new Error('Use the private Redis test instance');
    connection = { host: url.hostname, port: Number(url.port), db: 0, maxRetriesPerRequest: null };
    instance = await createSharedTestInstance('job_reconciliation');
  });
  beforeEach(async () => {
    connectionBoundary.failNextClose = false;
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

  it.each([
    {
      state: 'failed',
      published: true,
      blocked: false,
      deleted: false,
      erased: false,
      cleanup: false,
    },
    {
      state: 'completed',
      published: true,
      blocked: false,
      deleted: false,
      erased: false,
      cleanup: false,
    },
    {
      state: 'failed',
      published: false,
      blocked: false,
      deleted: false,
      erased: false,
      cleanup: false,
    },
    {
      state: 'completed',
      published: false,
      blocked: false,
      deleted: false,
      erased: false,
      cleanup: false,
    },
    {
      state: 'failed',
      published: true,
      blocked: true,
      deleted: false,
      erased: false,
      cleanup: false,
    },
    {
      state: 'failed',
      published: true,
      blocked: false,
      deleted: true,
      erased: false,
      cleanup: false,
    },
    {
      state: 'failed',
      published: true,
      blocked: false,
      deleted: false,
      erased: true,
      cleanup: false,
    },
    {
      state: 'failed',
      published: true,
      blocked: false,
      deleted: false,
      erased: false,
      cleanup: true,
    },
  ] as const)(
    'preserves published=$published blocked=$blocked deleted=$deleted erased=$erased cleanup=$cleanup work after its queue job is $state',
    async ({ state, published, blocked, deleted, erased, cleanup }) => {
      await queue.close();
      queue = new Queue('interactions', { connection, prefix: `reconcile-${randomUUID()}` });
      const user = await instance.database.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
      const episode = await instance.database.episode.create({
        data: { userId: user.id, title: 'Episode', topic: 'Topic' },
      });
      const payload = {
        episodeId: episode.id,
        interactionId: randomUUID(),
        userId: user.id,
        question: 'What was said?',
        timestamp: 1,
      };
      const record = await sottoTransaction(instance.database, async (tx) => {
        await tx.interaction.create({
          data: {
            id: payload.interactionId,
            episodeId: episode.id,
            userId: user.id,
            question: payload.question,
            timestamp: payload.timestamp,
            status: published ? 'ANSWERED' : 'PENDING',
            answer: published ? 'Existing answer' : null,
          },
        });
        return enqueueDurableQueueJob(tx, {
          handler: 'interactions',
          type: 'process_interaction',
          payload,
          jobId: `interaction-${payload.interactionId}`,
          attempts: 1,
        });
      });
      await deliverSottoJob({
        database: instance.database,
        queue,
        operationId: record.job.id,
        version: 1,
      });
      const worker = new Worker(
        queue.name,
        async () => {
          if (state === 'failed') throw new Error('Lost completion');
        },
        { connection, prefix: queue.opts.prefix, autorun: false }
      );
      try {
        const finished = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Interaction job did not finish')), 5000);
          worker.on(state, (job: Job | undefined) => {
            if (job?.id !== record.job.id) return;
            clearTimeout(timer);
            resolve();
          });
        });
        void worker.run();
        await finished;
      } finally {
        await worker.close();
      }

      if (blocked) {
        await expect(
          withSottoJobExecution({
            database: instance.database,
            parentId: record.job.id,
            fingerprint: record.fingerprint,
            signal: new AbortController().signal,
            validate: async () => true,
            isCleanupFailure: () => false,
            run: async ({ markCleanupUnconfirmed }) => {
              markCleanupUnconfirmed();
              throw new Error('Execution cleanup is unconfirmed');
            },
          })
        ).rejects.toThrow('Execution cleanup is unconfirmed');
      }
      if (deleted)
        await instance.database.episode.update({
          where: { id: episode.id },
          data: { deletedAt: new Date() },
        });

      connectionBoundary.failNextClose = cleanup;
      let queueUses = 0;
      const results = (
        await reconcileSottoJobs({
          ...options(),
          withQueue: async <Result>(
            name: string,
            signal: AbortSignal,
            operation: (target: Queue) => Promise<Result>
          ) => {
            if (name !== queue.name) throw new Error('Unexpected queue');
            signal.throwIfAborted();
            queueUses += 1;
            if (erased && queueUses === 2) {
              const scope = record.job.scopes[0]!;
              await sottoTransaction(instance.database, async (tx) => {
                await new StorageCleanupJournal(
                  {
                    query: (sql, values) =>
                      tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
                  },
                  'postgres',
                  SIDEDOOR_STATE_ID
                ).createJob(prepareStorageCleanup({ namespace: SIDEDOOR_STATE_ID, ...scope }));
                await sottoJobOutbox(tx).complete(record.job.id, record.fingerprint);
                await sottoJobOutbox(tx).erase(record.job.id, record.fingerprint, scope);
              });
            }
            return operation(queue);
          },
        })
      ).results;
      const failure = results.find((result) => result.status === 'failed');
      const recovered = published && !blocked && !deleted && !erased && !cleanup;
      if (recovered && failure?.status === 'failed') throw failure.error;
      expect(results).toMatchObject([
        { id: record.job.id, status: erased ? 'erased' : recovered ? 'complete' : 'failed' },
      ]);
      expect(
        await instance.database.interaction.findUniqueOrThrow({
          where: { id: payload.interactionId },
        })
      ).toMatchObject({
        status: published ? 'ANSWERED' : 'PENDING',
        answer: published ? 'Existing answer' : null,
      });
      expect(
        await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).receipt(record.job.id))
      ).toMatchObject({
        status: erased ? 'erased' : recovered || cleanup ? 'complete' : 'pending',
      });
      if (cleanup)
        expect(
          await sottoTransaction(instance.database, (tx) =>
            sottoJobExecutions(tx).blockingStatus(record.job.id, record.fingerprint)
          )
        ).toBe('cleanup-unconfirmed');
    }
  );

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

  it.each([1, 2])(
    'preserves synchronous writing v%s receipts without dispatching them to Redis',
    async (version) => {
      const record = await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).enqueue(
          prepareJob({
            namespace: SIDEDOOR_STATE_ID,
            handler: 'learning-writing',
            version,
            payload: { responseId: 'writing-response' },
            scopes: [{ subjectId: 'profile:test', generation: 1 }],
            delivery: { attempts: 1, priority: 0, availableAt: 0 },
          })
        )
      );
      expect((await reconcileSottoJobs(options())).results).toMatchObject([
        { id: record.job.id, status: 'delivered' },
      ]);
      expect(await queue.getJob(record.job.id)).toBeUndefined();
      expect(
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).receipt(record.job.id)
        )
      ).toMatchObject({ status: 'pending' });
    }
  );

  it('delivers queued assessment writing by reference without exposing its response', async () => {
    const writingQueue = new Queue('learning-writing', {
      connection,
      prefix: `writing-reconcile-${randomUUID()}`,
    });
    try {
      const record = await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).enqueue(
          prepareJob({
            namespace: SIDEDOOR_STATE_ID,
            handler: 'learning-writing',
            version: 3,
            payload: { text: 'private writing response' },
            scopes: [{ subjectId: 'profile:test', generation: 1 }],
            delivery: { attempts: 1, priority: 0, availableAt: 0 },
          })
        )
      );
      const result = await reconcileSottoJobs({
        ...options(),
        queues: new Map([[writingQueue.name, writingQueue]]),
      });
      expect(result.results).toMatchObject([{ id: record.job.id, status: 'delivered' }]);
      expect((await writingQueue.getJob(record.job.id))?.data).toEqual({
        operationId: record.job.id,
        fingerprint: record.fingerprint,
      });
    } finally {
      await writingQueue.obliterate({ force: true });
      await writingQueue.close();
    }
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

  it('keeps exhausted notification work pending without reporting a database outage', async () => {
    const record = await fixture(4);
    await deliverSottoJob({
      database: instance.database,
      queue,
      operationId: record.job.id,
      version: 4,
    });
    const worker = new Worker(
      queue.name,
      async () => {
        throw new Error('notification transport unavailable');
      },
      { connection, prefix: queue.opts.prefix, autorun: false }
    );
    try {
      const exhausted = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Notification job did not exhaust')), 5000);
        worker.on('failed', async (job) => {
          if (job?.id !== record.job.id || (await job.getState()) !== 'failed') return;
          clearTimeout(timer);
          resolve();
        });
      });
      void worker.run();
      await worker.waitUntilReady();
      await exhausted;
      const page = await reconcileSottoJobs(options());
      const result = page.results.find((item) => item.id === record.job.id);
      expect(result?.status).toBe('failed');
      if (!result || result.status !== 'failed') throw new Error('Expected terminal failure');
      expect(sottoJobFailureCode(result.error)).toBe('terminal_failed');
      expect(
        await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).receipt(record.job.id))
      ).toMatchObject({ status: 'pending', fingerprint: record.fingerprint });
      expect((await queue.getJob(record.job.id))?.name).toBe('notifications.v4');
    } finally {
      await worker.close();
    }
  });

  it('keeps malformed failed audio work pending for investigation', async () => {
    await queue.close();
    queue = new Queue('audio-generation', { connection, prefix: `reconcile-${randomUUID()}` });
    const record = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).enqueue(
        prepareJob({
          namespace: SIDEDOOR_STATE_ID,
          handler: queue.name,
          version: 1,
          payload: { invalid: true },
          scopes: [{ subjectId: 'profile:test', generation: 1 }],
          delivery: { attempts: 1, priority: 2, availableAt: 0 },
        })
      )
    );
    await deliverSottoJob({
      database: instance.database,
      queue,
      operationId: record.job.id,
      version: 1,
    });
    const worker = new Worker(
      queue.name,
      async () => {
        throw new Error('Synthetic audio failure');
      },
      { connection, prefix: queue.opts.prefix, autorun: false }
    );
    try {
      const failed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Audio job did not fail')), 5000);
        worker.on('failed', async (job) => {
          if (job?.id !== record.job.id || (await job.getState()) !== 'failed') return;
          clearTimeout(timer);
          resolve();
        });
      });
      void worker.run();
      await failed;
      const page = await reconcileSottoJobs(options());
      expect(page.results.find((item) => item.id === record.job.id)).toMatchObject({
        status: 'failed',
      });
      expect(
        await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).receipt(record.job.id))
      ).toMatchObject({ status: 'pending', fingerprint: record.fingerprint });
    } finally {
      await worker.close();
    }
  });

  it('records material recovery when a terminal queue failure event was missed', async () => {
    await queue.close();
    queue = new Queue('material-finalization', { connection, prefix: `reconcile-${randomUUID()}` });
    const user = await instance.database.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    const material = await instance.database.courseMaterial.create({
      data: {
        userId: user.id,
        name: 'retained-parts.pdf',
        mimeType: 'application/pdf',
        byteSize: 12,
        extractedText: '',
      },
    });
    const batch = await instance.database.materialUploadBatch.create({
      data: {
        userId: user.id,
        requestId: randomUUID(),
        fingerprint: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const operationId = randomUUID();
    const upload = await instance.database.materialUpload.create({
      data: {
        batchId: batch.id,
        materialId: material.id,
        clientId: randomUUID(),
        status: 'FINALIZING',
        finalizationOperationId: operationId,
        expiresAt: batch.expiresAt,
      },
    });
    const record = await sottoTransaction(instance.database, async (database) => {
      const storage = await materialStorageScopes(database, material);
      const scopes = [
        ...storage.scopes,
        { subjectId: `material-upload:${upload.id}`, generation: upload.createdAt.getTime() },
      ].sort((left, right) => left.subjectId.localeCompare(right.subjectId));
      return sottoJobOutbox(database).enqueue(
        prepareJob({
          id: operationId,
          namespace: SIDEDOOR_STATE_ID,
          handler: queue.name,
          version: 1,
          payload: {
            type: 'finalize_material_upload',
            payload: {
              userId: user.id,
              materialId: material.id,
              uploadId: upload.id,
              processingRevision: 1,
            },
            authority: {
              kind: 'material',
              materialId: material.id,
              userId: user.id,
              materialCreatedAt: material.createdAt.getTime(),
              processingRevision: 1,
              instanceId: storage.instanceId,
              inputSha256: null,
              scopes,
              upload: {
                id: upload.id,
                createdAt: upload.createdAt.getTime(),
                finalizationOperationId: operationId,
                expectedSha256: null,
              },
            },
          },
          scopes,
          delivery: { attempts: 1, priority: 0, availableAt: 0 },
        })
      );
    });
    await deliverSottoJob({ database: instance.database, queue, operationId, version: 1 });
    const worker = new Worker(
      queue.name,
      async () => {
        throw new Error('Synthetic finalization failure.');
      },
      { connection, prefix: queue.opts.prefix, autorun: false }
    );
    try {
      const exhausted = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Material job did not exhaust')), 5000);
        worker.on('failed', async (job) => {
          if (job?.id !== operationId || (await job.getState()) !== 'failed') return;
          clearTimeout(timer);
          resolve();
        });
      });
      void worker.run();
      await worker.waitUntilReady();
      await exhausted;
      expect((await reconcileSottoJobs(options())).results).toMatchObject([
        { id: operationId, status: 'complete' },
      ]);
      expect(
        await instance.database.materialUpload.findUniqueOrThrow({ where: { id: upload.id } })
      ).toMatchObject({
        status: 'FAILED',
        failureReason: expect.stringContaining('parts are retained'),
      });
      expect(
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).receipt(operationId)
        )
      ).toMatchObject({ status: 'complete', fingerprint: record.fingerprint });
      expect((await reconcileSottoJobs(options())).results).toEqual([]);
    } finally {
      await worker.close();
    }
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

  it('does not report a canceled pass as failed during shutdown', async () => {
    const record = await fixture();
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const results: unknown[] = [];
    const failures: unknown[] = [];
    const loop = startSottoJobReconciliation({
      database: instance.database,
      queues: options().queues,
      withQueue: async <Result>(_name: string, signal: AbortSignal) => {
        resolveStarted();
        return new Promise<Result>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      onResults: (page) => {
        results.push(...page);
      },
      onError: (error) => {
        failures.push(error);
        return undefined;
      },
    });
    await started;
    await loop.stop();
    expect(results).toEqual([]);
    expect(failures).toEqual([]);
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).receipt(record.job.id))
    ).toMatchObject({ status: 'pending', fingerprint: record.fingerprint });
  });
});

describe('durable queue contract isolation', () => {
  it('accepts legacy and class-scoped worksheet jobs but rejects unknown versions', () => {
    for (const version of [1, 2]) {
      expect(() =>
        validateSottoQueueContract('worksheet-pdf', {
          name: `worksheet-pdf.v${version}`,
          data: { operationId: 'operation', fingerprint: 'fingerprint' },
        })
      ).not.toThrow();
    }
    expect(() =>
      validateSottoQueueContract('worksheet-pdf', {
        name: 'worksheet-pdf.v3',
        data: { operationId: 'operation', fingerprint: 'fingerprint' },
      })
    ).toThrow();
  });
  it('accepts assessment speaking jobs without accepting unknown versions', () => {
    const data = { operationId: randomUUID(), fingerprint: 'a'.repeat(64) };
    expect(() =>
      validateSottoQueueContract('speaking-grading', { name: 'speaking-grading.v3', data })
    ).not.toThrow();
    expect(() =>
      validateSottoQueueContract('speaking-grading', { name: 'speaking-grading.v4', data })
    ).toThrow();
  });
  it('accepts supported interaction jobs while rejecting unknown versions', () => {
    const data = { operationId: randomUUID(), fingerprint: 'a'.repeat(64) };
    for (const name of [
      'interactions.v1',
      'interactions.v2',
      'interactions.v3',
      'interactions.v4',
      'interactions.v5',
      'interactions.v6',
    ])
      expect(() => validateSottoQueueContract('interactions', { name, data })).not.toThrow();
    expect(() =>
      validateSottoQueueContract('interactions', { name: 'interactions.v7', data })
    ).toThrow();
  });
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
