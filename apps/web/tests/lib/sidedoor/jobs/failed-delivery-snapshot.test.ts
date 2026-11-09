// @vitest-environment private-redis
import { randomUUID } from 'node:crypto';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareJob, type OutboxJob } from 'thesidedoor-core/runtime/outbox';
import { snapshotFailedSottoDelivery } from '@/lib/sidedoor/jobs/core/job-delivery';

const suite = process.env.SOTTO_TEST_PRIVATE_REDIS_URL ? describe : describe.skip;

suite('failed delivery snapshots', () => {
  let queue: Queue;
  let worker: Worker | undefined;

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await queue?.obliterate({ force: true });
    await queue?.close();
  });

  async function fixture() {
    const url = new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL!);
    const connection = {
      host: url.hostname,
      port: Number(url.port),
      maxRetriesPerRequest: null,
    };
    queue = new Queue(`snapshot-${randomUUID()}`, { connection });
    const job = prepareJob({
      namespace: 'snapshot-test',
      handler: queue.name,
      version: 1,
      payload: {},
      scopes: [{ subjectId: 'profile:test', generation: 1 }],
      delivery: { attempts: 3, priority: 2, availableAt: 0 },
    });
    const record: OutboxJob = {
      kind: 'outbox_job',
      job,
      fingerprint: 'a'.repeat(64),
      complete: false,
      delivered: true,
    };
    const runningWorker = new Worker(
      queue.name,
      async (): Promise<void> => {
        throw new UnrecoverableError('terminal');
      },
      { connection }
    );
    worker = runningWorker;
    const failed = new Promise<void>((resolve, reject) => {
      runningWorker.once('failed', () => resolve());
      runningWorker.once('error', reject);
    });
    await queue.add(
      `${queue.name}.v1`,
      {
        operationId: job.id,
        fingerprint: record.fingerprint,
      },
      { jobId: job.id, attempts: 3, priority: 2 }
    );
    await failed;
    await runningWorker.close();
    worker = undefined;
    return record;
  }

  it('captures a terminal failure even when it fails before exhausting attempts', async () => {
    const record = await fixture();
    const queued = (await queue.getJob(record.job.id))!;
    expect(await snapshotFailedSottoDelivery(queue, record)).toEqual({
      operationId: record.job.id,
      fingerprint: record.fingerprint,
      deliveryAttempts: 1,
      failedAt: queued.finishedOn,
      processedAt: queued.processedOn,
    });
  });

  it('rejects a retried or missing job', async () => {
    const record = await fixture();
    const queued = (await queue.getJob(record.job.id))!;
    await queued.retry();
    await expect(snapshotFailedSottoDelivery(queue, record)).rejects.toThrow();
    await queued.remove();
    await expect(snapshotFailedSottoDelivery(queue, record)).rejects.toThrow();
  });

  it.each(['name', 'data', 'opts', 'finishedOn', 'processedOn', 'atm'])(
    'rejects forged or invalid %s',
    async (field) => {
      const record = await fixture();
      const client = await queue.getBackend().client;
      const replacement: Record<string, string> = {
        name: 'different.v1',
        data: JSON.stringify({ operationId: record.job.id, fingerprint: 'b'.repeat(64) }),
        opts: JSON.stringify({ attempts: 9, priority: 2 }),
        finishedOn: '0',
        processedOn: '0',
        atm: '0',
      };
      await client.hset(queue.toKey(record.job.id), { [field]: replacement[field]! });
      await expect(snapshotFailedSottoDelivery(queue, record)).rejects.toThrow();
    }
  );
});
