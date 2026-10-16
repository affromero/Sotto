// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { describe, expect, it } from 'vitest';
import { finishAudioWorkerJobs } from '../../helpers/runtime/full-audio-admission';

const redisUrl = process.env.SIDEDOOR_TEST_REDIS_URL;

describe.skipIf(!redisUrl)('audio worker completion observation', () => {
  it('observes completion after draining a job that was active at the polling deadline', async () => {
    const url = new URL(redisUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use disposable local Redis database 15');
    const directory = await mkdtemp(join(tmpdir(), 'sotto-audio-completion-'));
    const output = join(directory, 'published.txt');
    const connection = new Redis(redisUrl!, { maxRetriesPerRequest: null });
    const name = `audio-completion-${randomUUID()}`;
    const queue = new Queue(name, { connection });
    const processing = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    const worker = new Worker(
      name,
      async () => {
        processing.resolve();
        await released.promise;
        await appendFile(output, 'published\n', { mode: 0o600 });
        return { audioUrl: 'local://published.wav' };
      },
      { connection }
    );
    const failed = Promise.withResolvers<never>();
    worker.on('failed', (...failure) => failed.reject(failure[1]));
    worker.on('error', failed.reject);
    let job: Job | undefined;
    let draining: Promise<string[]> | undefined;
    try {
      job = await queue.add('publish', {}, { attempts: 1 });
      await Promise.race([processing.promise, failed.promise]);
      expect(await job.getState()).toBe('active');
      const closing = new Promise<void>((resolve) => worker.once('closing', () => resolve()));
      let settled = false;
      draining = finishAudioWorkerJobs(worker, [job], Date.now() - 1);
      void draining.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await Promise.race([closing, failed.promise]);
      expect(settled).toBe(false);
      expect(await job.getState()).toBe('active');
      released.resolve();
      expect(await draining).toEqual(['completed']);
      const saved = await queue.getJob(job.id!);
      expect(await saved?.getState()).toBe('completed');
      expect(saved?.returnvalue).toEqual({ audioUrl: 'local://published.wav' });
      expect(saved?.attemptsMade).toBe(1);
      expect(await readFile(output, 'utf8')).toBe('published\n');
    } finally {
      released.resolve();
      await draining?.catch(() => {});
      await worker.close();
      const cleanup = await Promise.allSettled([
        (async () => {
          try {
            await job?.remove();
          } finally {
            await queue.close().finally(() => connection.quit());
          }
        })(),
        rm(directory, { recursive: true }),
      ]);
      expect(cleanup.every((result) => result.status === 'fulfilled')).toBe(true);
    }
  });
});
