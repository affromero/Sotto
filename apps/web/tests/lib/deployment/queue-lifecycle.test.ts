// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { FlowProducer, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  captureSottoCredentialOwner,
  sottoCredentialRows,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { captureSottoCredentialProbe } from '@/lib/providers/shared/credential-validation';
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
  activationReady?: boolean;
  drained?: boolean;
  established?: boolean;
  activeJobs?: number;
  executions?: { workerActive: number; synchronousActive: number; settled: number };
  databaseIdentity?: {
    databaseName: string;
    schemaName: string;
    serverAddress: string;
    serverPort: number;
    databaseOid: string;
  };
  indexProof?: Record<string, unknown>;
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
  sottoCredentialRows: typeof sottoCredentialRows;
}
const { run } = createRequire(import.meta.url)(
  resolve(process.cwd(), '../../scripts/deploy/queue-lifecycle.cjs')
) as {
  run: (
    input: {
      command: string;
      manifest?: unknown;
      transition?: { proof: string; sha256: string };
      role?: 'previous' | 'candidate';
    },
    runtime: Runtime
  ) => Promise<Report>;
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
      sottoCredentialRows,
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

  function transition(addedNames: readonly string[] = ['vocabulary-audio']) {
    const previous = {
      ...runtime,
      names: runtime.names.filter((name) => !addedNames.includes(name)),
    };
    const proof = JSON.stringify({
      schemaVersion: 1,
      stack: 'sotto',
      releaseSha: 'a'.repeat(40),
      candidateWebImage: `ghcr.io/fixture/web@sha256:${'b'.repeat(64)}`,
      candidateWorkersImage: `ghcr.io/fixture/workers@sha256:${'c'.repeat(64)}`,
      previousRuntimes: Object.fromEntries(
        ['web', 'workers-heavy', 'workers-light', 'workers-pipeline'].map((service) => [
          service,
          {
            containerId: 'd'.repeat(64),
            imageId: `sha256:${'e'.repeat(64)}`,
          },
        ])
      ),
      previousNames: [...previous.names].sort(),
      candidateNames: [...runtime.names].sort(),
      compatibilityReviewSha256: 'f'.repeat(64),
      schemaReviewSha256: '1'.repeat(64),
    });
    const envelope = { proof, sha256: createHash('sha256').update(proof).digest('hex') };
    return {
      previous,
      previousInput: { transition: envelope, role: 'previous' as const },
      candidateInput: { transition: envelope, role: 'candidate' as const },
    };
  }

  it('admits explicit queue additions and restores original flags through interrupted pause and restore', async () => {
    const { previous, previousInput, candidateInput } = transition();
    await queue('vocabulary-audio').pause();
    const original = await run({ command: 'snapshot', ...previousInput }, previous);
    expect(original.schemaVersion).toBe(2);
    expect(original.queues.find((item) => item.name === 'vocabulary-audio')?.paused).toBe(true);
    expect(
      await run({ command: 'observe', manifest: original, ...candidateInput }, runtime)
    ).toEqual(original);
    // Redis pause flags survive a controller interruption before all queues are paused.
    await queue('audio-generation').pause();
    await run({ command: 'pause', manifest: original, ...previousInput }, previous);
    expect(
      (await run({ command: 'drained-all', manifest: original, ...previousInput }, previous))
        .drained
    ).toBe(true);
    await run({ command: 'added-empty', manifest: original, ...candidateInput }, runtime);
    // Candidate work is legitimate after cutover; restoration must preserve it.
    const job = await queue('vocabulary-audio').add('candidate-work', { retained: true });
    await queue('audio-generation').resume();
    await run({ command: 'restore', manifest: original, ...candidateInput }, runtime);
    expect(
      await run({ command: 'observe', manifest: original, ...candidateInput }, runtime)
    ).toEqual(original);
    expect((await queue('vocabulary-audio').getJob(job.id!))?.data).toEqual({ retained: true });
  });

  it('rejects changed proof bytes, transplanted manifests and incorrect actual runtime inventories', async () => {
    const { previous, previousInput, candidateInput } = transition();
    const original = await run({ command: 'snapshot', ...previousInput }, previous);
    await expect(
      run({ command: 'observe', manifest: original, ...previousInput }, runtime)
    ).rejects.toThrow();
    const changed = JSON.parse(previousInput.transition.proof) as { stack: string };
    changed.stack = 'sotto-personal';
    const proof = JSON.stringify(changed);
    for (const sha256 of [
      previousInput.transition.sha256,
      createHash('sha256').update(proof).digest('hex'),
    ])
      await expect(
        run(
          {
            command: 'pause',
            manifest: original,
            ...candidateInput,
            transition: { proof, sha256 },
          },
          runtime
        )
      ).rejects.toThrow();
    await expect(run({ command: 'pause', manifest: original }, runtime)).rejects.toThrow();
    expect(original.queues.every((item) => !item.paused)).toBe(true);
    expect(
      (await run({ command: 'observe', manifest: original, ...candidateInput }, runtime)).queues
    ).toEqual(original.queues);
  });

  it.each([
    'waiting',
    'paused',
    'delayed',
    'prioritized',
    'completed',
    'failed',
    'waiting-children',
  ] as const)('preserves and rejects existing %s work in an added queue', async (state) => {
    const added = queue('vocabulary-audio');
    const { previous, previousInput } = transition();
    if (state === 'paused') await added.pause();
    if (state === 'waiting-children') {
      const flow = new FlowProducer({ connection, prefix });
      try {
        await flow.add({
          name: 'parent',
          queueName: added.name,
          children: [{ name: 'child', queueName: 'audio-generation' }],
        });
      } finally {
        await flow.close();
      }
    } else {
      const job = await added.add(
        'existing-work',
        { retained: true },
        {
          ...(state === 'delayed' ? { delay: 60_000 } : {}),
          ...(state === 'prioritized' ? { priority: 2 } : {}),
        }
      );
      if (state === 'completed' || state === 'failed') {
        const worker = new Worker(
          added.name,
          async () => {
            if (state === 'failed') throw new Error('Retained failure');
            return 'retained result';
          },
          { connection, prefix }
        );
        try {
          await vi.waitFor(async () => expect(await job.getState()).toBe(state));
        } finally {
          await worker.close();
        }
      }
    }
    await expect(run({ command: 'snapshot', ...previousInput }, previous)).rejects.toThrow();
    expect(await added.getJobCountByTypes(state === 'paused' ? 'waiting' : state)).toBeGreaterThan(
      0
    );
  });

  it('rejects schedulers and idle connected workers before changing added queue flags', async () => {
    const added = queue('vocabulary-audio');
    const { previous, previousInput } = transition();
    await added.upsertJobScheduler('future', { every: 60_000 });
    await expect(run({ command: 'snapshot', ...previousInput }, previous)).rejects.toThrow();
    await added.removeJobScheduler('future');
    const worker = new Worker(added.name, async () => 'done', { connection, prefix });
    try {
      await vi.waitFor(async () => expect((await added.getWorkers()).length).toBeGreaterThan(0));
      await expect(run({ command: 'snapshot', ...previousInput }, previous)).rejects.toThrow();
      expect(await added.isPaused()).toBe(false);
    } finally {
      await worker.close();
    }
  });

  it('rejects an active added-queue job while leaving its worker and work intact', async () => {
    const added = queue('vocabulary-audio');
    const { previous, previousInput } = transition();
    let finish: () => void = () => {
      throw new Error('Worker has not started');
    };
    const pending = new Promise<void>((resolveWork) => {
      finish = resolveWork;
    });
    const worker = new Worker(added.name, () => pending, { connection, prefix });
    try {
      const job = await added.add('active-work', { retained: true });
      await vi.waitFor(async () => expect(await job.getState()).toBe('active'));
      await expect(run({ command: 'snapshot', ...previousInput }, previous)).rejects.toThrow();
      expect(await job.getState()).toBe('active');
      expect(await added.isPaused()).toBe(false);
    } finally {
      finish();
      await worker.close();
    }
  });

  it.each([false, true])(
    'rejects undelivered added-queue durable work with active execution %s',
    async (active) => {
      const { previous, previousInput } = transition();
      if (active) await execution('vocabulary-audio');
      else
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).enqueue(
            prepareJob({
              namespace: SIDEDOOR_STATE_ID,
              handler: 'vocabulary-audio',
              version: 1,
              payload: {},
              scopes: [{ subjectId: `deployment:${randomUUID()}`, generation: 0 }],
              delivery: { attempts: 1, priority: 0, availableAt: 0 },
            })
          )
        );
      await expect(run({ command: 'snapshot', ...previousInput }, previous)).rejects.toThrow();
      expect(await queue('vocabulary-audio').getJobCounts()).toMatchObject({
        waiting: 0,
        active: 0,
      });
      expect(await queue('audio-generation').isPaused()).toBe(false);
    }
  );

  it('rejects added work produced during drainage without resnapshotting or deleting it', async () => {
    const { previous, previousInput, candidateInput } = transition();
    const original = await run({ command: 'snapshot', ...previousInput }, previous);
    await run({ command: 'pause', manifest: original, ...previousInput }, previous);
    const job = await queue('vocabulary-audio').add('late-child-work', { retained: true });
    await expect(
      run({ command: 'added-empty', manifest: original, ...candidateInput }, runtime)
    ).rejects.toThrow();
    expect(await job.getState()).toBe('waiting');
    expect(await queue('vocabulary-audio').isPaused()).toBe(true);
    expect(original.queues.every((item) => !item.paused)).toBe(true);
  });

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
    const observed = await run({ command: 'observe', manifest: original }, runtime);
    expect(observed.queues.find((entry) => entry.name === 'pricing-fetch')?.paused).toBe(false);
    expect(original.queues.find((entry) => entry.name === 'pricing-fetch')?.paused).toBe(true);
    await run({ command: 'restore', manifest: original }, runtime);
    expect(await run({ command: 'snapshot' }, runtime)).toEqual(original);
    expect(original.queues.find((entry) => entry.name === 'pricing-fetch')?.paused).toBe(true);
    expect(snapshot.queues.every((entry) => !entry.paused)).toBe(true);
  });

  it('fences added queues from the previous runtime and restores their exact flags on the candidate', async () => {
    const addedQueues = ['material-analysis', 'vocabulary-audio'];
    const candidateQueues = [...ALL_QUEUE_NAMES].sort();
    expect(addedQueues.every((name) => candidateQueues.includes(name))).toBe(true);
    const { previous, previousInput, candidateInput } = transition(addedQueues);
    await queue('material-analysis').pause();
    await queue('pricing-fetch').pause();
    const keys = (await connection.keys(`${prefix}:*`)).sort();
    const original = await run(
      {
        command: 'snapshot',
        ...previousInput,
      },
      previous
    );
    expect((await connection.keys(`${prefix}:*`)).sort()).toEqual(keys);
    await run({ command: 'pause', manifest: original, ...previousInput }, previous);
    expect(
      (await run({ command: 'drained-all', manifest: original, ...candidateInput }, runtime))
        .drained
    ).toBe(true);
    await run({ command: 'restore', manifest: original, ...candidateInput }, runtime);
    const restored = await run({ command: 'snapshot' }, runtime);
    expect(restored.queues).toEqual(original.queues);
    expect(await queue('material-analysis').isPaused()).toBe(true);
    expect(await queue('vocabulary-audio').isPaused()).toBe(false);
    expect(await queue('pricing-fetch').isPaused()).toBe(true);
  });

  it('checks empty Fish state without writing credentials or queue metadata', async () => {
    expect(await run({ command: 'activation-ready' }, runtime)).toMatchObject({
      activationReady: true,
    });
    expect(await connection.keys(`${prefix}:*`)).toEqual([]);
  });

  it.each(['preference', 'credential', 'queue', 'episode', 'segment', 'voice'])(
    'rejects existing Fish %s state before enabling overlap',
    async (kind) => {
      const identity = await instance.reset();
      if (['episode', 'segment', 'voice'].includes(kind)) {
        const episode = await instance.database.episode.create({
          data: {
            userId: identity.ownerId,
            title: 'Existing audio',
            topic: 'Practice',
            ...(kind === 'episode' ? { ttsProvider: 'fish' } : {}),
          },
        });
        if (kind === 'segment')
          await instance.database.segment.create({
            data: {
              episodeId: episode.id,
              order: 0,
              speaker: 'Host',
              text: 'Hallo',
              ttsProvider: 'fish',
            },
          });
        if (kind === 'voice')
          await instance.database.episodeVoice.create({
            data: { episodeId: episode.id, speaker: 'Host', provider: 'fish' },
          });
      }
      if (kind === 'preference')
        await instance.database.user.update({
          where: { id: identity.ownerId },
          data: { preferredTtsProvider: 'fish' },
        });
      if (kind === 'queue')
        await queue('audio-generation').add('existing-audio', { selection: { provider: 'fish' } });
      if (kind === 'credential') {
        vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
        try {
          await sottoTransaction(instance.database, async (tx) => {
            const storage = await sottoCredentialStorage(tx, 'tts', 'fish');
            const owner = await captureSottoCredentialOwner(tx, identity.ownerId);
            const values = { apiKey: 'fixture-fish-key' };
            const probe = captureSottoCredentialProbe('tts', 'fish', values);
            if (probe.kind === 'unsupported') throw new Error('Fish credentials must be supported');
            await storage.owned.replace(
              storage.owned.prepareReplacement(
                { ...storage.slot, owner },
                {
                  expectedHeadRevision: null,
                  credentialRevision: randomUUID(),
                  values,
                  binding: probe.binding,
                  availability: 'enabled',
                  label: 'Fish',
                  metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
                }
              )
            );
          });
        } finally {
          vi.unstubAllEnvs();
        }
      }
      await expect(run({ command: 'activation-ready' }, runtime)).rejects.toThrow('Existing Fish');
      if (kind === 'queue') expect(await queue('audio-generation').getWaitingCount()).toBe(1);
    }
  );

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

  it('requires synchronous writing to settle before a schema transition drains', async () => {
    const writing = await execution('learning-writing');
    const manifest = await run({ command: 'snapshot' }, runtime);
    await run({ command: 'pause', manifest }, runtime);
    expect(await run({ command: 'drained-all', manifest }, runtime)).toMatchObject({
      drained: false,
      executions: { synchronousActive: 1, workerActive: 0 },
    });
    await sottoTransaction(instance.database, (transaction) =>
      sottoJobExecutions(transaction).settle(writing)
    );
    expect(await run({ command: 'drained-all', manifest }, runtime)).toMatchObject({
      drained: true,
      executions: { synchronousActive: 0, workerActive: 0, settled: 1 },
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
      await expect(run({ command: 'drained-all', manifest }, runtime)).rejects.toThrow();
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

  it('proves the actual database and schema behind the configured connection', async () => {
    const report = await run({ command: 'database-identity' }, runtime);
    expect(report.databaseIdentity).toMatchObject({
      databaseName: 'sidedoor_test',
      schemaName: instance.schema,
      serverAddress: expect.any(String),
      databaseOid: expect.any(String),
    });
    expect(report.databaseIdentity!.serverPort).toBeGreaterThan(0);
    const original = runtime.environment.DATABASE_URL;
    const url = new URL(original);
    url.searchParams.set('schema', 'another_schema');
    runtime.environment.DATABASE_URL = url.href;
    try {
      await expect(run({ command: 'database-identity' }, runtime)).rejects.toThrow(
        'Configured schema differs'
      );
    } finally {
      runtime.environment.DATABASE_URL = original;
    }
  });

  it('checks the migrated schema with the generated client and detects database drift', async () => {
    const execute = promisify(execFile);
    const connection = new URL(process.env.SIDEDOOR_TEST_DATABASE_URL!);
    connection.searchParams.set('schema', instance.schema);
    const command = [
      createRequire(import.meta.url).resolve('prisma/build/index.js'),
      'migrate',
      'diff',
      '--config',
      resolve(process.cwd(), '../../prisma.config.ts'),
      '--from-config-datasource',
      '--to-schema',
      resolve(process.cwd(), 'prisma/schema.prisma'),
      '--script',
      '--exit-code',
    ];
    const options = {
      env: { ...process.env, DATABASE_URL: connection.href, DIRECT_DATABASE_URL: connection.href },
    };
    const manifest = await run({ command: 'snapshot' }, runtime);
    const identity = await run({ command: 'database-identity' }, runtime);
    const compare = async (indexChange?: Record<string, unknown>) => {
      const directory = await mkdtemp(join(tmpdir(), 'sotto-schema-drift-'));
      try {
        const diff = await execute(process.execPath, command, options).then(
          ({ stdout }) => ({ code: 0, stdout }),
          (error: unknown) => {
            if (
              error instanceof Error &&
              'code' in error &&
              typeof error.code === 'number' &&
              'stdout' in error &&
              typeof error.stdout === 'string'
            )
              return { code: error.code, stdout: error.stdout };
            throw error;
          }
        );
        const index = await run({ command: 'schema-index', manifest }, runtime);
        if (indexChange) index.indexProof = { ...index.indexProof, ...indexChange };
        await writeFile(
          join(directory, 'schema-preparation.json'),
          JSON.stringify({
            databaseIdentity: identity.databaseIdentity,
            applicationConnectionIdentity: identity.connectionIdentity,
          }),
          { mode: 0o600, flag: 'wx' }
        );
        await writeFile(join(directory, 'schema-index.json'), JSON.stringify(index), {
          mode: 0o600,
          flag: 'wx',
        });
        await writeFile(join(directory, 'schema-drift.sql'), diff.stdout, {
          mode: 0o600,
          flag: 'wx',
        });
        return await execute('python3', [
          resolve(process.cwd(), '../../scripts/deploy/compatibility-review.py'),
          'schema-drift',
          String(diff.code),
          directory,
        ]).catch((cause: unknown) => {
          if (cause instanceof Error && 'code' in cause)
            throw Object.assign(
              new Error(`Schema comparison rejected:\n${JSON.stringify(diff.stdout)}`, { cause }),
              {
                code: cause.code,
              }
            );
          throw cause;
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    };
    await compare();
    for (const flag of ['isValid', 'isReady', 'isLive'])
      await expect(compare({ [flag]: false })).rejects.toMatchObject({ code: 1 });
    expect(await instance.database.learnerReviewEvent.count()).toBe(0);
    await instance.database.$executeRawUnsafe(
      'ALTER TABLE "LearnerReviewEvent" ADD COLUMN "unexpected" TEXT'
    );
    try {
      await expect(compare()).rejects.toMatchObject({ code: 1 });
    } finally {
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "LearnerReviewEvent" DROP COLUMN "unexpected"'
      );
    }
    await instance.database.$executeRawUnsafe('DROP INDEX "SidedoorState_id_pattern_idx"');
    await instance.database.$executeRawUnsafe(
      'CREATE INDEX "SidedoorState_id_pattern_idx" ON "SidedoorState" ("id")'
    );
    try {
      await expect(compare()).rejects.toMatchObject({ code: 1 });
    } finally {
      await instance.database.$executeRawUnsafe('DROP INDEX "SidedoorState_id_pattern_idx"');
      await instance.database.$executeRawUnsafe(
        'CREATE INDEX "SidedoorState_id_pattern_idx" ON "SidedoorState" ("id" text_pattern_ops)'
      );
    }
  }, 30000);

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
