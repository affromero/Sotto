import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { Client } from 'pg';
import Redis from 'ioredis';
import {
  AccessService,
  HouseholdProfileService,
  accessStateSchema,
  hashPassword,
  initialAccessState,
  initializeAccess,
} from 'thesidedoor-core/access';
import { OptimisticStateStore } from 'thesidedoor-core/storage/optimistic';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import { JobExecutionJournal, JobOutbox, prepareJob } from 'thesidedoor-core/runtime/outbox';
import { StorageInstanceControl } from 'thesidedoor-core/storage/instance';
import {
  StorageBackendRegistry,
  StorageCleanupJournal,
  prepareStorageBackend,
  prepareStorageCleanup,
  storageBackendBinding,
} from 'thesidedoor-core/storage';
import { observe } from '../../deploy/review/observer';

/** Produce real historical records before the final application's migration/runtime test. */
export async function seedWorksheetScenario(options: {
  schema: string;
  migrations: string[];
  storageRoot: string;
}) {
  assert.match(options.schema, /^review_worksheet_[a-f0-9]{32}$/);
  assert.ok(process.env.DATABASE_URL);
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  try {
    await database.query(`CREATE SCHEMA "${options.schema}"`);
    await database.query(`SET search_path TO "${options.schema}",public`);
    for (const migration of options.migrations) await database.query(migration);
    const executor = {
      query: async (sql: string, values: readonly unknown[]) =>
        (await database.query(sql, [...values])).rows,
    };
    const namespace = 'sotto-platform-v2';
    const authority = new OptimisticStateStore({
      backend: sqlStateBackend(executor, 'postgres', 'worksheet-fixture-access'),
      parse: accessStateSchema.parse,
      initial: initialAccessState,
    });
    const createdAt = 1_700_000_000_000;
    const password = 'historical worksheet fixture password';
    const passwordHash = await hashPassword(password);
    const ownerId = randomUUID();
    const memberId = randomUUID();
    const principals = [
      { id: ownerId, name: 'Owner', role: 'owner' as const, passwordHash, epoch: 0, createdAt },
      {
        id: memberId,
        name: 'Member',
        role: 'member' as const,
        passwordHash: null,
        epoch: 0,
        createdAt,
      },
    ];
    await initializeAccess(authority, 'worksheet-fixture', {
      principals,
      mode: 'household',
      householdPasswordHash: passwordHash,
    });
    const access = new AccessService({ store: authority });
    const token = await access.enterHousehold(password);
    await new HouseholdProfileService(access).select(token, ownerId);
    assert.equal((await new HouseholdProfileService(access).selected(token))?.id, ownerId);
    const memberToken = await access.enterHousehold(password);
    await new HouseholdProfileService(access).select(memberToken, memberId);
    for (const principal of principals) {
      await database.query(
        'INSERT INTO "User" (id,email,name,role,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$5)',
        [
          principal.id,
          `sidedoor+${principal.id}@localhost.invalid`,
          principal.name,
          principal.role === 'owner' ? 'ADMIN' : 'USER',
          new Date(createdAt),
        ]
      );
    }
    await database.query('INSERT INTO "SidedoorState" VALUES ($1,$2,$3)', [
      namespace,
      randomUUID(),
      {
        version: 2,
        revision: 0,
        access: await authority.read(),
        configuration: {
          site: { storageProvider: 'local', localStorageRoot: options.storageRoot },
          automaticModels: null,
        },
      },
    ]);
    const instanceControl = new StorageInstanceControl(executor, 'postgres', namespace);
    await instanceControl.initialize(randomUUID());
    const instance = await instanceControl.read();
    const curriculumId = randomUUID();
    const lessonId = randomUUID();
    const courseId = randomUUID();
    const classId = randomUUID();
    const reference = '/api/storage/worksheets/retained-fixture.pdf';
    await database.query(
      'INSERT INTO "Curriculum" (id,"nativeLang","targetLang",title,"updatedAt") VALUES ($1,\'en\',\'es\',\'Fixture\',$2)',
      [curriculumId, new Date(createdAt)]
    );
    await database.query(
      'INSERT INTO "Lesson" (id,"curriculumId",level,"order",slug,title,objective,"grammarPoints","vocabThemes","targetVocab","updatedAt") VALUES ($1,$2,\'A1\',0,\'fixture\',\'Fixture\',\'Practice\',\'[]\',\'[]\',\'[]\',$3)',
      [lessonId, curriculumId, new Date(createdAt)]
    );
    await database.query(
      'INSERT INTO "Course" (id,"userId","nativeLang","targetLang","curriculumId","createdAt","updatedAt") VALUES ($1,$2,\'en\',\'es\',$3,$4,$4)',
      [courseId, ownerId, curriculumId, new Date(createdAt)]
    );
    await database.query(
      'INSERT INTO "CourseClass" (id,"courseId","lessonId","order","worksheetPdfUrl","createdAt","updatedAt") VALUES ($1,$2,$3,0,$4,$5,$6)',
      [classId, courseId, lessonId, reference, new Date(createdAt), new Date(createdAt + 1000)]
    );
    const scopes = [
      { subjectId: instance.subjectId, generation: instance.generation },
      { subjectId: `course:${courseId}`, generation: createdAt },
      { subjectId: `profile:${ownerId}`, generation: createdAt },
    ].sort((left, right) => left.subjectId.localeCompare(right.subjectId));
    const outbox = new JobOutbox(executor, 'postgres', namespace);
    const jobs = [];
    for (let index = 0; index < 3; index++) {
      const record = await outbox.enqueue(
        prepareJob({
          namespace,
          handler: 'worksheet-pdf',
          version: 1,
          payload: {
            classId,
            classUpdatedAt: createdAt + index,
            appBaseUrl: 'https://demo.sotto.fm',
          },
          scopes,
          delivery: { attempts: 2, priority: 0, availableAt: 0 },
        })
      );
      if (index > 0) await outbox.acknowledgeDelivery(record.job.id, record.fingerprint);
      jobs.push({ id: record.job.id, fingerprint: record.fingerprint, job: record.job });
    }
    return {
      schema: options.schema,
      jobs,
      classId,
      courseId,
      reference,
      scopes,
      profiles: [
        { id: ownerId, token },
        { id: memberId, token: memberToken },
      ],
      before: await worksheetSnapshot(database),
    };
  } finally {
    await database.end();
  }
}

async function worksheetSnapshot(database: Client) {
  const result = await database.query(`SELECT json_build_object(
    'state',(SELECT json_agg(s ORDER BY id) FROM "SidedoorState" s),
    'users',(SELECT json_agg(p ORDER BY id) FROM
      (SELECT id,email,name,role,"createdAt","updatedAt" FROM "User") p),
    'classes',(SELECT json_agg(c ORDER BY id) FROM
      (SELECT id,"courseId","lessonId","updatedAt","worksheetPdfUrl" FROM "CourseClass") c),
    'courses',(SELECT json_agg(c ORDER BY id) FROM
      (SELECT id,"userId","createdAt","updatedAt" FROM "Course") c)) AS proof`);
  return createHash('sha256').update(JSON.stringify(result.rows[0].proof)).digest('hex');
}

export async function migrateWorksheetScenario(options: { schema: string; migrations: string[] }) {
  assert.match(options.schema, /^review_worksheet_[a-f0-9]{32}$/);
  assert.ok(options.migrations.length <= 16);
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  try {
    await database.query(`SET search_path TO "${options.schema}",public`);
    for (const migration of options.migrations) await database.query(migration);
    return { preserved: await worksheetSnapshot(database) };
  } finally {
    await database.end();
  }
}

export async function runScenario(scenario: string, bundle: string) {
  assert.ok(process.env.DATABASE_URL);
  assert.ok(process.env.REDIS_URL);
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 0 });
  const schema = 'review_observer_' + randomUUID().replaceAll('-', '');
  await database.connect();
  try {
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(`SET search_path TO "${schema}"`);
    await database.query(
      'CREATE TABLE "SidedoorState" (id text PRIMARY KEY, revision text NOT NULL, state jsonb NOT NULL)'
    );
    const executor = {
      query: async (sql: string, values: readonly unknown[]) =>
        (await database.query(sql, [...values])).rows,
    };
    const namespace = 'sotto-platform-v2';
    await database.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await new StorageInstanceControl(executor, 'postgres', namespace).initialize(randomUUID());
    const access = initialAccessState();
    access.principals = [
      {
        id: 'owner',
        name: 'Private owner',
        role: 'owner',
        passwordHash: 'PRIVATE_PASSWORD_HASH',
        epoch: 0,
        createdAt: 1,
      },
      {
        id: 'member',
        name: 'Private member',
        role: 'member',
        passwordHash: null,
        epoch: 0,
        createdAt: 1,
      },
    ];
    access.householdProfiles = [
      { id: 'owner', name: 'Private owner', epoch: 0 },
      { id: 'member', name: 'Private member', epoch: 0 },
    ];
    const model = {
      aiProvider: 'anthropic',
      aiModel: 'historical-model',
      ttsProvider: 'openai',
      ttsModel: 'selected-tts',
      sttProvider: 'openai',
      sttModel: 'selected-stt',
    };
    await database.query('INSERT INTO "SidedoorState" VALUES ($1,$2,$3)', [
      namespace,
      randomUUID(),
      {
        version: 2,
        access,
        configuration: {
          automaticModels: { model, platform: model },
          site: { storageProvider: 'local' },
        },
      },
    ]);
    const outbox = new JobOutbox(executor, 'postgres', namespace);
    const capturedScope = { subjectId: 'PRIVATE_CAPTURED_SCOPE', generation: 0 };
    const jobs = [];
    for (let index = 0; index < 3; index++) {
      const job = await outbox.enqueue(
        prepareJob({
          namespace,
          handler: 'worksheet-pdf',
          version: 1,
          payload: { privateText: 'PRIVATE_WORKSHEET_BODY' },
          scopes: [capturedScope],
          delivery: { attempts: 1, priority: 0, availableAt: 0 },
        })
      );
      jobs.push(job);
      if (index > 0) await outbox.acknowledgeDelivery(job.job.id, job.fingerprint);
      if (scenario === 'complete') await outbox.complete(job.job.id, job.fingerprint);
    }
    if (scenario.startsWith('deletion-') || scenario === 'erased') {
      const cleanup = new StorageCleanupJournal(executor, 'postgres', namespace);
      const deletion = prepareStorageCleanup({
        namespace,
        ...capturedScope,
        generation: scenario === 'deletion-generation' ? 1 : capturedScope.generation,
      });
      await cleanup.createJob(deletion);
      if (scenario === 'deletion-matching') {
        const location = {
          kind: 'object' as const,
          endpoint: 'https://storage.example',
          bucket: 'fixture',
        };
        const backend = prepareStorageBackend(namespace, {
          kind: 'object',
          location,
          binding: storageBackendBinding(location),
        });
        await new StorageBackendRegistry(executor, 'postgres', namespace).register(backend);
        await cleanup.registerCollectors(deletion.id, 0, [
          {
            id: 'inventory',
            kind: 'inventory',
            scope: 'fixture/',
            backendIds: [backend.id],
          },
        ]);
        let progress = await cleanup.transition(deletion.id, 0);
        progress = await cleanup.recordDrainedIntents(progress.id, progress.epoch, null);
        const emptyInventory = () =>
          cleanup.recordCollectorPage({
            jobId: progress.id,
            epoch: progress.epoch,
            collectorId: 'inventory',
            after: null,
            next: null,
            targets: [],
          });
        progress = await emptyInventory();
        progress = await cleanup.transition(progress.id, progress.epoch);
        progress = await cleanup.transition(progress.id, progress.epoch);
        progress = await cleanup.beginVerification(progress.id, progress.epoch);
        progress = await emptyInventory();
        progress = await cleanup.transition(progress.id, progress.epoch);
        assert.equal(progress.phase, 'complete');
      }
      if (scenario === 'erased') {
        for (const job of jobs) {
          await outbox.complete(job.job.id, job.fingerprint);
          await outbox.erase(job.job.id, job.fingerprint, capturedScope);
        }
      }
      if (scenario === 'deletion-missing') {
        await database.query(
          "DELETE FROM \"SidedoorState\" WHERE state->>'kind' = 'storage_cleanup'"
        );
      }
      if (scenario === 'deletion-malformed') {
        await database.query(
          "UPDATE \"SidedoorState\" SET state = jsonb_set(state,'{phase}','\"invalid\"') WHERE state->>'kind' = 'storage_cleanup'"
        );
      }
    }
    if (scenario === 'active') {
      const job = jobs[0];
      await new JobExecutionJournal(executor, 'postgres', namespace).begin({
        id: randomUUID(),
        executorId: randomUUID(),
        parentId: job.job.id,
        fingerprint: job.fingerprint,
      });
    }
    if (scenario === 'invalid') {
      await database.query(
        "UPDATE \"SidedoorState\" SET state = jsonb_set(state,'{job,payload}','{}') WHERE state->>'kind' = 'outbox_job'"
      );
    }
    if (scenario === 'orphan') {
      await database.query("DELETE FROM \"SidedoorState\" WHERE state->>'kind' = 'outbox_pending'");
    }
    if (scenario === 'oversized') {
      await database.query('INSERT INTO "SidedoorState" VALUES ($1,$2,$3)', [
        'oversized',
        randomUUID(),
        { privateText: 'x'.repeat(2 * 1024 * 1024) },
      ]);
    }
    await database.query('COMMIT');
    const snapshot = async () =>
      JSON.stringify((await database.query('SELECT * FROM "SidedoorState" ORDER BY id')).rows);
    const before = await snapshot();
    if (scenario === 'deletion-missing' || scenario === 'deletion-malformed') {
      await assert.rejects(
        () =>
          observe({ query: async (sql, values = []) => database.query(sql, [...values]) }, redis),
        scenario === 'deletion-missing' ? /Storage cleanup job is missing/ : { name: 'ZodError' }
      );
      assert.equal(await snapshot(), before);
      return { scenario, readOnly: true, unchanged: true, zeroWork: false, jobs: 3 };
    }
    if (scenario === 'oversized') {
      await assert.rejects(
        () =>
          observe({ query: async (sql, values = []) => database.query(sql, [...values]) }, redis),
        /inspection byte or row bound/
      );
      assert.equal(await snapshot(), before);
      return { scenario, readOnly: true, unchanged: true, zeroWork: false, jobs: 3 };
    }
    let writeRejected = false;
    const result = await observe(
      {
        query: async (sql, values = []) => {
          const response = await database.query(sql, [...values]);
          if (sql.startsWith('BEGIN')) {
            await database.query('SAVEPOINT readonly_proof');
            try {
              await database.query(
                "INSERT INTO \"SidedoorState\" VALUES ('forbidden','revision','{}')"
              );
            } catch (error) {
              writeRejected = (error as { code: string }).code === '25006';
            }
            await database.query('ROLLBACK TO SAVEPOINT readonly_proof');
          }
          return response;
        },
      },
      scenario === 'deletion-matching'
        ? { dbsize: async () => 0, scan: async (): Promise<[string, string[]]> => ['0', []] }
        : redis
    );
    assert.equal(await snapshot(), before);
    assert.equal(writeRejected, true);
    assert.equal(result.database.readOnly, true);
    assert.equal(result.access.profileCount, 2);
    assert.deepEqual(result.access.principals, [
      { id: 'owner', role: 'owner' },
      { id: 'member', role: 'member' },
    ]);
    assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
    if (scenario === 'deletion-matching') {
      assert.equal(result.redis.empty, true);
      assert.equal(result.executions.length, 0);
      assert.ok(
        result.cleanup.every(
          (item) =>
            item.phase === 'complete' &&
            item.pending === 0 &&
            item.unresolvedManifests === 0 &&
            item.remainingCollectors === 0
        )
      );
    }
    if (scenario === 'cli') {
      const streamed = spawnSync(process.execPath, ['-'], {
        input: bundle,
        encoding: 'utf8',
        timeout: 15000,
        env: { ...process.env, PGOPTIONS: '-c search_path=' + schema },
      });
      assert.equal(streamed.status, 0, streamed.stderr);
      const actual = JSON.parse(streamed.stdout) as {
        database: { readOnly: boolean };
        jobs: unknown[];
      };
      assert.equal(actual.database.readOnly, true);
      assert.equal(actual.jobs.length, 3);
      assert.equal(await snapshot(), before);
    }
    if (scenario === 'stalled-redis') {
      const server = createServer();
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const started = Date.now();
      try {
        const stalled = spawnSync(process.execPath, ['-'], {
          input: bundle,
          encoding: 'utf8',
          timeout: 12000,
          env: {
            ...process.env,
            PGOPTIONS: '-c search_path=' + schema,
            REDIS_URL: 'redis://127.0.0.1:' + address.port,
          },
        });
        assert.equal(stalled.status, 1, stalled.stderr);
        assert.equal(stalled.stdout, '');
        assert.match(stalled.stderr, /Read-only review observation failed/);
        assert.ok(Date.now() - started < 11000);
        assert.equal(await snapshot(), before);
      } finally {
        server.close();
      }
    }
    if (scenario === 'complete') assert.equal(result.zeroWork, result.redis.empty);
    else if (scenario === 'erased') {
      assert.equal(result.zeroWork, false);
      assert.ok(result.jobs.every((job) => job.status === 'erased' && !job.deletionProof));
    } else {
      assert.equal(result.zeroWork, false);
      assert.equal(result.jobs.length, 3);
      if (scenario === 'invalid') assert.ok(result.jobs.every((job) => job.status === 'invalid'));
      else assert.equal(result.jobs.filter((job) => job.delivered).length, 2);
      if (scenario === 'active') assert.equal(result.executions[0].status, 'active');
      if (scenario !== 'invalid') {
        const status =
          scenario === 'deletion-matching'
            ? 'matching-deletion'
            : scenario === 'deletion-generation'
              ? 'inconsistent'
              : 'absent';
        for (const job of result.jobs) {
          assert.equal(job.status, 'pending');
          assert.equal(job.deletionProof?.status, status);
          assert.equal(job.deletionProof?.capturedScopeCount, 1);
          assert.equal(job.deletionProof?.matching, scenario === 'deletion-matching' ? 1 : 0);
          assert.equal(job.deletionProof?.mismatched, scenario === 'deletion-generation' ? 1 : 0);
          assert.equal(job.deletionProof?.absent, status === 'absent' ? 1 : 0);
          assert.deepEqual(
            job.deletionProof?.matchingCleanupPhases,
            scenario === 'deletion-matching' ? { complete: 1 } : {}
          );
        }
      }
    }
    return {
      scenario,
      readOnly: true,
      unchanged: true,
      zeroWork: result.zeroWork,
      jobs: result.jobs.length,
    };
  } finally {
    await database.query('ROLLBACK');
    await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await database.end();
    redis.disconnect();
  }
}
