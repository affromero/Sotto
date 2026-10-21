// @vitest-environment node
import { spawn } from 'node:child_process';
import { Queue, Worker } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrivateRedis } from '../../helpers/queue/private-redis';
import { ALL_QUEUE_NAMES } from '@/lib/queue';
import { privacyContactUrl } from '@/lib/privacy/contact';
import { playSafetyContactUrl } from '@/lib/play/safety/policy';
import {
  inspectReviewQueuePolicy,
  prepareReviewQueuePolicy,
  reviewRuntimePolicySchema,
  type ReviewQueuePolicyIntent,
} from '../../../../../scripts/deploy/review/runtime/policy/queues';

const policy = {
  schemaVersion: 1,
  webHeapMiB: 256,
  workerHeapMiB: 512,
  helperHeapMiB: 192,
  queueConcurrency: 1,
  privacyContactEmail: 'me@afromero.co',
};
const connectionIdentity = 'a'.repeat(64);

describe('dedicated review queue policy', () => {
  let fixture: Awaited<ReturnType<typeof createPrivateRedis>>;
  beforeAll(async () => {
    fixture = await createPrivateRedis();
  });
  afterAll(async () => {
    await fixture?.close();
  });
  beforeEach(async () => {
    await fixture.client.flushdb();
  });
  const runtime = () => ({
    names: ALL_QUEUE_NAMES,
    createQueue: (name: string) =>
      new Queue(name, {
        connection: fixture.client,
        skipMetasUpdate: true,
      }),
  });
  async function queues() {
    const owned = ALL_QUEUE_NAMES.map((name) => runtime().createQueue(name));
    for (const queue of owned) await queue.pause();
    return owned;
  }
  async function snapshot() {
    const keys = (await fixture.client.keys('*')).sort();
    return Promise.all(keys.map(async (key) => [key, await fixture.client.dump(key)]));
  }

  it('requires the acknowledged original null inventory before the first write', async () => {
    const owned = await queues();
    let retained: ReviewQueuePolicyIntent | null = null;
    try {
      const result = await prepareReviewQueuePolicy(
        owned,
        connectionIdentity,
        null,
        async (intent) => {
          expect(await Promise.all(owned.map((queue) => queue.getGlobalConcurrency()))).toEqual(
            owned.map(() => null)
          );
          retained = structuredClone(intent);
        }
      );
      expect(result).toEqual(retained);
      expect(result.queues.map((row) => row.name)).toEqual([...ALL_QUEUE_NAMES].sort());
      expect(result.queues.every((row) => row.originalConcurrency === null)).toBe(true);
      expect(await Promise.all(owned.map((queue) => queue.getGlobalConcurrency()))).toEqual(
        owned.map(() => 1)
      );
    } finally {
      await Promise.all(owned.map((queue) => queue.close()));
    }
  });

  it('retains original metadata when durable acknowledgement fails', async () => {
    const owned = await queues();
    try {
      const before = await snapshot();
      await expect(
        prepareReviewQueuePolicy(owned, connectionIdentity, null, async () => {
          throw new Error('Journal unavailable');
        })
      ).rejects.toThrow(/Journal/);
      expect(await snapshot()).toEqual(before);
    } finally {
      await Promise.all(owned.map((queue) => queue.close()));
    }
  });

  it('refuses metadata changes that appear while the original intent is acknowledged', async () => {
    const owned = await queues();
    try {
      await expect(
        prepareReviewQueuePolicy(owned, connectionIdentity, null, async () => {
          await owned[0].setGlobalConcurrency(2);
        })
      ).rejects.toThrow(/Unknown/);
      expect(await Promise.all(owned.map((queue) => queue.getGlobalConcurrency()))).toEqual([
        2,
        ...owned.slice(1).map(() => null),
      ]);
    } finally {
      await Promise.all(owned.map((queue) => queue.close()));
    }
  });

  it('recovers only an exact retained null-or-one intent while every queue stays paused', async () => {
    const owned = await queues();
    const intent = {
      schemaVersion: 1 as const,
      connectionIdentity,
      queues: [...ALL_QUEUE_NAMES]
        .sort()
        .map((name) => ({ name, originalConcurrency: null, concurrency: 1 as const })),
    };
    try {
      await owned[0].setGlobalConcurrency(1);
      await owned[1].setGlobalConcurrency(1);
      await expect(
        prepareReviewQueuePolicy(owned, connectionIdentity, intent, async () => {
          throw new Error('Original intent must not be recreated');
        })
      ).resolves.toEqual(intent);
      await owned[2].setGlobalConcurrency(2);
      const before = await snapshot();
      await expect(
        prepareReviewQueuePolicy(owned, connectionIdentity, intent, async () => {})
      ).rejects.toThrow(/Unknown/);
      expect(await snapshot()).toEqual(before);
      await owned[2].setGlobalConcurrency(1);
      await owned[2].resume();
      await expect(
        prepareReviewQueuePolicy(owned, connectionIdentity, intent, async () => {})
      ).rejects.toThrow(/paused/);
    } finally {
      await Promise.all(owned.map((queue) => queue.close()));
    }
  });

  it('getter-only missing-policy refusal never creates queue keys', async () => {
    expect(await fixture.client.dbsize()).toBe(0);
    await expect(inspectReviewQueuePolicy(runtime(), policy, false)).rejects.toThrow(/concurrency/);
    expect(await fixture.client.dbsize()).toBe(0);
  });

  it('runs the actual public getter channel without a database connection or Redis writes', async () => {
    const owned = await queues();
    try {
      await prepareReviewQueuePolicy(owned, connectionIdentity, null, async () => {});
      for (const queue of owned) await queue.resume();
      const before = await snapshot();
      const result = await new Promise<unknown>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            '--max-old-space-size=192',
            '--require',
            'tsx/cjs',
            '-e',
            'require("../../scripts/deploy/review/runtime/channel.ts").main().catch(error=>{console.error(error);process.exit(1)})',
          ],
          {
            env: {
              ...process.env,
              REDIS_URL: fixture.url,
              DATABASE_URL: 'postgresql://unreachable:fixture@127.0.0.1:1/unreachable',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
          }
        );
        let buffer = '';
        let diagnostics = '';
        let response: unknown;
        let checks = 0;
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('Actual queue policy channel timed out'));
        }, 20_000);
        child.stdout.on('data', (chunk: Buffer) => {
          try {
            buffer += chunk.toString();
            if (buffer.length > 16_384) throw new Error('Bounded channel output required');
            while (buffer.includes('\n')) {
              const end = buffer.indexOf('\n');
              const line = buffer.slice(0, end);
              buffer = buffer.slice(end + 1);
              if (!line.startsWith('SOTTO_REVIEW_IPC=')) continue;
              const event = JSON.parse(line.slice('SOTTO_REVIEW_IPC='.length));
              if (event.type === 'policyCheck') {
                checks++;
                child.stdin.write(JSON.stringify({ type: 'ack', id: event.id }) + '\n');
              } else if (event.type === 'result') {
                response = event.value;
                child.stdin.end();
              } else {
                throw new Error('Getter attempted a mutating or fence-only operation');
              }
            }
          } catch (error) {
            child.kill('SIGKILL');
            reject(error);
          }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          diagnostics = (diagnostics + chunk.toString()).slice(0, 8192);
        });
        child.once('error', reject);
        child.once('close', (status) => {
          clearTimeout(timer);
          if (status !== 0 || checks !== 2 || response === undefined)
            reject(new Error(`Actual channel failed (${status}): ${diagnostics}`));
          else resolve(response);
        });
        child.stdin.write(
          JSON.stringify({ mode: 'queue-policy', input: policy, checkpoint: null, policy }) + '\n'
        );
      });
      expect(result).toEqual({
        queueCount: ALL_QUEUE_NAMES.length,
        concurrency: 1,
        privacyContactEmail: policy.privacyContactEmail,
      });
      expect(await snapshot()).toEqual(before);
    } finally {
      await Promise.all(owned.map((queue) => queue.close()));
    }
  }, 30_000);

  it('reads the exact unchanged public policy while different queues process work concurrently', async () => {
    const owned = await queues();
    const connections = [
      fixture.client.duplicate({ maxRetriesPerRequest: null }),
      fixture.client.duplicate({ maxRetriesPerRequest: null }),
    ];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: string[] = [];
    let active = 0;
    let peak = 0;
    const workers: Worker[] = [];
    try {
      await prepareReviewQueuePolicy(owned, connectionIdentity, null, async () => {});
      for (const queue of owned) await queue.resume();
      for (const [index, queue] of owned.slice(0, 2).entries()) {
        workers.push(
          new Worker(
            queue.name,
            async (job) => {
              started.push(String(job.data.label));
              if (index === 0) {
                active++;
                peak = Math.max(peak, active);
              }
              await held;
              if (index === 0) active--;
            },
            { connection: connections[index], concurrency: 2 }
          )
        );
        await workers[index].waitUntilReady();
      }
      await owned[0].add('fixture', { label: 'first' });
      await owned[0].add('fixture', { label: 'second' });
      await owned[1].add('fixture', { label: 'other-queue' });
      await expect
        .poll(() => started.includes('first') && started.includes('other-queue'))
        .toBe(true);
      expect(await owned[0].getActiveCount()).toBe(1);
      expect(await owned[0].getWaitingCount()).toBe(1);
      const before = await snapshot();
      expect(await inspectReviewQueuePolicy(runtime(), policy, false)).toEqual({
        queueCount: ALL_QUEUE_NAMES.length,
        concurrency: 1,
        privacyContactEmail: 'me@afromero.co',
      });
      expect(await snapshot()).toEqual(before);
      release();
      await expect.poll(() => owned[0].getCompletedCount()).toBe(2);
      expect(peak).toBe(1);
      expect(started).toContain('second');
    } finally {
      release();
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all(connections.map((connection) => connection.quit()));
      await Promise.all(owned.map((queue) => queue.close()));
    }
  });

  it('uses canonical contact validation for both privacy and game reports', () => {
    expect(reviewRuntimePolicySchema.parse(policy)).toEqual(policy);
    expect(privacyContactUrl(policy.privacyContactEmail)).toBe(
      'mailto:me%40afromero.co?subject=Sotto%20profile%20deletion'
    );
    expect(new URL(playSafetyContactUrl(policy.privacyContactEmail)!).pathname).toBe(
      'me%40afromero.co'
    );
    expect(() =>
      reviewRuntimePolicySchema.parse({ ...policy, privacyContactEmail: 'invalid contact' })
    ).toThrow();
  });
});
