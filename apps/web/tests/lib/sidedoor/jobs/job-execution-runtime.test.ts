// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { abortable } from 'thesidedoor-core/runtime/stream';
import { executeSottoJob } from '@/lib/sidedoor/jobs/core/job-execution';

const suite = process.env.SIDEDOOR_TEST_REDIS_URL ? describe : describe.skip;
suite('durable cancellation with native BullMQ transitions', () => {
  let connection: Redis;
  let queue: Queue;
  let workers: Worker[];
  beforeAll(() => {
    const url = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use disposable local Redis database 15');
    connection = new Redis(url.toString(), { maxRetriesPerRequest: null });
  });
  beforeEach(() => {
    queue = new Queue(`sotto-cancellation-${randomUUID()}`, { connection });
    workers = [];
  });
  afterEach(async () => {
    for (const worker of workers) {
      await worker.pause(true);
      worker.cancelAllJobs();
      await worker.close();
    }
    await queue.obliterate({ force: true });
    await queue.close();
  });
  afterAll(async () => {
    await connection.quit();
  });

  it.each(['settled', 'node-abort', 'cleanup-failed'] as const)(
    'handles cancellation after cleanup is %s',
    async (cleanup) => {
      let started!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      let cleaned = false;
      const failures: Error[] = [];
      const worker = new Worker(
        queue.name,
        (job, token, signal) =>
          executeSottoJob(
            job,
            async (...[, nativeSignal]) => {
              if (!nativeSignal) throw new Error('Missing native cancellation signal');
              try {
                if (cleanup === 'node-abort') {
                  const waiting = delay(60000, undefined, { signal: nativeSignal });
                  started();
                  await waiting;
                  return;
                }
                await new Promise<void>((...[, reject]) => {
                  nativeSignal.addEventListener('abort', () => reject(nativeSignal.reason), {
                    once: true,
                  });
                  started();
                });
              } catch (error) {
                if (cleanup === 'cleanup-failed')
                  throw new AggregateError(
                    [error, new Error('Cleanup did not settle')],
                    'Cleanup failed',
                    { cause: error }
                  );
                throw error;
              } finally {
                cleaned = true;
              }
            },
            token,
            signal
          ),
        { connection }
      );
      workers.push(worker);
      worker.on('failed', (...args) => {
        failures.push(args[1]);
      });
      await worker.waitUntilReady();
      const queued = await queue.add(
        'example.v1',
        { operationId: randomUUID(), fingerprint: 'a'.repeat(64) },
        { attempts: 1 }
      );
      await abortable(entered, AbortSignal.timeout(3000));
      await worker.pause(true);
      expect(worker.cancelJob(queued.id!)).toBe(true);
      await expect
        .poll(async () => (await queue.getJob(queued.id!))?.getState())
        .toBe(cleanup === 'cleanup-failed' ? 'failed' : 'waiting');
      expect(cleaned).toBe(true);
      expect(await connection.get(`${queue.toKey(queued.id!)}:lock`)).toBeNull();
      expect((await queue.getJob(queued.id!))?.attemptsMade).toBe(
        cleanup === 'cleanup-failed' ? 1 : 0
      );
      if (cleanup === 'cleanup-failed') {
        expect(failures[0]).toBeInstanceOf(AggregateError);
        expect(failures[0]?.message).toBe('Cleanup failed');
        return;
      }
      expect(failures).toEqual([]);
      await worker.close();
      const replacement = new Worker(queue.name, async () => 'resumed', { connection });
      workers.push(replacement);
      const completed = new Promise<unknown>((resolve) =>
        replacement.once('completed', (...args) => resolve(args[1]))
      );
      expect(await abortable(completed, AbortSignal.timeout(3000))).toBe('resumed');
      expect(await (await queue.getJob(queued.id!))!.getState()).toBe('completed');
    }
  );
});
