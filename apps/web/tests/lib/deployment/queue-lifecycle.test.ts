// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { ALL_QUEUE_NAMES } from '@/lib/queue';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  isSottoSynchronousJob,
  requireSottoJobVersion,
} from '@/lib/sidedoor/jobs/core/job-contracts';
import {
  SIDEDOOR_STATE_ID,
  sidedoorStateStore,
  sottoStorageInstance,
} from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';

interface Manifest {
  schemaVersion: number;
  connectionIdentity: string;
  queues: { name: string; paused: boolean }[];
}
interface Report extends Manifest {
  drained?: boolean;
  established?: boolean;
  activeJobs?: number;
  executions?: { workerActive: number; synchronousActive: number; settled: number };
}
interface Runtime {
  database: SharedTestInstance['database'];
  namespace: string;
  environment: { DATABASE_URL: string; REDIS_URL: string };
  names: readonly string[];
  migrationDirectory: string;
  createQueue: (name: string) => Queue;
  sottoJobOutbox: typeof sottoJobOutbox;
  sottoJobExecutions: typeof sottoJobExecutions;
  isSottoSynchronousJob: typeof isSottoSynchronousJob;
  requireSottoJobVersion: typeof requireSottoJobVersion;
  sidedoorStateStore: typeof sidedoorStateStore;
  sottoStorageInstance: typeof sottoStorageInstance;
}
const { run } = createRequire(import.meta.url)(
  resolve(process.cwd(), '../../scripts/deploy/queue-lifecycle.cjs')
) as {
  run: (input: { command: string; manifest?: unknown }, runtime: Runtime) => Promise<Report>;
};
const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;

suite('deployment queue and execution settlement', () => {
  let instance: SharedTestInstance;
  let connection: Redis;
  let runtime: Runtime;
  let prefix: string;
  const queues = new Map<string, Queue>();
  const migrationDirectory = resolve(process.cwd(), 'prisma/migrations');
  const migrations = new Map<string, string>();
  beforeAll(async () => {
    const url = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use isolated local Redis database 15');
    connection = new Redis(url.toString(), { maxRetriesPerRequest: null });
    instance = await createSharedTestInstance('deployment_queue');
    // The migration-only fixture has not undergone the installed platform cutover.
    for (const table of [
      'UserVisualCueKey',
      'UserAiKey',
      'UserTtsKey',
      'AutoModelConfig',
      'SiteConfig',
    ])
      await instance.database.$executeRawUnsafe(`DROP TABLE "${instance.schema}"."${table}"`);
    for (const entry of await readdir(migrationDirectory, { withFileTypes: true })) {
      if (entry.isDirectory())
        migrations.set(
          entry.name,
          createHash('sha256')
            .update(await readFile(join(migrationDirectory, entry.name, 'migration.sql')))
            .digest('hex')
        );
    }
    await instance.database.$executeRawUnsafe(
      'CREATE TABLE "_prisma_migrations" (migration_name text NOT NULL, checksum text NOT NULL, finished_at timestamptz, rolled_back_at timestamptz)'
    );
  });
  beforeEach(async () => {
    await instance.reset();
    await instance.database.$executeRawUnsafe('TRUNCATE "_prisma_migrations"');
    for (const [name, checksum] of migrations)
      await instance.database.$executeRawUnsafe(
        'INSERT INTO "_prisma_migrations" VALUES ($1, $2, NOW(), NULL)',
        name,
        checksum
      );
    prefix = `deploy-${randomUUID()}`;
    runtime = {
      database: instance.database,
      namespace: SIDEDOOR_STATE_ID,
      environment: {
        DATABASE_URL: process.env.SIDEDOOR_TEST_DATABASE_URL!,
        REDIS_URL: process.env.SIDEDOOR_TEST_REDIS_URL!,
      },
      names: ALL_QUEUE_NAMES,
      migrationDirectory,
      createQueue: (name) => new Queue(name, { connection, prefix, skipMetasUpdate: true }),
      sottoJobOutbox,
      sottoJobExecutions,
      isSottoSynchronousJob,
      requireSottoJobVersion,
      sidedoorStateStore,
      sottoStorageInstance,
    };
  });
  afterEach(async () => {
    for (const name of ALL_QUEUE_NAMES) {
      const queue = new Queue(name, { connection, prefix, skipMetasUpdate: true });
      await queue.obliterate({ force: true });
      await queue.close();
    }
    for (const queue of queues.values()) await queue.close();
    queues.clear();
  });
  afterAll(async () => {
    await connection?.quit();
    await instance?.close();
  });
  function queue(name: string) {
    const existing = queues.get(name);
    if (existing) return existing;
    const created = new Queue(name, { connection, prefix, skipMetasUpdate: true });
    queues.set(name, created);
    return created;
  }
  async function execution(handler: string, version = 1) {
    return sottoTransaction(instance.database, async (transaction) => {
      const parent = await sottoJobOutbox(transaction).enqueue(
        prepareJob({
          namespace: SIDEDOOR_STATE_ID,
          handler,
          version,
          payload: {},
          scopes: [{ subjectId: `deployment:${randomUUID()}`, generation: 0 }],
          delivery: { attempts: 1, priority: 0, availableAt: 0 },
        })
      );
      const binding = {
        id: randomUUID(),
        parentId: parent.job.id,
        fingerprint: parent.fingerprint,
        executorId: randomUUID(),
      };
      await sottoJobExecutions(transaction).begin(binding);
      return binding;
    });
  }

  it('observes without creating Redis state and restores the exact original pause flags', async () => {
    const snapshot = await run({ command: 'snapshot' }, runtime);
    expect(await connection.keys(`${prefix}:*`)).toEqual([]);
    await queue('pricing-fetch').pause();
    const original = await run({ command: 'snapshot' }, runtime);
    const keys = (await connection.keys(`${prefix}:*`)).sort();
    await run({ command: 'snapshot' }, runtime);
    expect((await connection.keys(`${prefix}:*`)).sort()).toEqual(keys);
    await run({ command: 'pause', manifest: original }, runtime);
    expect((await run({ command: 'drained', manifest: original }, runtime)).drained).toBe(true);
    await queue('pricing-fetch').resume();
    await run({ command: 'restore', manifest: original }, runtime);
    expect(await run({ command: 'snapshot' }, runtime)).toEqual(original);
    expect(original.queues.find((entry) => entry.name === 'pricing-fetch')?.paused).toBe(true);
    expect(snapshot.queues.every((entry) => !entry.paused)).toBe(true);
  });

  it('rejects foreign or malformed manifests without pausing any queue', async () => {
    const original = await run({ command: 'snapshot' }, runtime);
    const invalid = [
      { ...original, connectionIdentity: '0'.repeat(64) },
      { ...original, queues: original.queues.slice(1) },
      { ...original, queues: [...original.queues.slice(1), original.queues[1]] },
      { ...original, queues: [{ name: 'foreign', paused: false }, ...original.queues.slice(1)] },
      {
        ...original,
        queues: [{ ...original.queues[0], paused: 'false' }, ...original.queues.slice(1)],
      },
    ];
    for (const manifest of invalid)
      await expect(run({ command: 'pause', manifest }, runtime)).rejects.toThrow();
    await expect(run({ command: 'drained' }, runtime)).rejects.toThrow();
    expect(await run({ command: 'snapshot' }, runtime)).toEqual(original);
    expect(await connection.keys(`${prefix}:*`)).toEqual([]);
  });

  it('keeps an active worker job running until its effects finish', async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    let effectsFinished = false;
    const worker = new Worker(
      'pricing-fetch',
      async () => {
        entered();
        await finish;
        effectsFinished = true;
      },
      { connection, prefix }
    );
    let completed!: () => void;
    const settled = new Promise<void>((resolve) => {
      completed = resolve;
    });
    worker.on('completed', completed);
    try {
      await queue('pricing-fetch').add('pricing-fetch.v1', {});
      await started;
      const manifest = await run({ command: 'snapshot' }, runtime);
      await run({ command: 'pause', manifest }, runtime);
      expect(await run({ command: 'drained', manifest }, runtime)).toMatchObject({
        drained: false,
        activeJobs: 1,
      });
      expect(effectsFinished).toBe(false);
      release();
      await settled;
      expect((await run({ command: 'drained', manifest }, runtime)).drained).toBe(true);
      expect(effectsFinished).toBe(true);
    } finally {
      release();
      await worker.close();
    }
  });

  it('allows only authenticated synchronous writing while worker journals remain blocking', async () => {
    await execution('learning-writing');
    const worker = await execution('audio-stitching', 2);
    const manifest = await run({ command: 'snapshot' }, runtime);
    await run({ command: 'pause', manifest }, runtime);
    expect(await run({ command: 'drained', manifest }, runtime)).toMatchObject({
      drained: false,
      executions: { synchronousActive: 1, workerActive: 1 },
    });
    await sottoTransaction(instance.database, (transaction) =>
      sottoJobExecutions(transaction).settle(worker)
    );
    expect(await run({ command: 'drained', manifest }, runtime)).toMatchObject({
      drained: true,
      executions: { synchronousActive: 1, settled: 1 },
    });
  });

  it.each(['learning-writing', 'audio-stitching'])(
    'never exempts unconfirmed cleanup for %s',
    async (handler) => {
      const binding = await execution(handler, handler === 'audio-stitching' ? 2 : 1);
      await sottoTransaction(instance.database, (transaction) =>
        sottoJobExecutions(transaction).markCleanupUnconfirmed(binding)
      );
      const manifest = await run({ command: 'snapshot' }, runtime);
      await run({ command: 'pause', manifest }, runtime);
      await expect(run({ command: 'drained', manifest }, runtime)).rejects.toThrow();
    }
  );

  it.each(['missing-parent', 'wrong-fingerprint', 'unknown-status', 'unknown-handler'])(
    'fails closed on %s execution evidence',
    async (defect) => {
      const binding = await execution(
        defect === 'unknown-handler' ? 'foreign-handler' : 'learning-writing'
      );
      if (defect === 'missing-parent')
        await instance.database.$executeRawUnsafe(
          'DELETE FROM "SidedoorState" WHERE "state"->\'job\'->>\'id\' = $1',
          binding.parentId
        );
      if (defect === 'wrong-fingerprint')
        await instance.database.$executeRawUnsafe(
          'UPDATE "SidedoorState" SET "state" = jsonb_set("state", \'{fingerprint}\', to_jsonb($1::text)) WHERE "state"->>\'kind\' = \'job_execution\' AND "state"->>\'id\' = $2',
          '0'.repeat(64),
          binding.id
        );
      if (defect === 'unknown-status')
        await instance.database.$executeRawUnsafe(
          'UPDATE "SidedoorState" SET "state" = jsonb_set("state", \'{status}\', \'"unknown"\'::jsonb) WHERE "state"->>\'id\' = $1',
          binding.id
        );
      const manifest = await run({ command: 'snapshot' }, runtime);
      await run({ command: 'pause', manifest }, runtime);
      await expect(run({ command: 'drained', manifest }, runtime)).rejects.toThrow();
    }
  );

  it('verifies established authority without changing configuration or ledger rows', async () => {
    const before = await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } });
    expect(await run({ command: 'established' }, runtime)).toMatchObject({ established: true });
    expect(await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } })).toEqual(
      before
    );
  });

  it.each([
    'missing-table',
    'missing-migration',
    'unfinished',
    'rolled-back',
    'checksum',
    'duplicate',
    'legacy',
    'configuration',
    'instance',
  ])('rejects an unestablished %s database', async (defect) => {
    const name = migrations.keys().next().value!;
    if (defect === 'missing-table')
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "_prisma_migrations" RENAME TO "saved_migrations"'
      );
    if (defect === 'missing-migration')
      await instance.database.$executeRawUnsafe(
        'DELETE FROM "_prisma_migrations" WHERE migration_name = $1',
        name
      );
    if (defect === 'unfinished')
      await instance.database.$executeRawUnsafe(
        'UPDATE "_prisma_migrations" SET finished_at = NULL WHERE migration_name = $1',
        name
      );
    if (defect === 'rolled-back')
      await instance.database.$executeRawUnsafe(
        'UPDATE "_prisma_migrations" SET rolled_back_at = NOW() WHERE migration_name = $1',
        name
      );
    if (defect === 'checksum')
      await instance.database.$executeRawUnsafe(
        'UPDATE "_prisma_migrations" SET checksum = $1 WHERE migration_name = $2',
        '0'.repeat(64),
        name
      );
    if (defect === 'duplicate')
      await instance.database.$executeRawUnsafe(
        'INSERT INTO "_prisma_migrations" SELECT * FROM "_prisma_migrations" WHERE migration_name = $1',
        name
      );
    if (defect === 'legacy')
      await instance.database.$executeRawUnsafe('CREATE TABLE "SiteConfig" (id text)');
    if (defect === 'configuration')
      await sottoTransaction(instance.database, (transaction) =>
        sidedoorStateStore(transaction).transact((state) => {
          state.configuration.site = null;
          state.revision++;
        })
      );
    if (defect === 'instance')
      await instance.database.$executeRawUnsafe(
        'DELETE FROM "SidedoorState" WHERE "state"->>\'kind\' = \'storage_instance\''
      );
    try {
      await expect(run({ command: 'established' }, runtime)).rejects.toThrow();
    } finally {
      if (defect === 'missing-table')
        await instance.database.$executeRawUnsafe(
          'ALTER TABLE "saved_migrations" RENAME TO "_prisma_migrations"'
        );
      if (defect === 'legacy') await instance.database.$executeRawUnsafe('DROP TABLE "SiteConfig"');
    }
  });
});
