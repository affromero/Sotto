// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Queue, Worker } from 'bullmq';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { POST as retry } from '@/app/api/v1/admin/queues/[queueName]/retry/route';
import { captureInitialStitchInputs } from '@/lib/sidedoor/jobs/initial/initial-stitch-inputs';
import {
  prepareInitialStitch,
  commitInitialStitch,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';
import {
  deliverSottoJob,
  readFailedSottoDelivery,
  sottoJobOutbox,
} from '@/lib/sidedoor/jobs/core/job-delivery';
import { reconcileSottoJobs } from '@/lib/sidedoor/jobs/core/job-reconciliation';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { readInitialStitchOutcome } from '@/lib/sidedoor/jobs/initial/initial-stitch-outcome';
import { processAudioStitching } from '@/workers/audio-stitching.worker';
import { executeSottoJob } from '@/lib/sidedoor/jobs/core/job-execution';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { StorageWriteJournal, prepareStorageWrite } from 'thesidedoor-core/storage';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { initialStitchPayloadSchema } from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';
import { createRegenerationSource } from '../../../helpers/runtime/regeneration-source';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';
import { invalidateServerInfra } from '@/lib/server-config';

const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  queues: new Map<string, Queue>(),
}));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/queue-admin', () => ({
  getAdminQueue: (name: string) => {
    const queue = boundary.queues.get(name);
    if (!queue) throw new Error('Missing isolated queue');
    return queue;
  },
}));

const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;
suite('initial stitching terminal delivery and administrator retry', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let directory: string;
  let prefix: string;
  let connection: { host: string; port: number; db: number; maxRetriesPerRequest: null };
  let workers: Worker[];
  beforeAll(async () => {
    const url = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use disposable local Redis database 15');
    connection = { host: url.hostname, port: Number(url.port), db: 15, maxRetriesPerRequest: null };
    instance = await createSharedTestInstance('stitch_terminal');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
    directory = await mkdtemp(join(tmpdir(), 'sotto-terminal-'));
    await instance.configureInfrastructure({
      storageProvider: 'local',
      localStorageRoot: directory,
    });
    invalidateServerInfra();
    vi.stubEnv('DATABASE_URL', process.env.SIDEDOOR_TEST_DATABASE_URL!);
    prefix = `terminal-${randomUUID()}`;
    for (const name of ['audio-stitching', 'episode-status', 'notifications'])
      boundary.queues.set(name, new Queue(name, { connection, prefix }));
    workers = [];
  });
  afterEach(async () => {
    for (const worker of workers) await worker.close();
    for (const queue of boundary.queues.values()) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
    boundary.queues.clear();
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await instance?.close();
  });
  const queue = () => boundary.queues.get('audio-stitching')!;
  const reconcile = () =>
    reconcileSottoJobs({
      database: instance.database,
      queues: boundary.queues,
      signal: new AbortController().signal,
      cursor: null,
    });
  async function fixture(userId = identity.ownerId, validAudio = false) {
    const audio = validAudio
      ? await readFile(join(process.cwd(), 'src/assets/sfx/intro-warm.mp3'))
      : Buffer.from('Invalid audio');
    const { episode } = await createRegenerationSource(instance.database, userId, directory, audio);
    await instance.database.episode.update({
      where: { id: episode.id },
      data: {
        status: 'GENERATING_AUDIO',
        audioGenerationKey: 'terminal-generation',
      },
    });
    const authorize = async () => ({ userId });
    const inputs = await sottoTransaction(instance.database, (tx) =>
      captureInitialStitchInputs(tx, authorize, episode.id, 'terminal-generation')
    );
    const prepared = prepareInitialStitch(inputs, 'none');
    const record = await sottoTransaction(instance.database, (tx) =>
      commitInitialStitch(tx, authorize, inputs, 'none', prepared, 'GENERATING_AUDIO')
    );
    await deliverSottoJob({
      database: instance.database,
      queue: queue(),
      operationId: record.job.id,
      version: 2,
    });
    return { episode, record };
  }
  async function fail(operationId: string, actualProcessing = true) {
    const processor = actualProcessing
      ? processAudioStitching
      : async () => {
          throw new Error('Worker execution unavailable');
        };
    const worker = new Worker(
      'audio-stitching',
      (job, token, signal) => executeSottoJob(job, processor, token, signal),
      { connection, prefix }
    );
    workers.push(worker);
    await worker.waitUntilReady();
    await expect
      .poll(async () => (await queue().getJob(operationId))?.getState(), { timeout: 5000 })
      .toBe('failed');
    await worker.close();
    const failed = (await queue().getJob(operationId))!;
    if (actualProcessing) expect(failed.failedReason).toContain('ffmpeg');
    return failed;
  }
  const retryRequest = (jobId: string, token = identity.ownerToken) =>
    retry(
      new NextRequest('http://localhost/api/v1/admin/queues/audio-stitching/retry', {
        method: 'POST',
        headers: { cookie: `sotto_session=${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jobId }),
      }),
      { params: Promise.resolve({ queueName: 'audio-stitching' }) }
    );

  it('reconciles exhausted processing attempts into one durable failure without a worker callback', async () => {
    const item = await fixture();
    const failed = await fail(item.record.job.id);
    expect(failed.attemptsMade).toBe(2);
    const pages = await Promise.all([reconcile(), reconcile()]);
    for (const page of pages)
      expect(page.results.find((result) => result.id === item.record.job.id)?.status).toBe(
        'complete'
      );
    const completed = (await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).read(item.record.job.id)
    ))!;
    expect(
      await sottoTransaction(instance.database, (tx) => readInitialStitchOutcome(tx, completed))
    ).toMatchObject({ kind: 'PROCESSING_FAILED' });
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } })).status
    ).toBe('FAILED');
    expect(
      await instance.database.pipelineEvent.count({
        where: { episodeId: item.episode.id, type: 'error' },
      })
    ).toBe(1);
    expect(await failed.getState()).toBe('failed');
  });

  it('administrator retries create one new canonical attempt for another profile', async () => {
    const learner = await identity.household('Learner');
    const item = await fixture(learner.id);
    await fail(item.record.job.id);
    const responses = await Promise.all([
      retryRequest(item.record.job.id),
      retryRequest(item.record.job.id),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0].jobId).not.toBe(item.record.job.id);
    expect(await (await queue().getJob(item.record.job.id))!.getState()).toBe('failed');
    const replacement = (await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).read(bodies[0].jobId)
    ))!;
    expect(replacement.job.payload).toMatchObject({ inputs: { storage: { userId: learner.id } } });
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } })).status
    ).toBe('STITCHING');
  });

  it('settles native stalled exhaustion without requiring all configured attempts', async () => {
    const item = await fixture();
    const abandoned = new Worker('audio-stitching', null, {
      connection,
      prefix,
      autorun: false,
      lockDuration: 100,
      skipLockRenewal: true,
      skipStalledCheck: true,
    });
    workers.push(abandoned);
    const active = await abandoned.getNextJob(randomUUID(), { block: false });
    expect(active?.id).toBe(item.record.job.id);
    await abandoned.close();
    const replacement = new Worker(
      'audio-stitching',
      (job, token, signal) => executeSottoJob(job, processAudioStitching, token, signal),
      {
        connection,
        prefix,
        stalledInterval: 100,
        lockDuration: 200,
        maxStalledCount: 0,
      }
    );
    workers.push(replacement);
    await expect
      .poll(async () => (await queue().getJob(item.record.job.id))?.getState(), { timeout: 5000 })
      .toBe('failed');
    const failed = (await queue().getJob(item.record.job.id))!;
    expect(failed.failedReason).toContain('stalled');
    expect(failed.attemptsMade).toBeLessThan(item.record.job.delivery.attempts);
    await reconcile();
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } })).status
    ).toBe('FAILED');
  });

  it('an old retry cannot create a third attempt after its replacement fails', async () => {
    const item = await fixture();
    await fail(item.record.job.id);
    const admitted = await retryRequest(item.record.job.id);
    expect(admitted.status).toBe(200);
    const replacementId = (await admitted.json()).jobId as string;
    expect(replacementId).not.toBe(item.record.job.id);
    await fail(replacementId);
    await reconcile();

    expect((await retryRequest(item.record.job.id)).status).toBe(409);
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } })).status
    ).toBe('FAILED');
    const jobs = await queue().getJobs(['waiting', 'active', 'failed', 'delayed', 'completed']);
    expect(jobs.map((job) => job.id).sort()).toEqual([item.record.job.id, replacementId].sort());
    expect(
      await instance.database.pipelineEvent.count({
        where: { episodeId: item.episode.id, type: 'error' },
      })
    ).toBe(2);

    const currentRetry = await retryRequest(replacementId);
    expect(currentRetry.status).toBe(200);
    const currentId = (await currentRetry.json()).jobId as string;
    expect([item.record.job.id, replacementId]).not.toContain(currentId);
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } })).status
    ).toBe('STITCHING');
  });

  it('a household learner cannot retry administrative queue work', async () => {
    const learner = await identity.household('Learner');
    const item = await fixture(learner.id);
    await fail(item.record.job.id);
    expect((await retryRequest(item.record.job.id, learner.token)).status).toBe(403);
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } })).status
    ).toBe('STITCHING');
  });

  it.each(['active', 'uncertain'] as const)(
    'blocks a replacement while an earlier audio write is %s',
    async (state) => {
      const item = await fixture();
      await fail(item.record.job.id);
      const { inputs } = initialStitchPayloadSchema.parse(item.record.job.payload);
      const scope = inputs.storage.scopes.find(
        (scope) => scope.subjectId === `episode:${item.episode.id}`
      )!;
      const backend = inputs.storageInputs[0]!;
      const intent = prepareStorageWrite({
        namespace: SIDEDOOR_STATE_ID,
        ...scope,
        target: {
          backendId: backend.backendId,
          binding: backend.binding,
          key: `episodes/${item.episode.id}/unfinished-${randomUUID()}.mp3`,
        },
      });
      await sottoTransaction(instance.database, async (tx) => {
        const writes = new StorageWriteJournal(
          { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
          'postgres',
          SIDEDOOR_STATE_ID
        );
        await writes.begin(intent, scope.generation);
        if (state === 'uncertain') await writes.finish(intent, { kind: 'uncertain' });
      });
      const response = await retryRequest(item.record.job.id);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: 'Resolve pending audio writes before retrying generation',
      });
      expect(
        (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listIncomplete()))
          .jobs
      ).toEqual([{ id: item.record.job.id, fingerprint: item.record.fingerprint }]);
      expect(await (await queue().getJob(item.record.job.id))!.getState()).toBe('failed');
    }
  );

  it.each(['active', 'cleanup-unconfirmed'] as const)(
    'blocks replacement after a delivery fails with %s execution cleanup',
    async (state) => {
      const item = await fixture();
      const execution = {
        id: randomUUID(),
        parentId: item.record.job.id,
        fingerprint: item.record.fingerprint,
        executorId: randomUUID(),
      };
      await sottoTransaction(instance.database, async (tx) => {
        const journal = sottoJobExecutions(tx);
        await journal.begin(execution);
        if (state === 'cleanup-unconfirmed') await journal.markCleanupUnconfirmed(execution);
      });
      await fail(item.record.job.id, false);
      const response = await retryRequest(item.record.job.id);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: 'Resolve pending episode execution cleanup before retrying generation',
      });
      expect(
        (await sottoTransaction(instance.database, (tx) => sottoJobExecutions(tx).read(execution)))
          .status
      ).toBe(state);
      expect(await (await queue().getJob(item.record.job.id))!.getState()).toBe('failed');
      expect((await queue().getJobs(['waiting', 'active', 'delayed'])).length).toBe(0);
    }
  );

  it('preserves READY when publication wins before failure reconciliation', async () => {
    const item = await fixture(identity.ownerId, true);
    const failed = await fail(item.record.job.id, false);
    await processAudioStitching(failed);
    await reconcile();
    expect((await retryRequest(item.record.job.id)).status).toBe(409);
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } })).status
    ).toBe('READY');
    expect(
      await instance.database.episodeVersion.count({ where: { episodeId: item.episode.id } })
    ).toBe(1);
    expect(
      (
        await readFailedSottoDelivery({
          database: instance.database,
          queue: queue(),
          operationId: item.record.job.id,
          version: 2,
        })
      ).complete
    ).toBe(true);
  });
});
