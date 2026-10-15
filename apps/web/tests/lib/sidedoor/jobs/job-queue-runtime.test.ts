// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { GenerateAudioPayload } from '@/lib/queue';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
const admission = vi.hoisted(() => ({ blocked: null as (() => void) | null }));
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return boundary.database;
  },
  get prismaUnfiltered() {
    return boundary.database;
  },
}));
vi.mock('@/lib/sidedoor/storage/core/storage-connection', async (original) => {
  const actual = await original<typeof import('@/lib/sidedoor/storage/core/storage-connection')>();
  return {
    ...actual,
    openSottoStorageConnection: async (
      ...parameters: Parameters<typeof actual.openSottoStorageConnection>
    ) => {
      const connection = await actual.openSottoStorageConnection(...parameters);
      return {
        ...connection,
        query: async (sql: string, values: readonly unknown[]) => {
          const rows = await connection.query(sql, values);
          if (sql.includes('pg_try_advisory_lock') && rows[0]?.acquired === false)
            admission.blocked?.();
          return rows;
        },
      };
    },
  };
});

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;

suite('durable worker queue boundaries', () => {
  let instance: SharedTestInstance;
  let control: Redis;
  let runtime: typeof import('@/lib/queue');
  let state: typeof import('@/lib/sidedoor/access/state/transaction');
  let writer: typeof import('@/lib/sidedoor/access/state/write-transaction');
  let durable: typeof import('@/lib/sidedoor/jobs/core/durable-queue');
  let delivery: typeof import('@/lib/sidedoor/jobs/core/job-delivery');
  let executions: typeof import('@/lib/sidedoor/jobs/core/job-execution-lifetime');
  beforeAll(async () => {
    const url = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use disposable local Redis database 15');
    vi.stubEnv('REDIS_URL', url.toString());
    instance = await createSharedTestInstance('queue_runtime');
    boundary.database = instance.database;
    control = new Redis(url.toString(), { maxRetriesPerRequest: 1 });
    runtime = await import('@/lib/queue');
    state = await import('@/lib/sidedoor/access/state/transaction');
    writer = await import('@/lib/sidedoor/access/state/write-transaction');
    durable = await import('@/lib/sidedoor/jobs/core/durable-queue');
    delivery = await import('@/lib/sidedoor/jobs/core/job-delivery');
    executions = await import('@/lib/sidedoor/jobs/core/job-execution-lifetime');
  });
  afterAll(async () => {
    await control?.quit();
    await (await import('@/lib/redis')).closeRedis();
    await instance?.close();
    vi.unstubAllEnvs();
  });

  it('settles a pending queue command on cancellation while Redis stops answering writes', async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const operation = runtime.withDispatchQueue(
      `test-${randomUUID()}`,
      controller.signal,
      async (queue) => {
        await control.call('CLIENT', 'PAUSE', '1500', 'WRITE');
        const pending = queue.add('test', { test: true });
        entered();
        return pending;
      }
    );
    const result = operation.then(
      () => 'accepted',
      () => 'rejected'
    );
    try {
      await ready;
      controller.abort();
      expect(await result).toBe('rejected');
    } finally {
      controller.abort();
    }
  });

  it('aborts while the Redis connection is waiting for its initial handshake', async () => {
    let connected!: () => void;
    const ready = new Promise<void>((resolve) => {
      connected = resolve;
    });
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      connected();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    const redis = await import('@/lib/redis');
    const factory = vi
      .spyOn(redis, 'createRedisConnection')
      .mockImplementationOnce((name, options = {}) => {
        expect(name).toMatch(/^dispatch:/);
        const client = new Redis(address.port, '127.0.0.1', options);
        client.on('error', () => undefined);
        return client;
      });
    const controller = new AbortController();
    let accepted = false;
    const pending = runtime.withDispatchQueue('handshake-test', controller.signal, async () => {
      accepted = true;
    });
    const outcome = pending.then(
      () => 'accepted',
      () => 'rejected'
    );
    try {
      await ready;
      controller.abort();
      expect(await outcome).toBe('rejected');
      expect(accepted).toBe(false);
    } finally {
      controller.abort();
      factory.mockRestore();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('rejects initial connection failure without starting delivery', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    const redis = await import('@/lib/redis');
    const factory = vi
      .spyOn(redis, 'createRedisConnection')
      .mockImplementationOnce((name, options = {}) => {
        expect(name).toMatch(/^dispatch:/);
        const client = new Redis(address.port, '127.0.0.1', options);
        client.on('error', () => undefined);
        return client;
      });
    let accepted = false;
    try {
      await expect(
        runtime.withDispatchQueue('unavailable-test', new AbortController().signal, async () => {
          accepted = true;
        })
      ).rejects.toThrow();
      expect(accepted).toBe(false);
    } finally {
      factory.mockRestore();
    }
  });

  it('rejects unknown durable jobs without running processing or failure mutations', async () => {
    const identity = await instance.reset();
    const episode = await instance.database.episode.create({
      data: {
        userId: identity.ownerId,
        title: 'Protected lesson',
        topic: 'Topic',
        status: 'STITCHING',
      },
    });
    const name = `test-unknown-${randomUUID()}`;
    const queue = new Queue(name, { connection: control });
    let processed = false;
    const worker = runtime.createWorker(name, async () => {
      processed = true;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const failed = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Unknown job was not rejected')), 3000);
      worker.on('failed', () => resolve());
    });
    try {
      await worker.waitUntilReady();
      await queue.add(
        `${name}.v99`,
        { operationId: randomUUID(), fingerprint: 'a'.repeat(64), episodeId: episode.id },
        { attempts: 1 }
      );
      await failed;
      expect(processed).toBe(false);
      expect(
        await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })
      ).toEqual(episode);
      expect(
        await instance.database.pipelineEvent.count({ where: { episodeId: episode.id } })
      ).toBe(0);
    } finally {
      clearTimeout(timer);
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });

  for (const { name, cancel } of [
    {
      name: 'keeps published output pending until the shared writer releases admission',
      cancel: false,
    },
    {
      name: 'resumes cancelled completion with the same output and no repeated provider request',
      cancel: true,
    },
  ]) {
    it(name, async () => {
      const identity = await instance.reset();
      const episode = await instance.database.episode.create({
        data: {
          userId: identity.ownerId,
          title: 'Protected listening',
          topic: 'Completed activities',
          status: 'GENERATING_AUDIO',
          audioGenerationKey: randomUUID(),
        },
      });
      const segment = await instance.database.segment.create({
        data: { episodeId: episode.id, speaker: 'HOST', text: 'Saved speech.', order: 0 },
      });
      const queue = runtime.createQueue('audio-generation');
      const published = barrier();
      const returnOutput = barrier();
      const entered = barrier();
      const releaseWriter = barrier();
      const waiting = barrier();
      const completed = barrier();
      const failed = barrier();
      const requests: string[] = [];
      const failures: string[] = [];
      admission.blocked = waiting.release;
      vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.url !== 'https://speech.example.test/tts')
          throw new Error('Unexpected provider request');
        requests.push(await request.text());
        return new Response('published-speech');
      });
      const queued = await durable.admitDurableQueueJob({
        queue,
        type: 'generate_audio',
        jobId: segment.id,
        attempts: 1,
        payload: {
          episodeId: episode.id,
          audioGenerationKey: episode.audioGenerationKey!,
          segmentId: segment.id,
          segmentVersion: segment.version,
          speaker: segment.speaker,
          text: segment.text,
        },
        authorize: async () => ({ userId: identity.ownerId }),
        mutate: async () => {},
      });
      if (!queued.id) throw new Error('Missing durable operation identity');
      const operationId = queued.id;
      const receipt = () =>
        state.sottoTransaction(instance.database, (tx) =>
          delivery.sottoJobOutbox(tx).read(operationId)
        );
      const worker = runtime.createWorker<GenerateAudioPayload>(
        'audio-generation',
        async (job) => {
          const current = await instance.database.segment.findUniqueOrThrow({
            where: { id: job.data.segmentId },
          });
          if (current.audioUrl) return current.audioUrl;
          const response = await fetch('https://speech.example.test/tts', {
            method: 'POST',
            body: job.data.text,
          });
          const output = await response.text();
          await instance.database.segment.update({
            where: { id: current.id },
            data: { audioUrl: output },
          });
          published.release();
          await returnOutput.promise;
          return output;
        },
        { concurrency: 1 }
      );
      worker.on('completed', completed.release);
      worker.on('failed', (...[, error]) => {
        failures.push(error.message);
        failed.release();
      });
      let holder: Promise<void> | undefined;
      try {
        await worker.waitUntilReady();
        await Promise.race([
          published.promise,
          failed.promise.then(() => {
            throw new Error(`Worker failed before publishing output: ${failures.join('; ')}`);
          }),
        ]);
        holder = writer.sottoStateWriteTransaction(
          instance.database,
          async () => {
            entered.release();
            await releaseWriter.promise;
          },
          new AbortController().signal
        );
        void holder.catch(() => failed.release());
        await Promise.race([entered.promise, failed.promise]);
        returnOutput.release();
        const observed = await Promise.race([
          waiting.promise.then(() => 'waiting'),
          completed.promise.then(() => 'completed'),
          failed.promise.then(() => 'failed'),
        ]);
        expect(failures).toEqual([]);
        expect(observed).toBe('waiting');
        expect((await receipt())?.complete).toBe(false);
        expect(await queued.getState()).toBe('active');
        expect(
          (await instance.database.segment.findUniqueOrThrow({ where: { id: segment.id } }))
            .audioUrl
        ).toBe('published-speech');
        if (cancel) {
          await worker.pause(true);
          expect(worker.cancelJob(operationId)).toBe(true);
          await expect.poll(() => queued.getState()).toBe('waiting');
          expect((await receipt())?.complete).toBe(false);
        }
        releaseWriter.release();
        await holder;
        if (cancel) await worker.resume();
        await expect.poll(() => queued.getState(), { timeout: 5000 }).toBe('completed');
        await worker.close();
        const retained = await receipt();
        expect(retained?.complete).toBe(true);
        expect(
          await state.sottoTransaction(instance.database, (tx) =>
            executions.sottoJobExecutions(tx).blockingStatus(operationId, retained!.fingerprint)
          )
        ).toBeNull();
        expect(
          (await instance.database.segment.findUniqueOrThrow({ where: { id: segment.id } }))
            .audioUrl
        ).toBe('published-speech');
        expect(requests).toEqual([segment.text]);
        expect(failures).toEqual([]);
        expect(
          (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).status
        ).toBe('GENERATING_AUDIO');
        expect(
          await instance.database.notification.count({ where: { userId: identity.ownerId } })
        ).toBe(0);
      } finally {
        returnOutput.release();
        releaseWriter.release();
        try {
          await holder;
        } finally {
          admission.blocked = null;
          await worker.close().finally(async () => {
            await queue.obliterate({ force: true }).finally(async () => {
              await queue.close().finally(() => vi.unstubAllGlobals());
            });
          });
        }
      }
    });
  }
});
