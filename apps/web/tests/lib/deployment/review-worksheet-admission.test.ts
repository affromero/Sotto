// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { Queue, Worker, type Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { AccessService, HouseholdProfileService } from 'thesidedoor-core/access';
import { PrismaClient } from '@/generated/prisma/client';
import { processWorksheetPdf } from '@/workers/worksheet-pdf.worker';
import { executeSottoJob } from '@/lib/sidedoor/jobs/core/job-execution';
import {
  sottoJobFailureCode,
  validateSottoQueueContract,
} from '@/lib/sidedoor/jobs/core/job-contracts';
import { readSottoWorkerJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { reconcileSottoJobs } from '@/lib/sidedoor/jobs/core/job-reconciliation';
import { worksheetPdfPayloadSchema } from '@/lib/sidedoor/jobs/stitch/worksheet-pdf-work';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { SottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import {
  captureReviewFirstWorkerEvidence,
  inspectReviewFirstWorker,
  type ReviewFirstWorkerEvidence,
} from '../../../../../scripts/deploy/review/first-worker';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => {
      throw new Error('Eligible worksheet reached fixture renderer');
    }),
  },
}));

interface Fixture {
  schema: string;
  classId: string;
  courseId: string;
  reference: string;
  scopes: { subjectId: string; generation: number }[];
  jobs: { id: string; fingerprint: string; job: unknown }[];
  profiles: { id: string; token: string }[];
  evidence?: ReviewFirstWorkerEvidence;
}
const fixturePath = process.env.SOTTO_REVIEW_WORKSHEET_FIXTURE;
const captureOnly = process.env.SOTTO_REVIEW_WORKSHEET_MODE === 'capture';
const suite = fixturePath ? describe : describe.skip;

suite('historical worksheet first-worker admission', () => {
  let fixture: Fixture;
  let database: PrismaClient;
  let queue: Queue;
  let worker: Worker | undefined;
  let connection: { host: string; port: number; db: number; maxRetriesPerRequest: null };
  const prefix = `review-worksheet-${randomUUID()}`;

  beforeAll(async () => {
    fixture = JSON.parse(await readFile(fixturePath!, 'utf8')) as Fixture;
    if (!/^review_worksheet_[a-f0-9]{32}$/.test(fixture.schema))
      throw new Error('Use an isolated historical worksheet schema');
    const url = new URL(process.env.SIDEDOOR_TEST_DATABASE_URL!);
    const redis = new URL(process.env.SIDEDOOR_TEST_REDIS_URL!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.pathname !== '/sidedoor_test' ||
      !['localhost', '127.0.0.1'].includes(redis.hostname) ||
      redis.pathname !== '/15'
    )
      throw new Error('Use disposable loopback fixtures only');
    database = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: url.toString(),
          options: `-c search_path=${fixture.schema},public`,
          max: 4,
        },
        { schema: fixture.schema }
      ),
    });
    boundary.database = database;
    if (captureOnly) return;
    connection = {
      host: redis.hostname,
      port: Number(redis.port),
      db: 15,
      maxRetriesPerRequest: null,
    };
    queue = new Queue('worksheet-pdf', {
      connection,
      prefix,
      defaultJobOptions: {
        backoff: { type: 'exponential', delay: 2000 },
        removeOnFail: { age: 604800 },
      },
    });
  });

  afterAll(async () => {
    await worker?.close();
    if (queue) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
    await database?.$disconnect();
    boundary.database = null;
  });

  const reconcile = () =>
    reconcileSottoJobs({
      database,
      queues: new Map([[queue.name, queue]]),
      signal: new AbortController().signal,
      cursor: null,
    });

  async function startWorker(onFailure?: (job: Job | undefined, error: Error) => void) {
    worker = new Worker(
      queue.name,
      async (job, token, signal) => {
        validateSottoQueueContract(queue.name, job);
        return executeSottoJob(job, processWorksheetPdf, token, signal);
      },
      { connection, prefix, concurrency: 1 }
    );
    if (onFailure) worker.on('failed', onFailure);
    await worker.waitUntilReady();
  }

  async function retainedState() {
    return {
      users: await database.user.findMany({ orderBy: { id: 'asc' } }),
      classes: await database.courseClass.findMany({ orderBy: { id: 'asc' } }),
      courses: await database.course.findMany({ orderBy: { id: 'asc' } }),
      state: await database.$queryRawUnsafe(
        "SELECT * FROM \"SidedoorState\" WHERE COALESCE(state->>'kind','') NOT IN ('outbox_job','outbox_pending') ORDER BY id"
      ),
    };
  }

  async function expectHistoricalFailures() {
    await expect
      .poll(
        async () => {
          const jobs = await Promise.all(fixture.jobs.map((job) => queue.getJob(job.id)));
          return Promise.all(jobs.map((job) => job?.getState()));
        },
        { timeout: 10_000 }
      )
      .toEqual(['failed', 'failed', 'failed']);
    for (const identity of fixture.jobs) {
      const delivered = await queue.getJob(identity.id);
      expect(delivered?.failedReason).toContain('Worksheet class changed before generation');
      expect(delivered?.attemptsMade).toBe(2);
      expect(delivered?.progress).toBe(0);
      expect(delivered?.data).toEqual({
        operationId: identity.id,
        fingerprint: identity.fingerprint,
      });
      const record = await sottoTransaction(database, (tx) => sottoJobOutbox(tx).read(identity.id));
      expect(record).toMatchObject({ fingerprint: identity.fingerprint, complete: false });
      expect(record?.job).toEqual(identity.job);
    }
    expect(chromium.launch).not.toHaveBeenCalled();
    expect(
      await sottoTransaction(database, (tx) => captureCourseStorage(tx, fixture.courseId))
    ).toMatchObject({ scopes: fixture.scopes });
    const access = new AccessService({ store: new SottoAccessStore(database) });
    for (const profile of fixture.profiles)
      expect((await new HouseholdProfileService(access).selected(profile.token))?.id).toBe(
        profile.id
      );
  }

  it.runIf(captureOnly)(
    'captures final-runtime evidence from the unchanged eleven-migration schema',
    async () => {
      const captured = await captureReviewFirstWorkerEvidence(database, {
        namespace: SIDEDOOR_STATE_ID,
        jobs: fixture.jobs.map(({ id }) => ({ id })).sort((a, b) => a.id.localeCompare(b.id)),
      });
      expect(captured.jobs.map(({ id, fingerprint }) => ({ id, fingerprint }))).toEqual(
        fixture.jobs
          .map(({ id, fingerprint }) => ({ id, fingerprint }))
          .sort((a, b) => a.id.localeCompare(b.id))
      );
      expect(captured).not.toHaveProperty('admitted');
      expect(captured).not.toHaveProperty('prepared');
      process.stdout.write('SOTTO_REVIEW_FIRST_WORKER_CAPTURE=' + JSON.stringify(captured) + '\n');
    }
  );

  it.skipIf(captureOnly)(
    'retains stale failures through restart and restores delivery after Redis retention loss',
    async () => {
      expect(fixture.evidence).toBeDefined();
      expect(await inspectReviewFirstWorker(database, fixture.evidence)).toEqual({
        admitted: true,
        zeroWork: false,
        pending: 3,
      });
      const before = await retainedState();
      const initial = await reconcile();
      expect(initial.results).toHaveLength(3);
      expect(initial.results.every((result) => result.status === 'delivered')).toBe(true);
      await startWorker();
      await expectHistoricalFailures();
      await worker!.close();
      worker = undefined;
      const exhausted = await reconcile();
      for (const result of exhausted.results) {
        expect(result.status).toBe('failed');
        if (result.status !== 'failed') throw new Error('Expected a retained failure');
        expect(sottoJobFailureCode(result.error)).toBe('terminal_failed');
      }
      await startWorker();
      await reconcile();
      await worker!.pause();
      await expectHistoricalFailures();
      await worker!.close();
      worker = undefined;
      expect(await retainedState()).toEqual(before);

      // Simulate ordinary removal/loss of retained failed Redis deliveries only in this private fixture.
      await queue.clean(0, 10, 'failed');
      expect(await queue.getFailedCount()).toBe(0);
      expect((await reconcile()).results.every((result) => result.status === 'delivered')).toBe(
        true
      );
      await startWorker();
      await expectHistoricalFailures();
      await worker!.close();
      worker = undefined;
      expect(await retainedState()).toEqual(before);

      const laterClass = await database.courseClass.create({
        data: { courseId: fixture.courseId, lessonId: before.classes[0].lessonId, order: 1 },
      });
      const later = await sottoTransaction(database, async (tx) => {
        const ownership = await captureCourseStorage(tx, laterClass.courseId);
        return sottoJobOutbox(tx).enqueue(
          prepareJob({
            id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
            namespace: SIDEDOOR_STATE_ID,
            handler: 'worksheet-pdf',
            version: 1,
            payload: {
              classId: laterClass.id,
              classUpdatedAt: laterClass.updatedAt.getTime(),
              appBaseUrl: 'https://demo.sotto.fm',
            },
            scopes: ownership.scopes,
            delivery: { attempts: 2, priority: 0, availableAt: 0 },
          })
        );
      });
      const advanced = await reconcile();
      expect(advanced.results.at(-1)).toMatchObject({ id: later.job.id, status: 'delivered' });
      const queued = await queue.getJob(later.job.id);
      expect(await queued?.getState()).toBe('waiting');
      const work = await sottoTransaction(database, (tx) =>
        readSottoWorkerJob(tx, queued!, {
          handler: queue.name,
          version: 1,
          payload: worksheetPdfPayloadSchema,
        })
      );
      expect(work.complete).toBe(false);
      expect(chromium.launch).not.toHaveBeenCalled();
      const beforeEligibleRun = await retainedState();
      const rendererErrors: unknown[] = [];
      await startWorker((job, error) => {
        if (job?.id === later.job.id) rendererErrors.push(error.cause);
      });
      await expect
        .poll(async () => (await queue.getJob(later.job.id))?.getState(), { timeout: 10_000 })
        .toBe('failed');
      await worker!.close();
      worker = undefined;
      expect(rendererErrors).toEqual([
        expect.objectContaining({ message: 'Eligible worksheet reached fixture renderer' }),
        expect.objectContaining({ message: 'Eligible worksheet reached fixture renderer' }),
      ]);
      expect(await retainedState()).toEqual(beforeEligibleRun);
      for (const original of fixture.jobs)
        expect((await queue.getJob(original.id))?.attemptsMade).toBe(2);
    }
  );

  it.skipIf(captureOnly)(
    'refuses changed identities, unsupported versions, invalid payloads and changed ownership',
    async () => {
      vi.mocked(chromium.launch).mockClear();
      const current = await database.courseClass.findUniqueOrThrow({
        where: { id: fixture.classId },
      });
      const payload = {
        classId: current.id,
        classUpdatedAt: current.updatedAt.getTime(),
        appBaseUrl: 'https://demo.sotto.fm',
      };
      const cases = [
        {
          payload,
          scopes: fixture.scopes,
          version: 1,
          fingerprint: '0'.repeat(64),
          error: /reference/,
        },
        { payload, scopes: fixture.scopes, version: 2, error: /Unsupported/ },
        { payload: {}, scopes: fixture.scopes, version: 1, error: /classId|Invalid/ },
        {
          payload: { ...payload, classId: randomUUID() },
          scopes: fixture.scopes,
          version: 1,
          error: /not found/,
        },
        {
          payload,
          scopes: fixture.scopes.map((scope) => ({ ...scope, generation: scope.generation + 1 })),
          version: 1,
          error: /ownership changed/,
        },
      ];
      const before = await retainedState();
      for (const scenario of cases) {
        const record = await sottoTransaction(database, (tx) =>
          sottoJobOutbox(tx).enqueue(
            prepareJob({
              namespace: SIDEDOOR_STATE_ID,
              handler: queue.name,
              version: scenario.version,
              payload: scenario.payload,
              scopes: scenario.scopes,
              delivery: { attempts: 1, priority: 0, availableAt: 0 },
            })
          )
        );
        const queued: Job = await queue.add(
          `${queue.name}.v${scenario.version}`,
          {
            operationId: record.job.id,
            fingerprint: scenario.fingerprint ?? record.fingerprint,
          },
          { jobId: record.job.id, attempts: 1 }
        );
        await expect(async () => {
          validateSottoQueueContract(queue.name, queued);
          await executeSottoJob(queued, processWorksheetPdf);
        }).rejects.toThrow(scenario.error);
        expect(
          await sottoTransaction(database, (tx) => sottoJobOutbox(tx).receipt(record.job.id))
        ).toMatchObject({ status: 'pending', fingerprint: record.fingerprint });
      }
      expect(await retainedState()).toEqual(before);
      expect(chromium.launch).not.toHaveBeenCalled();
    }
  );
});
