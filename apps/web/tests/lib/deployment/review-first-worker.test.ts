// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import { StorageCleanupJournal, prepareStorageCleanup } from 'thesidedoor-core/storage';
import {
  captureReviewFirstWorkerEvidence,
  hashReviewFirstWorkerValue as digest,
  inspectReviewContinuation,
  inspectReviewFirstWorker,
  inspectReviewPausedFirstWorker,
  inspectReviewPausedConsumers,
  inspectReviewRedisEmpty,
  prepareReviewQueues,
  reviewFirstWorkerEvidenceSchema,
  type ReviewFirstWorkerEvidence,
  type ReviewQueueRuntime,
} from '../../../../../scripts/deploy/review/first-worker';
import { ALL_QUEUE_NAMES } from '@/lib/queue';
import {
  SIDEDOOR_STATE_ID,
  sidedoorStateStore,
  sottoStorageInstance,
} from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { deliverSottoJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';
import { createPrivateRedis } from '../../helpers/queue/private-redis';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const lifecycle = createRequire(import.meta.url)(
  '../../../../../scripts/deploy/queue-lifecycle.cjs'
) as {
  connectionIdentity(environment: ReviewQueueRuntime['environment'], namespace: string): string;
};

it('loads the mounted adapter and canonical lifecycle through the actual Node tsx entrypoint', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--require',
      'tsx/cjs',
      '--eval',
      'const api=require("../../scripts/deploy/review/first-worker.ts");' +
        'api.inspectReviewFirstWorker({},{}).then(()=>{throw Error("Unexpected admission")},' +
        'error=>{if(error.name!=="ZodError")throw error;' +
        'process.stdout.write("SOTTO_REVIEW_ADAPTER_LOAD=ok\\n")});',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15_000,
      env: { PATH: process.env.PATH, NODE_ENV: 'test' },
    }
  );
  expect(output).toBe('SOTTO_REVIEW_ADAPTER_LOAD=ok\n');
});

suite('bounded canonical review first-worker admission', () => {
  let instance: SharedTestInstance;
  let evidence: ReviewFirstWorkerEvidence;
  let courseId: string;
  let classId: string;
  let ownerId: string;
  let redis: Redis;
  let privateRedis: Awaited<ReturnType<typeof createPrivateRedis>>;
  let redisUrl: string;
  let runtime: ReviewQueueRuntime;

  beforeAll(async () => {
    instance = await createSharedTestInstance('review_first_worker');
    boundary.database = instance.database;
    privateRedis = await createPrivateRedis();
    redisUrl = privateRedis.url;
    redis = privateRedis.client;
  });

  afterAll(async () => {
    await privateRedis?.close();
    boundary.database = null;
    await instance?.close();
  });

  beforeEach(async () => {
    // This Redis process belongs only to this test suite, including its DB0.
    await redis.flushdb();
    const identity = await instance.reset();
    await instance.database.curriculum.deleteMany();
    ownerId = identity.ownerId;
    const curriculum = await instance.database.curriculum.create({
      data: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
    });
    const lesson = await instance.database.lesson.create({
      data: {
        curriculumId: curriculum.id,
        level: 'A1',
        order: 0,
        slug: 'review',
        title: 'Review',
        objective: 'Practice',
        grammarPoints: [],
        vocabThemes: [],
        targetVocab: [],
      },
    });
    const course = await instance.database.course.create({
      data: { userId: ownerId, curriculumId: curriculum.id, nativeLang: 'en', targetLang: 'es' },
    });
    courseId = course.id;
    const cls = await instance.database.courseClass.create({
      data: {
        courseId,
        lessonId: lesson.id,
        order: 0,
        worksheetPdfUrl: '/api/storage/worksheets/preserved.pdf',
      },
    });
    classId = cls.id;
    await sottoTransaction(instance.database, async (transaction) => {
      const ownership = await captureCourseStorage(transaction, courseId);
      const outbox = sottoJobOutbox(transaction);
      for (let index = 0; index < 3; index++) {
        const record = await outbox.enqueue(
          prepareJob({
            namespace: SIDEDOOR_STATE_ID,
            handler: 'worksheet-pdf',
            version: 1,
            payload: {
              classId,
              classUpdatedAt: cls.updatedAt.getTime() - 1000,
              appBaseUrl: 'https://demo.sotto.fm',
            },
            scopes: ownership.scopes,
            delivery: { attempts: 2, priority: 0, availableAt: 0 },
          })
        );
        if (index > 0) await outbox.acknowledgeDelivery(record.job.id, record.fingerprint);
      }
    });
    evidence = await captureEvidence();
    runtime = {
      database: instance.database,
      namespace: SIDEDOOR_STATE_ID,
      environment: {
        DATABASE_URL: process.env.SIDEDOOR_TEST_DATABASE_URL!,
        REDIS_URL: redisUrl,
      },
      names: ALL_QUEUE_NAMES,
      createQueue: (name) => new Queue(name, { connection: redis, skipMetasUpdate: true }),
      policy: {
        schemaVersion: 1,
        webHeapMiB: 256,
        workerHeapMiB: 512,
        helperHeapMiB: 192,
        queueConcurrency: 1,
        privacyContactEmail: 'me@afromero.co',
      },
      policyIntent: null,
      admitQueuePolicy: async (intent) => {
        runtime.policyIntent = intent;
      },
    };
  });

  async function captureEvidence(): Promise<ReviewFirstWorkerEvidence> {
    return sottoTransaction(instance.database, async (transaction) => {
      const identities = await transaction.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT current_database() AS "databaseName", current_schema() AS "schemaName", inet_server_addr()::text AS "serverAddress", inet_server_port() AS "serverPort", (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid"'
      );
      const state = await sidedoorStateStore(transaction).read();
      const instanceIdentity = await sottoStorageInstance(transaction).read();
      const storage = Object.fromEntries(
        [
          'storageProvider',
          'localStorageRoot',
          'objectStorageEndpoint',
          'objectStorageBucket',
          'objectStorageRegion',
          'objectStoragePublicUrl',
        ].map((key) => [key, state.configuration.site?.[key] ?? null])
      );
      const outbox = sottoJobOutbox(transaction);
      const page = await outbox.listIncomplete();
      const jobs = [];
      for (const reference of page.jobs) {
        const record = await outbox.read(reference.id);
        if (!record) throw new Error('Fixture job missing');
        const cls = await transaction.courseClass.findUniqueOrThrow({ where: { id: classId } });
        const course = await transaction.course.findUniqueOrThrow({ where: { id: courseId } });
        const profile = state.access.householdProfiles?.find((item) => item.id === ownerId);
        const principal = state.access.principals.find((item) => item.id === ownerId);
        if (!principal) throw new Error('Canonical fixture owner missing');
        jobs.push({
          id: reference.id,
          fingerprint: record.fingerprint,
          delivered: record.delivered,
          jobHash: digest(record.job),
          payloadHash: digest(record.job.payload),
          scopesHash: digest(record.job.scopes),
          classHash: digest({ id: cls.id, courseId }),
          courseHash: digest({
            id: courseId,
            userId: course.userId,
            createdAt: course.createdAt.getTime(),
          }),
          profileHash: digest({
            id: ownerId,
            profile: profile ?? null,
            principal: {
              id: principal.id,
              epoch: principal.epoch,
              role: principal.role,
              createdAt: principal.createdAt,
            },
          }),
          classUpdatedAt: cls.updatedAt.getTime() - 1000,
          currentClassUpdatedAt: cls.updatedAt.getTime(),
          worksheetReferenceHash: digest(cls.worksheetPdfUrl),
        });
      }
      return reviewFirstWorkerEvidenceSchema.parse({
        schemaVersion: 1,
        namespace: SIDEDOOR_STATE_ID,
        databaseIdentityHash: digest(identities[0]),
        storageIdentityHash: digest({ instance: instanceIdentity, storage }),
        jobs: jobs.sort((left, right) => left.id.localeCompare(right.id)),
      });
    });
  }

  async function preservedState() {
    return {
      state: await instance.database.$queryRawUnsafe('SELECT * FROM "SidedoorState" ORDER BY id'),
      users: await instance.database.user.findMany({ orderBy: { id: 'asc' } }),
      courses: await instance.database.course.findMany(),
      classes: await instance.database.courseClass.findMany(),
    };
  }

  function knownReferences(source = evidence) {
    return {
      namespace: source.namespace,
      jobs: source.jobs.map(({ id }) => ({ id })),
    };
  }

  async function enqueueHistoricalDeliveries() {
    const queue = runtime.createQueue('worksheet-pdf');
    for (const reference of evidence.jobs)
      await deliverSottoJob({
        database: instance.database,
        queue,
        operationId: reference.id,
        fingerprint: reference.fingerprint,
        version: 1,
      });
    return queue;
  }

  it('retains exact historical evidence after paused acknowledgments and new canonical startup work', async () => {
    const queue = await enqueueHistoricalDeliveries();
    try {
      await sottoTransaction(instance.database, async (transaction) => {
        const ownership = await captureCourseStorage(transaction, courseId);
        await sottoJobOutbox(transaction).enqueue(
          prepareJob({
            namespace: SIDEDOOR_STATE_ID,
            handler: 'pricing-fetch',
            version: 1,
            payload: {},
            scopes: ownership.scopes,
            delivery: { attempts: 2, priority: 0, availableAt: 0 },
          })
        );
      });
      const before = await preservedState();
      expect(await inspectReviewPausedFirstWorker(instance.database, evidence)).toEqual({
        admitted: true,
        zeroWork: false,
        pending: 3,
      });
      await expect(inspectReviewFirstWorker(instance.database, evidence)).rejects.toThrow();
      expect(await preservedState()).toEqual(before);
    } finally {
      await queue.close();
    }
  });

  it('refuses changed historical content and regressed acknowledgments while paused', async () => {
    const before = await preservedState();
    for (const changed of [
      {
        ...evidence,
        jobs: evidence.jobs.map((job) => ({ ...job, worksheetReferenceHash: '0'.repeat(64) })),
      },
      { ...evidence, jobs: evidence.jobs.map((job) => ({ ...job, delivered: true })) },
    ])
      await expect(inspectReviewPausedFirstWorker(instance.database, changed)).rejects.toThrow();
    expect(await preservedState()).toEqual(before);
  });

  it('refuses unfinished historical deliveries without changing their state or receipts', async () => {
    const queue = await enqueueHistoricalDeliveries();
    try {
      const before = await preservedState();
      await expect(inspectReviewContinuation(instance.database, evidence, queue)).rejects.toThrow(
        'Only a failed delivery'
      );
      expect(await preservedState()).toEqual(before);
      for (const reference of evidence.jobs) {
        const job = await queue.getJob(reference.id);
        expect(await job?.getState()).toBe('waiting');
        expect(job?.attemptsMade).toBe(0);
      }
      await expect(inspectReviewFirstWorker(instance.database, evidence)).rejects.toThrow(
        'Admitted worksheet evidence changed'
      );
    } finally {
      await queue.close();
    }
  });

  it('refuses unrelated worker failures while preserving exhausted deliveries and pending receipts', async () => {
    const queue = await enqueueHistoricalDeliveries();
    const url = new URL(redisUrl);
    const worker = new Worker(
      queue.name,
      async () => {
        throw new Error('Different fixture failure');
      },
      {
        connection: {
          host: url.hostname,
          port: Number(url.port),
          db: 0,
          maxRetriesPerRequest: null,
        },
        concurrency: 1,
      }
    );
    const errors: Error[] = [];
    worker.on('error', (error) => errors.push(error));
    try {
      await expect.poll(() => queue.getFailedCount(), { timeout: 5000 }).toBe(3);
      await worker.close();
      const before = await preservedState();
      await expect(inspectReviewContinuation(instance.database, evidence, queue)).rejects.toThrow();
      expect(errors).toEqual([]);
      expect(await preservedState()).toEqual(before);
      for (const reference of evidence.jobs) {
        const job = await queue.getJob(reference.id);
        expect(await job?.getState()).toBe('failed');
        expect(job?.attemptsMade).toBe(2);
        expect(job?.failedReason).toBe('Different fixture failure');
      }
    } finally {
      await worker.close();
      await queue.close();
    }
  });

  it('captures only private hashes from known canonical identities without admitting or changing work', async () => {
    const before = await preservedState();
    const captured = await captureReviewFirstWorkerEvidence(instance.database, knownReferences());
    expect(captured).toEqual(evidence);
    expect(captured).not.toHaveProperty('admitted');
    expect(captured).not.toHaveProperty('prepared');
    await expect(inspectReviewFirstWorker(instance.database, knownReferences())).rejects.toThrow();
    await expect(prepareReviewQueues(runtime, knownReferences(), redis)).rejects.toThrow();
    const serialized = JSON.stringify(captured);
    for (const hidden of [
      classId,
      courseId,
      ownerId,
      '/api/storage/worksheets/preserved.pdf',
      'passwordHash',
      'token',
    ])
      expect(serialized).not.toContain(hidden);
    expect(await preservedState()).toEqual(before);
    expect(await redis.dbsize()).toBe(0);
  });

  it('requires exactly three unique ordered identities for observation only', async () => {
    const known = knownReferences();
    for (const input of [
      { ...known, jobs: known.jobs.slice(1) },
      { ...known, jobs: [known.jobs[0], known.jobs[0], known.jobs[2]] },
      { ...known, jobs: [...known.jobs].reverse() },
      { ...known, admitted: true },
      { ...known, jobs: known.jobs.map((job) => ({ ...job, fingerprint: '0'.repeat(64) })) },
    ])
      await expect(captureReviewFirstWorkerEvidence(instance.database, input)).rejects.toThrow();
    expect(await redis.dbsize()).toBe(0);
  });

  it('refuses a capture with a changed known identity', async () => {
    const known = knownReferences();
    known.jobs[0].id = '00000000-0000-4000-8000-000000000000';
    known.jobs.sort((left, right) => left.id.localeCompare(right.id));
    const before = await preservedState();
    await expect(captureReviewFirstWorkerEvidence(instance.database, known)).rejects.toThrow();
    expect(await preservedState()).toEqual(before);
  });

  it('refuses to capture an eligible current timestamp even when every immutable reference is known', async () => {
    const original = evidence.jobs[0];
    const current = await sottoTransaction(instance.database, async (transaction) => {
      const outbox = sottoJobOutbox(transaction);
      await outbox.complete(original.id, original.fingerprint);
      const cls = await transaction.courseClass.findUniqueOrThrow({ where: { id: classId } });
      return outbox.enqueue(
        prepareJob({
          namespace: SIDEDOOR_STATE_ID,
          handler: 'worksheet-pdf',
          version: 1,
          payload: {
            classId,
            classUpdatedAt: cls.updatedAt.getTime(),
            appBaseUrl: 'https://demo.sotto.fm',
          },
          scopes: (await captureCourseStorage(transaction, courseId)).scopes,
          delivery: { attempts: 2, priority: 0, availableAt: 0 },
        })
      );
    });
    const known = knownReferences();
    known.jobs = [
      ...known.jobs.filter((job) => job.id !== original.id),
      { id: current.job.id },
    ].sort((left, right) => left.id.localeCompare(right.id));
    const before = await preservedState();
    await expect(captureReviewFirstWorkerEvidence(instance.database, known)).rejects.toThrow(
      /Only stale/
    );
    expect(await preservedState()).toEqual(before);
  });

  it('refuses to capture missing classes and changed captured ownership', async () => {
    const known = knownReferences();
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    await instance.database.course.update({
      where: { id: courseId },
      data: { createdAt: new Date(1) },
    });
    await expect(captureReviewFirstWorkerEvidence(instance.database, known)).rejects.toThrow(
      /ownership/
    );
    await instance.database.course.update({
      where: { id: courseId },
      data: { createdAt: course.createdAt },
    });
    await instance.database.courseClass.delete({ where: { id: classId } });
    const before = await preservedState();
    await expect(captureReviewFirstWorkerEvidence(instance.database, known)).rejects.toThrow(
      /class\/reference/
    );
    expect(await preservedState()).toEqual(before);
  });

  it('admits only the exact retained three without changing state or creating Redis metadata', async () => {
    const before = await preservedState();
    expect(await inspectReviewRedisEmpty(redis)).toEqual({ empty: true });
    expect(await inspectReviewFirstWorker(instance.database, evidence)).toEqual({
      admitted: true,
      zeroWork: false,
      pending: 3,
    });
    expect(await preservedState()).toEqual(before);
    expect(await redis.dbsize()).toBe(0);
  });

  it.each([
    'databaseIdentityHash',
    'storageIdentityHash',
    'jobHash',
    'payloadHash',
    'scopesHash',
    'classHash',
    'courseHash',
    'profileHash',
    'worksheetReferenceHash',
    'fingerprint',
  ])('rejects changed admitted %s without modifying retained data', async (field) => {
    const changed = structuredClone(evidence);
    if (field === 'databaseIdentityHash' || field === 'storageIdentityHash')
      changed[field] = '0'.repeat(64);
    else Object.assign(changed.jobs[0], { [field]: '0'.repeat(64) });
    const before = await preservedState();
    await expect(inspectReviewFirstWorker(instance.database, changed)).rejects.toThrow();
    expect(await preservedState()).toEqual(before);
  });

  it('refuses missing, duplicate, reordered, matching-timestamp and extra evidence', async () => {
    for (const value of [
      { ...evidence, jobs: evidence.jobs.slice(1) },
      { ...evidence, jobs: [evidence.jobs[0], evidence.jobs[0], evidence.jobs[2]] },
      { ...evidence, jobs: [...evidence.jobs].reverse() },
      { ...evidence, unexpected: true },
      {
        ...evidence,
        jobs: evidence.jobs.map((job) => ({ ...job, classUpdatedAt: job.currentClassUpdatedAt })),
      },
    ])
      await expect(inspectReviewFirstWorker(instance.database, value)).rejects.toThrow();
    expect(await redis.dbsize()).toBe(0);
  });

  it('refuses unknown pending work even when it was acknowledged by a queue', async () => {
    await sottoTransaction(instance.database, async (transaction) => {
      const outbox = sottoJobOutbox(transaction);
      const record = await outbox.enqueue(
        prepareJob({
          namespace: SIDEDOOR_STATE_ID,
          handler: 'notification',
          version: 1,
          payload: {},
          scopes: (await captureCourseStorage(transaction, courseId)).scopes,
          delivery: { attempts: 1, priority: 0, availableAt: 0 },
        })
      );
      await outbox.acknowledgeDelivery(record.job.id, record.fingerprint);
    });
    const before = await preservedState();
    await expect(inspectReviewFirstWorker(instance.database, evidence)).rejects.toThrow(
      /Unexpected|Unknown/
    );
    await expect(
      captureReviewFirstWorkerEvidence(instance.database, knownReferences())
    ).rejects.toThrow(/Unexpected|Unknown/);
    expect(await preservedState()).toEqual(before);
  });

  it('refuses an admitted receipt that has completed and preserves its actual outcome', async () => {
    const job = evidence.jobs[0];
    await sottoTransaction(instance.database, (transaction) =>
      sottoJobOutbox(transaction).complete(job.id, job.fingerprint)
    );
    const before = await preservedState();
    await expect(inspectReviewFirstWorker(instance.database, evidence)).rejects.toThrow();
    expect(await preservedState()).toEqual(before);
  });

  it('refuses pending records whose incomplete index was lost', async () => {
    const job = evidence.jobs[0];
    await instance.database.$executeRawUnsafe(
      "DELETE FROM \"SidedoorState\" WHERE state->>'kind' = 'outbox_pending' AND state->>'id' = $1 AND id LIKE 'sd-ji:%'",
      job.id
    );
    await expect(inspectReviewFirstWorker(instance.database, evidence)).rejects.toThrow();
  });

  it('rejects duplicate retained identities outside canonical storage keys', async () => {
    await instance.database.$executeRawUnsafe(
      "INSERT INTO \"SidedoorState\" (id,revision,state) SELECT 'review-shadow:' || id,revision,state FROM \"SidedoorState\" WHERE state->>'kind' = 'outbox_job' AND state->'job'->>'id' = $1",
      evidence.jobs[0].id
    );
    const before = await preservedState();
    await expect(inspectReviewFirstWorker(instance.database, evidence)).rejects.toThrow(
      /Duplicate/
    );
    expect(await preservedState()).toEqual(before);
  });

  it.each(['version', 'origin', 'attempts', 'priority', 'availableAt', 'payload'])(
    'refuses admitted identities with unsupported worksheet %s',
    async (field) => {
      const original = evidence.jobs[0];
      await sottoTransaction(instance.database, async (transaction) => {
        const outbox = sottoJobOutbox(transaction);
        await outbox.complete(original.id, original.fingerprint);
        const cls = await transaction.courseClass.findUniqueOrThrow({ where: { id: classId } });
        await outbox.enqueue(
          prepareJob({
            namespace: SIDEDOOR_STATE_ID,
            handler: 'worksheet-pdf',
            version: field === 'version' ? 2 : 1,
            payload: {
              classId,
              classUpdatedAt: cls.updatedAt.getTime() - 1000,
              appBaseUrl: field === 'origin' ? 'http://demo.sotto.fm' : 'https://demo.sotto.fm',
              ...(field === 'payload' ? { unsupported: 'reject' } : {}),
            },
            scopes: (await captureCourseStorage(transaction, courseId)).scopes,
            delivery: {
              attempts: field === 'attempts' ? 1 : 2,
              priority: field === 'priority' ? 1 : 0,
              availableAt: field === 'availableAt' ? 1 : 0,
            },
          })
        );
      });
      const changed = await captureEvidence();
      const before = await preservedState();
      await expect(inspectReviewFirstWorker(instance.database, changed)).rejects.toThrow();
      await expect(
        captureReviewFirstWorkerEvidence(instance.database, knownReferences(changed))
      ).rejects.toThrow();
      expect(await preservedState()).toEqual(before);
    }
  );

  it.each(['reference', 'timestamp', 'course generation', 'profile authority', 'storage root'])(
    'refuses changed %s',
    async (field) => {
      if (field === 'reference')
        await instance.database.courseClass.update({
          where: { id: classId },
          data: { worksheetPdfUrl: null },
        });
      if (field === 'timestamp')
        await instance.database.courseClass.update({
          where: { id: classId },
          data: { updatedAt: new Date(1) },
        });
      if (field === 'course generation')
        await instance.database.course.update({
          where: { id: courseId },
          data: { createdAt: new Date(1) },
        });
      if (field === 'profile authority' || field === 'storage root')
        await sottoTransaction(instance.database, (transaction) =>
          sidedoorStateStore(transaction).transact((state) => {
            if (field === 'profile authority') {
              state.access.householdProfiles = state.access.householdProfiles?.filter(
                (profile) => profile.id !== ownerId
              );
              state.access.principals = state.access.principals.filter(
                (principal) => principal.id !== ownerId
              );
            } else if (state.configuration.site)
              state.configuration.site.localStorageRoot = '/different/root';
            state.revision++;
          })
        );
      await expect(inspectReviewFirstWorker(instance.database, evidence)).rejects.toThrow();
    }
  );

  it('rejects any raw Redis key before creating queue metadata and retains it', async () => {
    await redis.set('unexpected-state', 'preserve');
    await expect(
      prepareReviewQueues({ ...runtime, policyIntent: null }, evidence, redis)
    ).rejects.toThrow(/Redis/);
    expect(await redis.keys('*')).toEqual(['unexpected-state']);
    expect(await redis.get('unexpected-state')).toBe('preserve');
  });

  it('refuses a tombstoned captured course through canonical storage admission', async () => {
    await sottoTransaction(instance.database, async (transaction) => {
      const course = await transaction.course.findUniqueOrThrow({ where: { id: courseId } });
      const cleanup = new StorageCleanupJournal(
        {
          query: (sql, values) =>
            transaction.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      await cleanup.createJob(
        prepareStorageCleanup({
          namespace: SIDEDOOR_STATE_ID,
          subjectId: `course:${courseId}`,
          generation: course.createdAt.getTime(),
        })
      );
    });
    const before = await preservedState();
    await expect(inspectReviewFirstWorker(instance.database, evidence)).rejects.toThrow(
      /storage ownership/
    );
    await expect(
      captureReviewFirstWorkerEvidence(instance.database, knownReferences())
    ).rejects.toThrow(/storage ownership/);
    expect(await preservedState()).toEqual(before);
    expect(await redis.dbsize()).toBe(0);
  });

  it('rejects nonzero Redis databases without reading or changing their keys', async () => {
    const wrongDatabase = redis.duplicate({ db: 15 });
    try {
      await wrongDatabase.set('preserve-other-db', 'untouched');
      await expect(inspectReviewRedisEmpty(wrongDatabase)).rejects.toThrow(/database 0/);
      expect(await wrongDatabase.get('preserve-other-db')).toBe('untouched');
      expect(await redis.dbsize()).toBe(0);
    } finally {
      await wrongDatabase.quit();
    }
  });

  it.each(['', '/0'])(
    'prepares dedicated DB0 with Redis URL path %j and preserves its connection identity',
    async (path) => {
      const url = new URL(redisUrl);
      url.pathname = path;
      runtime.environment.REDIS_URL = url.toString();
      const connectionIdentity = lifecycle.connectionIdentity(
        runtime.environment,
        runtime.namespace
      );
      const before = await preservedState();
      const result = await prepareReviewQueues(runtime, evidence, redis);
      expect(result).toMatchObject({ prepared: true, zeroWork: false, pending: 3 });
      expect(result.manifest.connectionIdentity).toBe(connectionIdentity);
      expect(runtime.environment.REDIS_URL).toBe(url.toString());
      expect(result.manifest.queues).toEqual(
        [...ALL_QUEUE_NAMES].sort().map((name) => ({ name, paused: false }))
      );
      for (const name of ALL_QUEUE_NAMES) {
        const queue = runtime.createQueue(name);
        try {
          expect(await queue.isPaused()).toBe(true);
          expect(await queue.getJobCounts()).toMatchObject({
            active: 0,
            waiting: 0,
            completed: 0,
            failed: 0,
          });
        } finally {
          await queue.close();
        }
      }
      expect(await preservedState()).toEqual(before);
      const ownedKeys = (await redis.keys('*')).sort();
      const ownedValues = await Promise.all(ownedKeys.map((key) => redis.dump(key)));
      await expect(prepareReviewQueues(runtime, evidence, redis)).resolves.toEqual(result);
      expect((await redis.keys('*')).sort()).toEqual(ownedKeys);
      expect(await Promise.all(ownedKeys.map((key) => redis.dump(key)))).toEqual(ownedValues);
      await redis.set('foreign-preparation-state', 'retained');
      await expect(prepareReviewQueues(runtime, evidence, redis)).rejects.toThrow(/unowned/);
      expect(await redis.get('foreign-preparation-state')).toBe('retained');
      await redis.del('foreign-preparation-state');
      await expect(
        prepareReviewQueues({ ...runtime, policyIntent: null }, evidence, redis)
      ).rejects.toThrow(/Redis/);
      expect(await preservedState()).toEqual(before);
    }
  );

  it.each([
    ['/1', 0, false],
    ['/1', 0, true],
    ['', 1, false],
    ['', 1, true],
    ['/0', 1, false],
    ['/0', 1, true],
  ] as const)(
    'refuses Redis URL path %j and actual DB %i with retained preparation %j',
    async (path, database, retained) => {
      if (retained) await prepareReviewQueues(runtime, evidence, redis);
      const connection = redis.duplicate({ db: database });
      try {
        const url = new URL(redisUrl);
        url.pathname = path;
        const before = await preservedState();
        const keys = (await connection.keys('*')).sort();
        const values = await Promise.all(keys.map((key) => connection.dump(key)));
        await expect(
          prepareReviewQueues(
            {
              ...runtime,
              environment: { ...runtime.environment, REDIS_URL: url.toString() },
              createQueue: (name) => new Queue(name, { connection, skipMetasUpdate: true }),
            },
            evidence,
            connection
          )
        ).rejects.toThrow(/Dedicated review Redis database 0/);
        expect((await connection.keys('*')).sort()).toEqual(keys);
        expect(await Promise.all(keys.map((key) => connection.dump(key)))).toEqual(values);
        expect(await preservedState()).toEqual(before);
      } finally {
        connection.disconnect();
      }
    }
  );

  it('proves zero consumers across all actual paused queues and refuses a live foreign consumer', async () => {
    await prepareReviewQueues(runtime, evidence, redis);
    const expected = { address: '172.30.99.11', paused: true, count: 0 };
    expect(await inspectReviewPausedConsumers(runtime, expected)).toEqual({
      consumers: ALL_QUEUE_NAMES.length,
      queuesPaused: true,
      workerAddress: expected.address,
    });
    await expect(
      inspectReviewPausedConsumers(runtime, { ...expected, count: 1 })
    ).rejects.toThrow();
    const url = new URL(redisUrl);
    const workers = ALL_QUEUE_NAMES.map(
      (name) =>
        new Worker(name, async () => undefined, {
          connection: {
            host: url.hostname,
            port: Number(url.port),
            db: 0,
            maxRetriesPerRequest: null,
          },
        })
    );
    try {
      await Promise.all(workers.map((worker) => worker.waitUntilReady()));
      for (const name of ALL_QUEUE_NAMES) {
        const queue = runtime.createQueue(name);
        try {
          await expect.poll(async () => (await queue.getWorkers()).length).toBe(1);
        } finally {
          await queue.close();
        }
      }
      await expect(inspectReviewPausedConsumers(runtime, expected)).rejects.toThrow();
      await expect(
        inspectReviewPausedConsumers(runtime, { ...expected, count: 1 })
      ).rejects.toThrow('Only the admitted full worker');
    } finally {
      await Promise.all(workers.map((worker) => worker.close()));
    }
  });

  it('refuses an unpaused queue before accepting the consumer inventory', async () => {
    await prepareReviewQueues(runtime, evidence, redis);
    const queue = runtime.createQueue(ALL_QUEUE_NAMES[0]);
    try {
      await queue.resume();
    } finally {
      await queue.close();
    }
    await expect(
      inspectReviewPausedConsumers(runtime, { address: '172.30.99.11', paused: true, count: 0 })
    ).rejects.toThrow('remain paused');
  });

  it('rejects an incomplete runtime inventory before creating metadata', async () => {
    await expect(
      prepareReviewQueues({ ...runtime, names: ALL_QUEUE_NAMES.slice(1) }, evidence, redis)
    ).rejects.toThrow(/inventory/);
    expect(await redis.dbsize()).toBe(0);
  });

  it('preserves a partial pause and original durable work when the next queue cannot open', async () => {
    const names = [...ALL_QUEUE_NAMES].sort();
    const before = await preservedState();
    await expect(
      prepareReviewQueues(
        {
          ...runtime,
          createQueue(name) {
            if (name === names[1]) throw new Error('Fixture Redis boundary failure');
            return runtime.createQueue(name);
          },
        },
        evidence,
        redis
      )
    ).rejects.toThrow('Fixture Redis boundary failure');
    const queue = runtime.createQueue(names[0]);
    try {
      expect(await queue.isPaused()).toBe(true);
    } finally {
      await queue.close();
    }
    expect(await preservedState()).toEqual(before);
    await expect(prepareReviewQueues(runtime, evidence, redis)).rejects.toThrow(/Redis/);
  });

  it('retains paused queues and pending jobs when a consumer appears during preparation', async () => {
    let worker: Worker | undefined;
    let workerConnection: Redis | undefined;
    try {
      await expect(
        prepareReviewQueues(
          {
            ...runtime,
            createQueue(name) {
              const queue = runtime.createQueue(name);
              const original = queue.getWorkers.bind(queue);
              queue.getWorkers = async () => {
                if (!worker) {
                  workerConnection = redis.duplicate({ maxRetriesPerRequest: null });
                  worker = new Worker(name, async () => undefined, {
                    connection: workerConnection,
                  });
                  await worker.waitUntilReady();
                }
                return original();
              };
              return queue;
            },
          },
          evidence,
          redis
        )
      ).rejects.toThrow(/consumer/);
      const queue = runtime.createQueue([...ALL_QUEUE_NAMES].sort()[0]);
      try {
        expect(await queue.isPaused()).toBe(true);
      } finally {
        await queue.close();
      }
      expect(
        await sottoTransaction(instance.database, (transaction) =>
          sottoJobOutbox(transaction).listIncomplete()
        )
      ).toMatchObject({ jobs: expect.any(Array) });
    } finally {
      await worker?.close();
      await workerConnection?.quit();
    }
  });

  it('refuses active canonical executions after queues are paused', async () => {
    const job = evidence.jobs[0];
    await sottoTransaction(instance.database, async (transaction) => {
      await sottoJobExecutions(transaction).begin({
        id: '11111111-1111-4111-8111-111111111111',
        parentId: job.id,
        fingerprint: job.fingerprint,
        executorId: '22222222-2222-4222-8222-222222222222',
      });
    });
    await expect(prepareReviewQueues(runtime, evidence, redis)).rejects.toThrow(/execution/);
    const queue = runtime.createQueue(ALL_QUEUE_NAMES[0]);
    try {
      expect(await queue.isPaused()).toBe(true);
    } finally {
      await queue.close();
    }
  });

  it('refuses unfinished canonical cleanup after queues are paused', async () => {
    await sottoTransaction(instance.database, async (transaction) => {
      const journal = new StorageCleanupJournal(
        {
          query: (sql, values) =>
            transaction.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      await journal.createJob(
        prepareStorageCleanup({
          namespace: SIDEDOOR_STATE_ID,
          subjectId: 'fixture-cleanup',
          generation: 1,
        })
      );
    });
    await expect(prepareReviewQueues(runtime, evidence, redis)).rejects.toThrow(/cleanup/);
  });
});
