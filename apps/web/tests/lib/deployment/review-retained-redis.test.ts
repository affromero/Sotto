// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Queue, QueueEvents, Worker } from 'bullmq';
import Redis from 'ioredis';
import { inspectRetainedReviewRedis } from '../../../../../scripts/deploy/review/runtime/inventory/retained-redis';
import { createExclusiveRedisObserver } from '../../../../../scripts/deploy/review/runtime/inventory/redis-clients';
import { createPrivateRedis } from '../../helpers/queue/private-redis';

describe('retained review Redis inventory', () => {
  let fixture: Awaited<ReturnType<typeof createPrivateRedis>>;
  const queues = ['audio-generation', 'worksheet-pdf'];
  const failedWorksheetIds = ['failure-1', 'failure-2', 'failure-3'];

  beforeAll(async () => {
    fixture = await createPrivateRedis();
  });
  afterAll(async () => {
    await fixture?.close();
  });
  beforeEach(async () => {
    const redis = fixture.client;
    await redis.flushdb();
    for (const queue of queues) {
      const prefix = `bull:${queue}:`;
      await redis.hset(prefix + 'meta', 'opts.maxLenEvents', '10000');
      await redis.xadd(prefix + 'events', '*', 'event', 'waiting');
      await redis.set(prefix + 'id', '3');
    }
    await redis.zadd('bull:audio-generation:completed', 1, 'completed-1');
    await redis.hset('bull:audio-generation:completed-1', 'data', '{"value":1}');
    for (const [index, id] of failedWorksheetIds.entries()) {
      await redis.zadd('bull:worksheet-pdf:failed', index + 1, id);
      await redis.hset(`bull:worksheet-pdf:${id}`, 'data', JSON.stringify({ id }));
    }
  });

  const inspect = () =>
    inspectRetainedReviewRedis(fixture.client, {
      redisUrl: fixture.url,
      queues,
      failedWorksheetIds,
    });

  it('observes retained completed and failed jobs without changing them', async () => {
    const first = await inspect();
    const second = await inspect();
    expect(first).toEqual(second);
    expect(first).toMatchObject({ queues: 2, completed: 1, failed: 3, keys: 12 });
  });

  it('refuses retained evidence if another client appears between observations', async () => {
    const observer = createExclusiveRedisObserver(fixture.client);
    let stranger: Redis | undefined;
    let checks = 0;
    try {
      await expect(
        inspectRetainedReviewRedis(
          fixture.client,
          { redisUrl: fixture.url, queues, failedWorksheetIds },
          async () => {
            if (++checks === 2) {
              stranger = new Redis(fixture.url, { db: 1, maxRetriesPerRequest: 0 });
              await stranger.ping();
            }
            await observer.verify();
          }
        )
      ).rejects.toThrow('Unexpected Redis client');
      expect(await fixture.client.zcard('bull:worksheet-pdf:failed')).toBe(3);
    } finally {
      observer.close();
      await stranger?.quit();
    }
  });

  it('binds both retained job contents and sorted-set scores', async () => {
    const initial = await inspect();
    await fixture.client.hset('bull:worksheet-pdf:failure-1', 'data', '{"changed":true}');
    const changedJob = await inspect();
    expect(changedJob.fingerprint).not.toBe(initial.fingerprint);
    expect(changedJob.jobsFingerprint).not.toBe(initial.jobsFingerprint);
    await fixture.client.zadd('bull:audio-generation:completed', 9, 'completed-1');
    const changedScore = await inspect();
    expect(changedScore.fingerprint).not.toBe(changedJob.fingerprint);
    expect(changedScore.jobsFingerprint).not.toBe(changedJob.jobsFingerprint);
  });

  it('separates queue pause metadata from retained job evidence', async () => {
    const initial = await inspect();
    const endpoint = new URL(fixture.url);
    const queue = new Queue('worksheet-pdf', {
      connection: { host: endpoint.hostname, port: Number(endpoint.port), db: 0 },
      skipMetasUpdate: true,
    });
    try {
      await queue.pause();
      const paused = await inspect();
      expect(paused.fingerprint).not.toBe(initial.fingerprint);
      expect(paused.jobsFingerprint).toBe(initial.jobsFingerprint);
    } finally {
      await queue.resume();
      await queue.close();
    }
  });

  it('retains a queue sequence after its completed history was trimmed', async () => {
    await fixture.client.del(
      'bull:audio-generation:completed',
      'bull:audio-generation:completed-1'
    );
    expect(await inspect()).toMatchObject({ completed: 0, failed: 3 });
  });

  it('reads queues produced by real BullMQ workers', async () => {
    await fixture.client.flushdb();
    const endpoint = new URL(fixture.url);
    const connection = {
      host: endpoint.hostname,
      port: Number(endpoint.port),
      db: 0,
      maxRetriesPerRequest: null,
    };
    const created = queues.map((name) => ({
      queue: new Queue(name, { connection }),
      events: new QueueEvents(name, { connection }),
      worker: new Worker(
        name,
        async (job) => {
          if (job.name === 'failure') throw new Error('Expected fixture failure');
          return 'done';
        },
        { connection, stalledInterval: 50 }
      ),
    }));
    try {
      await Promise.all(created.map(({ events }) => events.waitUntilReady()));
      const completed = await created[0].queue.add('success', {});
      const failed = await Promise.all(
        failedWorksheetIds.map((jobId) =>
          created[1].queue.add('failure', {}, { jobId, attempts: 1 })
        )
      );
      await completed.waitUntilFinished(created[0].events, 5000);
      const outcomes = await Promise.allSettled(
        failed.map((job) => job.waitUntilFinished(created[1].events, 5000))
      );
      expect(
        outcomes.every(
          (result) =>
            result.status === 'rejected' &&
            String(result.reason).includes('Expected fixture failure')
        )
      ).toBe(true);
    } finally {
      await Promise.all(created.map(({ worker }) => worker.close()));
      await Promise.all(created.flatMap(({ queue, events }) => [queue.close(), events.close()]));
    }
    const deadline = Date.now() + 5000;
    while (await fixture.client.exists(...queues.map((name) => `bull:${name}:stalled-check`))) {
      if (Date.now() >= deadline) throw new Error('Fixture worker heartbeat did not expire');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(await inspect()).toMatchObject({ queues: 2, completed: 1, failed: 3 });
  });

  it.each([
    [
      'unknown key',
      async () => {
        await fixture.client.set('unowned', 'value');
      },
    ],
    [
      'missing job',
      async () => {
        await fixture.client.del('bull:worksheet-pdf:failure-1');
      },
    ],
    [
      'orphan job',
      async () => {
        await fixture.client.hset('bull:worksheet-pdf:orphan', 'data', '{}');
      },
    ],
    [
      'active work',
      async () => {
        await fixture.client.lpush('bull:worksheet-pdf:active', 'failure-1');
      },
    ],
    [
      'scheduler metadata',
      async () => {
        await fixture.client.zadd('bull:worksheet-pdf:repeat', 1, 'unexpected');
      },
    ],
    [
      'delayed queue marker',
      async () => {
        await fixture.client.zadd('bull:worksheet-pdf:marker', 1, '1');
      },
    ],
    [
      'multiple queue markers',
      async () => {
        await fixture.client.zadd('bull:worksheet-pdf:marker', 0, '0', 1, '1');
      },
    ],
    [
      'job lock',
      async () => {
        await fixture.client.set('bull:worksheet-pdf:failure-1:lock', 'owner');
      },
    ],
    [
      'expiring retained key',
      async () => {
        await fixture.client.expire('bull:worksheet-pdf:failure-1', 60);
      },
    ],
  ])('rejects %s', async (_name, change) => {
    await change();
    await expect(inspect()).rejects.toThrow();
  });

  it('rejects a failed delivery outside the independently admitted set', async () => {
    await fixture.client.zrem('bull:worksheet-pdf:failed', 'failure-1');
    await fixture.client.zadd('bull:worksheet-pdf:failed', 1, 'replacement');
    await fixture.client.rename('bull:worksheet-pdf:failure-1', 'bull:worksheet-pdf:replacement');
    await expect(inspect()).rejects.toThrow('Failed delivery identities changed');
  });

  it('rejects a connection that selected a different Redis database', async () => {
    await fixture.client.select(1);
    try {
      await expect(inspect()).rejects.toThrow('Redis client database changed');
    } finally {
      await fixture.client.select(0);
    }
  });

  it('rejects an oversized retained job before transferring its contents', async () => {
    await fixture.client.eval(
      "return redis.call('HSET', KEYS[1], 'large', string.rep('x', 34603008))",
      1,
      'bull:worksheet-pdf:failure-1'
    );
    await expect(inspect()).rejects.toThrow('Redis data bound exceeded');
  });
});
