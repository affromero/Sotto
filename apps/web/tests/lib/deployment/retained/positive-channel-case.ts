import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { expect, it } from 'vitest';
import {
  captureReviewFirstWorkerEvidence,
  type ReviewFirstWorkerEvidence,
} from '../../../../../../scripts/deploy/review/first-worker';
import type { SharedTestInstance } from '../../../helpers/setup/shared-instance';
import { createPrivateRedis } from '../../../helpers/queue/private-redis';

type Context = {
  instance: SharedTestInstance;
  evidence: ReviewFirstWorkerEvidence;
  redis: Redis;
  redisUrl: string;
  enqueueHistoricalDeliveries: () => Promise<Queue>;
};

export function registerRetainedChannelCase(context: () => Context) {
  it('observes the actual retained jobs and refuses changed evidence without writes', async () => {
    const { instance, evidence, redis, redisUrl, enqueueHistoricalDeliveries } = context();
    const queue = await enqueueHistoricalDeliveries();
    const endpoint = new URL(redisUrl);
    const worker = new Worker(
      queue.name,
      async () => {
        throw new Error('Worksheet class changed before generation');
      },
      {
        connection: {
          host: endpoint.hostname,
          port: Number(endpoint.port),
          db: 0,
          maxRetriesPerRequest: null,
        },
        concurrency: 1,
        stalledInterval: 50,
      }
    );
    const workerErrors: Error[] = [];
    worker.on('error', (error) => workerErrors.push(error));
    try {
      await expect.poll(() => queue.getFailedCount(), { timeout: 10_000 }).toBe(3);
      await worker.close();
      await expect
        .poll(() => redis.exists('bull:worksheet-pdf:stalled-check'), { timeout: 5000 })
        .toBe(0);
      const admitted = await captureReviewFirstWorkerEvidence(instance.database, {
        namespace: evidence.namespace,
        jobs: evidence.jobs.map(({ id }) => ({ id })),
      });
      const snapshot = async () => {
        const keys = (await redis.keys('*')).sort();
        return Promise.all(
          keys.map(async (key) => [key, await redis.callBuffer('DUMP', key), await redis.pttl(key)])
        );
      };
      const before = await snapshot();
      const beforeState = await instance.database.sidedoorState.findMany({
        orderBy: { id: 'asc' },
      });
      const policy = {
        schemaVersion: 1,
        webHeapMiB: 256,
        workerHeapMiB: 512,
        helperHeapMiB: 192,
        queueConcurrency: 1,
        privacyContactEmail: 'operator@example.com',
      };
      const run = (
        value: ReviewFirstWorkerEvidence,
        queues = ['worksheet-pdf'],
        mode = 'retained-inventory',
        targetRedisUrl = redisUrl
      ) =>
        new Promise<{ code: number | null; result: unknown; fences: number; errors: string }>(
          (resolve, reject) => {
            const bootstrap = `const {PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=require('./src/generated/prisma/client');
const schema=process.env.SOTTO_TEST_SCHEMA;
const database=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema+',public',max:4},{schema})});
const path=require.resolve('./src/lib/prisma.ts');
require.cache[path]={id:path,filename:path,loaded:true,exports:{prismaUnfiltered:database}};
require('../../scripts/deploy/review/runtime/channel.ts').main().catch(error=>{console.error(error);process.exit(1)})`;
            const child = spawn(process.execPath, ['--require', 'tsx/cjs', '-e', bootstrap], {
              env: {
                ...process.env,
                NODE_ENV: 'test',
                DATABASE_URL: process.env.SIDEDOOR_TEST_DATABASE_URL,
                REDIS_URL: targetRedisUrl,
                SOTTO_TEST_SCHEMA: instance.schema,
              },
              stdio: ['pipe', 'pipe', 'pipe'],
            });
            let buffer = '',
              errors = '',
              fences = 0;
            let result: unknown;
            let failure: Error | undefined;
            const fail = (error: Error) => {
              failure ??= error;
              child.kill('SIGKILL');
            };
            const timer = setTimeout(() => {
              fail(new Error('Channel timed out'));
            }, 30_000);
            child.stdout.on('data', (chunk: Buffer) => {
              buffer += chunk.toString();
              while (buffer.includes('\n')) {
                const end = buffer.indexOf('\n');
                const line = buffer.slice(0, end);
                buffer = buffer.slice(end + 1);
                if (!line.startsWith('SOTTO_REVIEW_IPC=')) continue;
                const event = JSON.parse(line.slice('SOTTO_REVIEW_IPC='.length));
                if (event.type === 'fence') {
                  fences++;
                  child.stdin.write(JSON.stringify({ type: 'ack', id: event.id }) + '\n');
                } else if (event.type === 'result') {
                  result = event.value;
                  child.stdin.end();
                } else {
                  fail(new Error('Unexpected channel event'));
                }
              }
            });
            child.stderr.on('data', (chunk: Buffer) => {
              errors += chunk.toString();
            });
            child.once('error', (error) => {
              failure ??= error;
            });
            child.once('close', (code) => {
              clearTimeout(timer);
              if (failure) {
                reject(failure);
                return;
              }
              resolve({ code, result, fences, errors });
            });
            child.stdin.write(
              JSON.stringify({
                mode,
                input: { evidence: value, queues },
                policy,
              }) + '\n'
            );
          }
        );
      const accepted = await run(admitted);
      expect(accepted).toMatchObject({ code: 0, fences: 2, result: { queues: 1, failed: 3 } });
      expect(await snapshot()).toEqual(before);
      expect(await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } })).toEqual(
        beforeState
      );
      const changed = structuredClone(admitted);
      changed.jobs[0].fingerprint = '0'.repeat(64);
      const rejected = await run(changed);
      expect(rejected.code).toBe(1);
      expect(rejected.errors).toMatch(/receipt|evidence/i);
      const missingQueue = await run(admitted, ['other-queue', 'worksheet-pdf']);
      expect(missingQueue.code).toBe(1);
      expect(missingQueue.errors).toMatch(/missing|unexpected/i);
      expect(await snapshot()).toEqual(before);
      expect(await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } })).toEqual(
        beforeState
      );
      const isolated = await createPrivateRedis();
      try {
        const keys = (await redis.keys('*')).sort();
        for (const key of keys) {
          const payload = await redis.callBuffer('DUMP', key);
          expect(Buffer.isBuffer(payload)).toBe(true);
          if (!Buffer.isBuffer(payload)) throw new Error('Retained Redis key disappeared');
          expect(await redis.pttl(key)).toBe(-1);
          await isolated.client.restore(key, 0, payload);
        }
        const cloneBefore = await Promise.all(
          keys.map(async (key) => [key, await isolated.client.callBuffer('DUMP', key)])
        );
        const closed = once(isolated.client, 'close');
        isolated.client.disconnect();
        await closed;
        const strict = await run(
          admitted,
          ['worksheet-pdf'],
          'retained-single-client',
          isolated.url
        );
        expect(strict).toMatchObject({ code: 0, result: { queues: 1, failed: 3 } });
        await isolated.client.connect();
        expect((await isolated.client.keys('*')).sort()).toEqual(keys);
        for (const [index, key] of keys.entries()) {
          expect(await isolated.client.callBuffer('DUMP', key)).toEqual(cloneBefore[index][1]);
          expect(await isolated.client.pttl(key)).toBe(-1);
        }
        const extraClient = await run(
          admitted,
          ['worksheet-pdf'],
          'retained-single-client',
          isolated.url
        );
        expect(extraClient.code).toBe(1);
        expect(extraClient.errors).toContain('Unexpected Redis client');
        expect((await isolated.client.keys('*')).sort()).toEqual(keys);
        for (const [index, key] of keys.entries()) {
          expect(await isolated.client.callBuffer('DUMP', key)).toEqual(cloneBefore[index][1]);
        }
      } finally {
        await isolated.close();
      }
      expect(workerErrors).toEqual([]);
    } finally {
      await worker.close();
      await queue.close();
    }
  }, 60_000);
}
