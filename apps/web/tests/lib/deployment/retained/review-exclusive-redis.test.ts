// @vitest-environment node
import { EventEmitter, once } from 'node:events';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExclusiveRedisObserver } from '../../../../../../scripts/deploy/review/runtime/inventory/redis-clients';
import { createPrivateRedis } from '../../../helpers/queue/private-redis';

describe('review Redis observer', () => {
  let fixture: Awaited<ReturnType<typeof createPrivateRedis>>;

  beforeEach(async () => {
    fixture = await createPrivateRedis();
  });
  afterEach(async () => {
    await fixture?.close();
  });

  it.each([0, 1])('accepts a shared Queue and rejects another DB %i client', async (db) => {
    const observer = createExclusiveRedisObserver(fixture.client);
    const queue = new Queue('worksheet-pdf', {
      connection: fixture.client,
      skipMetasUpdate: true,
    });
    try {
      await queue.waitUntilReady();
      await queue.getFailedCount();
      await observer.verify();
      const stranger = new Redis(fixture.url, { db, maxRetriesPerRequest: 0 });
      try {
        await stranger.ping();
        await expect(observer.verify()).rejects.toThrow('Unexpected Redis client');
      } finally {
        await stranger.quit();
      }
      await expect(observer.verify()).rejects.toThrow('Redis observer unavailable');
    } finally {
      observer.close();
      await queue.close();
    }
  });

  it('rejects an observer moved to another database', async () => {
    const observer = createExclusiveRedisObserver(fixture.client);
    try {
      await observer.verify();
      await fixture.client.select(1);
      await expect(observer.verify()).rejects.toThrow('Redis observer database changed');
      await fixture.client.select(0);
      await expect(observer.verify()).rejects.toThrow('Redis observer unavailable');
    } finally {
      observer.close();
    }
  });

  it('rejects a reconnected observer even when it is the only client', async () => {
    const observer = createExclusiveRedisObserver(fixture.client);
    try {
      await observer.verify();
      const closed = once(fixture.client, 'close');
      fixture.client.disconnect();
      await closed;
      await fixture.client.connect();
      await expect(observer.verify()).rejects.toThrow('Redis observer unavailable');
    } finally {
      observer.close();
    }
  });

  it('rejects missing, duplicate and denied client inventory', async () => {
    for (const reply of [
      'id=1 db=0\n',
      'id=1 id=1 db=0 addr=127.0.0.1:9 flags=N cmd=client|list\n',
      'id=1 db=0 addr=127.0.0.1:9 flags=N cmd=client|list',
      null,
    ]) {
      const boundary = Object.assign(new EventEmitter(), {
        info: async () => `run_id:${'a'.repeat(40)}\n`,
        client: async (command: string) => {
          if (command === 'ID') return 1;
          if (reply === null) throw new Error('NOPERM');
          return reply;
        },
      });
      const observer = createExclusiveRedisObserver(boundary as unknown as Redis);
      try {
        await expect(observer.verify()).rejects.toThrow();
        await expect(observer.verify()).rejects.toThrow('Redis observer unavailable');
      } finally {
        observer.close();
      }
    }
  });

  it('rejects a changed Redis server identity', async () => {
    let runId = 'a'.repeat(40);
    const boundary = Object.assign(new EventEmitter(), {
      info: async () => `run_id:${runId}\n`,
      client: async (command: string) =>
        command === 'ID' ? 1 : 'id=1 db=0 addr=127.0.0.1:9 flags=N cmd=client|list\n',
    });
    const observer = createExclusiveRedisObserver(boundary as unknown as Redis);
    try {
      await observer.verify();
      runId = 'b'.repeat(40);
      await expect(observer.verify()).rejects.toThrow('Redis observer identity changed');
      await expect(observer.verify()).rejects.toThrow('Redis observer unavailable');
    } finally {
      observer.close();
    }
  });

  it('cannot finish an observation after it has been closed', async () => {
    let entered = () => {};
    let release = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const boundary = Object.assign(new EventEmitter(), {
      info: async () => {
        entered();
        await gate;
        return `run_id:${'a'.repeat(40)}\n`;
      },
      client: async (command: string) =>
        command === 'ID' ? 1 : 'id=1 db=0 addr=127.0.0.1:9 flags=N cmd=client|list\n',
    });
    const observer = createExclusiveRedisObserver(boundary as unknown as Redis);
    const pending = observer.verify();
    await started;
    observer.close();
    release();
    await expect(pending).rejects.toThrow('Redis observer connection lost');
  });

  it('invalidates overlapping observation attempts', async () => {
    let entered = () => {};
    let release = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const boundary = Object.assign(new EventEmitter(), {
      info: async () => {
        entered();
        await gate;
        return `run_id:${'a'.repeat(40)}\n`;
      },
      client: async (command: string) =>
        command === 'ID' ? 1 : 'id=1 db=0 addr=127.0.0.1:9 flags=N cmd=client|list\n',
    });
    const observer = createExclusiveRedisObserver(boundary as unknown as Redis);
    const first = observer.verify();
    await started;
    await expect(observer.verify()).rejects.toThrow('Redis observer unavailable');
    release();
    await expect(first).rejects.toThrow('Redis observer connection lost');
    observer.close();
  });
});
