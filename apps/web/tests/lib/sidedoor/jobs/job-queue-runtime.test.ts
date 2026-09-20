// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({
  get prismaUnfiltered() {
    return boundary.database;
  },
}));
const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;

suite('durable worker queue boundaries', () => {
  let instance: SharedTestInstance;
  let control: Redis;
  let runtime: typeof import('@/lib/queue');
  beforeAll(async () => {
    const url = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use disposable local Redis database 15');
    vi.stubEnv('REDIS_URL', url.toString());
    instance = await createSharedTestInstance('queue_runtime');
    boundary.database = instance.database;
    control = new Redis(url.toString(), { maxRetriesPerRequest: 1 });
    runtime = await import('@/lib/queue');
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
});
