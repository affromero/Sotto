'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readdir, readFile } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { join } = require('node:path');

const LIMIT = 10000;
const LEGACY_TABLES = [
  'UserVisualCueKey',
  'UserAiKey',
  'UserTtsKey',
  'AutoModelConfig',
  'SiteConfig',
];

function connectionIdentity(environment, namespace) {
  const database = new URL(environment.DATABASE_URL);
  const redis = new URL(environment.REDIS_URL);
  const endpoint = (url, port) => [url.protocol, url.hostname, url.port || port, url.pathname];
  return createHash('sha256')
    .update(
      JSON.stringify({
        namespace,
        database: [...endpoint(database, '5432'), database.searchParams.get('schema')],
        redis: endpoint(redis, '6379'),
      })
    )
    .digest('hex');
}

function validateManifest(manifest, names, identity) {
  assert(manifest && typeof manifest === 'object', 'Original queue manifest required');
  const additive = manifest.schemaVersion === 2;
  assert.deepEqual(
    Object.keys(manifest).sort(),
    additive
      ? ['connectionIdentity', 'queueTransition', 'queues', 'schemaVersion']
      : ['connectionIdentity', 'queues', 'schemaVersion']
  );
  assert.equal(manifest.schemaVersion, additive ? 2 : 1);
  assert.equal(manifest.connectionIdentity, identity, 'Queue connection identity changed');
  if (additive) {
    validateTransition(manifest.queueTransition, names);
    names = manifest.queueTransition.candidateQueues;
  }
  assert(Array.isArray(manifest.queues));
  assert.deepEqual(manifest.queues.map((queue) => queue.name).sort(), names);
  for (const queue of manifest.queues) {
    assert.deepEqual(Object.keys(queue).sort(), ['name', 'paused']);
    assert.equal(typeof queue.paused, 'boolean');
  }
}

function validateTransition(transition, names, snapshot = false) {
  assert(
    transition && typeof transition === 'object',
    'Reviewed additive queue transition required'
  );
  assert.deepEqual(Object.keys(transition).sort(), [
    'addedQueues',
    'candidateQueues',
    'previousQueues',
  ]);
  for (const list of Object.values(transition)) {
    assert(Array.isArray(list) && list.length > 0 && list.length <= 100);
    assert(list.every((name) => typeof name === 'string' && /^[a-z][a-z-]*$/.test(name)));
    assert.deepEqual(list, [...new Set(list)].sort(), 'Queue names must be sorted and unique');
  }
  const { previousQueues, candidateQueues, addedQueues } = transition;
  assert(
    previousQueues.every((name) => candidateQueues.includes(name)),
    'Queue removal is unsupported'
  );
  assert.deepEqual(
    addedQueues,
    candidateQueues.filter((name) => !previousQueues.includes(name)),
    'Exact added queues required'
  );
  assert(
    snapshot ||
      JSON.stringify(names) === JSON.stringify(candidateQueues) ||
      JSON.stringify(names) === JSON.stringify(previousQueues),
    'Runtime queue inventory changed'
  );
  if (snapshot)
    assert.deepEqual(names, previousQueues, 'Snapshot requires the captured previous runtime');
}

async function readOnly(database, operation, isolationLevel = 'RepeatableRead') {
  return database.$transaction(
    async (transaction) => {
      await transaction.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await transaction.$executeRawUnsafe("SET LOCAL statement_timeout='15s'");
      return operation(transaction);
    },
    { isolationLevel, timeout: 20000, maxWait: 5000 }
  );
}

function hasFishSelection(value, depth = 0) {
  assert(depth <= 64, 'Provider selection inspection depth exceeded');
  if (Array.isArray(value)) return value.some((item) => hasFishSelection(item, depth + 1));
  if (!value || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value)) {
    if (
      ['provider', 'providerId', 'ttsProvider', 'preferredTtsProvider'].includes(key) &&
      child === 'fish'
    )
      return true;
    if (
      key === 'includedTtsModels' &&
      Array.isArray(child) &&
      child.some((model) => typeof model === 'string' && model.startsWith('fish:'))
    )
      return true;
    if (hasFishSelection(child, depth + 1)) return true;
  }
  return false;
}

async function activationReady(runtime, queues) {
  const inspectedCredentials = await readOnly(
    runtime.database,
    async (transaction) => {
      const state = await runtime.sidedoorStateStore(transaction).read();
      assert(
        !hasFishSelection(state.configuration),
        'Existing Fish configuration requires separate review'
      );
      assert(
        !(await transaction.user.findFirst({
          where: { preferredTtsProvider: 'fish' },
          select: { id: true },
        })),
        'Existing Fish preference requires separate review'
      );
      const storage = await runtime.sottoCredentialRows(transaction);
      for (const [model, field] of [
        ['episode', 'ttsProvider'],
        ['segment', 'ttsProvider'],
        ['episodeVoice', 'provider'],
      ])
        assert(
          !(await transaction[model].findFirst({
            where: { [field]: 'fish' },
            select: { id: true },
          })),
          'Existing Fish audio state requires separate review'
        );
      let inspected = 0;
      for (const inventory of [storage.owned, storage.sharing]) {
        let cursor = null;
        do {
          const page = await inventory.list(cursor, 100);
          inspected += page.items.length;
          assert(inspected <= LIMIT, 'Credential inspection bound exceeded');
          assert(
            !page.items.some((item) => item.provider === 'fish'),
            'Existing Fish credentials require separate review'
          );
          cursor = page.cursor;
        } while (cursor !== null);
      }
      return inspected;
    },
    'Serializable'
  );
  let inspectedJobs = 0;
  for (const queue of queues) {
    for (let offset = 0; ; offset += 100) {
      const jobs = await queue.getJobs(undefined, offset, offset + 99);
      inspectedJobs += jobs.length;
      assert(inspectedJobs <= LIMIT, 'Job inspection bound exceeded');
      assert(
        !jobs.some((job) => hasFishSelection(job.data)),
        'Existing Fish queued work requires separate review'
      );
      if (jobs.length < 100) break;
    }
  }
  return { activationReady: true, inspectedCredentials, inspectedJobs };
}

async function inspectExecutions(runtime) {
  return readOnly(runtime.database, async (transaction) => {
    const rows = await transaction.$queryRawUnsafe(
      'SELECT "state" FROM "SidedoorState" WHERE "state"->>\'kind\' = $1 LIMIT 10001',
      'job_execution'
    );
    assert(rows.length <= LIMIT, 'Execution inspection bound exceeded');
    const journal = runtime.sottoJobExecutions(transaction);
    const outbox = runtime.sottoJobOutbox(transaction);
    const summary = { inspected: 0, settled: 0, synchronousActive: 0, workerActive: 0 };
    for (const { state } of rows) {
      const record = await journal.read({
        id: state.id,
        parentId: state.parentId,
        fingerprint: state.fingerprint,
        executorId: state.executorId,
      });
      summary.inspected++;
      if (record.status === 'settled') {
        summary.settled++;
        continue;
      }
      assert.equal(record.status, 'active', 'Execution cleanup is unresolved');
      const receipt = await outbox.receipt(record.parentId);
      assert(
        receipt && receipt.id === record.parentId && receipt.fingerprint === record.fingerprint,
        'Execution parent receipt does not match'
      );
      assert(
        ['pending', 'complete'].includes(receipt.status),
        'Unexpected execution parent status'
      );
      const parent = await outbox.read(record.parentId);
      assert(
        parent && parent.job.id === record.parentId && parent.fingerprint === record.fingerprint,
        'Execution parent work does not match'
      );
      assert.equal(parent.job.handler, receipt.handler);
      assert.equal(parent.job.version, receipt.version);
      assert.equal(parent.complete, receipt.status === 'complete');
      if (runtime.isSottoSynchronousJob(receipt.handler, receipt.version)) {
        assert.equal(receipt.handler, 'learning-writing');
        assert.equal(receipt.version, 1);
        if (receipt.status === 'pending') summary.synchronousActive++;
        else summary.workerActive++;
      } else {
        runtime.requireSottoJobVersion(receipt.handler, receipt.version);
        summary.workerActive++;
      }
    }
    return summary;
  });
}

async function established(runtime) {
  const entries = await readdir(runtime.migrationDirectory, { withFileTypes: true });
  const migrations = new Map();
  for (const entry of entries
    .filter((item) => item.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const raw = await readFile(join(runtime.migrationDirectory, entry.name, 'migration.sql'));
    migrations.set(entry.name, createHash('sha256').update(raw).digest('hex'));
  }
  assert(migrations.size > 0, 'Committed migration inventory is missing');
  return readOnly(runtime.database, async (transaction) => {
    const state = await runtime.sidedoorStateStore(transaction).read();
    await runtime.sottoStorageInstance(transaction).read();
    assert(
      state.configuration.site !== null && state.configuration.automaticModels !== null,
      'Canonical configuration is incomplete'
    );
    const legacy = await transaction.$queryRawUnsafe(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1::text[])',
      LEGACY_TABLES
    );
    assert.equal(legacy.length, 0, 'Platform conversion is not finalized');
    const applied = await transaction.$queryRawUnsafe(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"'
    );
    assert.equal(applied.length, migrations.size, 'Applied migration inventory differs');
    const seen = new Set();
    for (const migration of applied) {
      assert(
        migration.finished_at !== null && migration.rolled_back_at === null,
        'Migration is unfinished or rolled back'
      );
      assert(!seen.has(migration.migration_name), 'Duplicate applied migration');
      seen.add(migration.migration_name);
      assert.equal(
        migration.checksum,
        migrations.get(migration.migration_name),
        'Applied migration differs from committed bytes'
      );
    }
    return { established: true, appliedMigrations: applied.length };
  });
}

async function databaseIdentity(runtime) {
  return readOnly(runtime.database, async (transaction) => {
    const rows = await transaction.$queryRawUnsafe(
      'SELECT current_database() AS "databaseName", current_schema() AS "schemaName", inet_server_addr()::text AS "serverAddress", inet_server_port() AS "serverPort", (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid"'
    );
    assert.equal(rows.length, 1, 'Unique database identity required');
    const identity = rows[0];
    for (const key of ['databaseName', 'schemaName', 'serverAddress', 'databaseOid'])
      assert(typeof identity[key] === 'string' && identity[key].length > 0);
    assert(Number.isInteger(identity.serverPort) && identity.serverPort > 0);
    const schema = new URL(runtime.environment.DATABASE_URL).searchParams.get('schema');
    if (schema !== null) assert.equal(identity.schemaName, schema, 'Configured schema differs');
    return { databaseIdentity: identity };
  });
}

async function schemaIndex(runtime) {
  return readOnly(runtime.database, async (transaction) => {
    const rows = await transaction.$queryRawUnsafe(
      'SELECT n.nspname AS "schemaName", quote_ident(n.nspname) AS "quotedSchema", t.relname AS "tableName", x.relname AS "indexName", am.amname AS "accessMethod", i.indisvalid AS "isValid", i.indisready AS "isReady", i.indislive AS "isLive", i.indisunique AS "isUnique", i.indisprimary AS "isPrimary", i.indisexclusion AS "isExclusion", i.indnkeyatts::integer AS "keyCount", i.indnatts::integer AS "attributeCount", i.indexprs IS NULL AS "noExpressions", i.indpred IS NULL AS "noPredicate", a.attname AS "columnName", o.opcname AS "operatorClass", ons.nspname AS "operatorNamespace", i.indoption[0]::integer AS "ordering", i.indcollation[0] = a.attcollation AS "defaultCollation", x.relnamespace = t.relnamespace AS "sameSchema", pg_get_indexdef(x.oid) AS "definition" FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class x ON x.oid = i.indexrelid JOIN pg_catalog.pg_class t ON t.oid = i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace JOIN pg_catalog.pg_am am ON am.oid = x.relam JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0] JOIN pg_catalog.pg_opclass o ON o.oid = i.indclass[0] JOIN pg_catalog.pg_namespace ons ON ons.oid = o.opcnamespace WHERE n.nspname = current_schema() AND t.relname = \'SidedoorState\' AND x.relname = \'SidedoorState_id_pattern_idx\''
    );
    assert.equal(rows.length, 1, 'Exact shared-state index required');
    return { indexProof: rows[0] };
  });
}

/** Dependencies are the actual database, queue and filesystem boundaries in tests. */
async function run(input, runtime) {
  assert(input && typeof input === 'object');
  assert(
    Object.keys(input).every((key) => ['command', 'manifest', 'queueTransition'].includes(key))
  );
  if (input.queueTransition !== undefined)
    assert(
      input.command === 'snapshot' && input.manifest === undefined,
      'Transition is admitted only by an original snapshot'
    );
  assert(
    [
      'snapshot',
      'observe',
      'pause',
      'drained',
      'drained-all',
      'restore',
      'established',
      'database-identity',
      'schema-index',
      'activation-ready',
    ].includes(input.command)
  );
  const identity = connectionIdentity(runtime.environment, runtime.namespace);
  let base = { schemaVersion: 1, connectionIdentity: identity };
  if (input.command === 'established') return { ...base, ...(await established(runtime)) };
  if (input.command === 'database-identity')
    return { ...base, ...(await databaseIdentity(runtime)) };
  let names = [...runtime.names].sort();
  assert(names.length > 0 && new Set(names).size === names.length);
  if (
    input.manifest !== undefined ||
    ['pause', 'drained', 'drained-all', 'restore', 'schema-index'].includes(input.command)
  )
    validateManifest(input.manifest, names, identity);
  const transition = input.queueTransition ?? input.manifest?.queueTransition;
  if (transition !== undefined) {
    validateTransition(transition, names, input.command === 'snapshot');
    names = transition.candidateQueues;
    base = { schemaVersion: 2, connectionIdentity: identity, queueTransition: transition };
  }
  if (input.command === 'schema-index') return { ...base, ...(await schemaIndex(runtime)) };
  const queues = [];
  try {
    for (const name of names) queues.push(runtime.createQueue(name));
    if (input.command === 'activation-ready')
      return { ...base, ...(await activationReady(runtime, queues)) };
    if (input.command === 'pause') {
      for (const queue of queues) await queue.pause();
    }
    if (input.command === 'restore') {
      for (const queue of queues) {
        if (input.manifest.queues.find((item) => item.name === queue.name).paused)
          await queue.pause();
        else await queue.resume();
      }
    }
    const snapshot = [];
    for (const queue of queues) snapshot.push({ name: queue.name, paused: await queue.isPaused() });
    if (['pause', 'drained', 'drained-all'].includes(input.command))
      assert(
        snapshot.every((queue) => queue.paused),
        'Queues must remain paused'
      );
    if (input.command === 'restore') {
      const expected = [...input.manifest.queues].sort((a, b) => a.name.localeCompare(b.name));
      assert.deepEqual(snapshot, expected, 'Original queue pause states were not restored');
    }
    if (!['drained', 'drained-all'].includes(input.command)) return { ...base, queues: snapshot };
    const executions = await inspectExecutions(runtime);
    let activeJobs = 0;
    for (const queue of queues) {
      assert(await queue.isPaused(), 'Queue fence changed during inspection');
      activeJobs += await queue.getActiveCount();
    }
    return {
      ...base,
      queues: snapshot,
      activeJobs,
      executions,
      drained:
        activeJobs === 0 &&
        executions.workerActive === 0 &&
        (input.command !== 'drained-all' || executions.synchronousActive === 0),
    };
  } finally {
    const closed = await Promise.allSettled(queues.map((queue) => queue.close()));
    assert(
      closed.every((result) => result.status === 'fulfilled'),
      'Queue connection cleanup failed'
    );
  }
}

function productionRuntime() {
  const load = createRequire('/app/apps/web/package.json');
  const { Queue } = load('bullmq');
  const { ALL_QUEUE_NAMES } = load('/app/apps/web/src/lib/queue.ts');
  const { getSharedQueueRedisClient, closeRedis } = load('/app/apps/web/src/lib/redis.ts');
  const { prismaUnfiltered } = load('/app/apps/web/src/lib/prisma.ts');
  const store = load('/app/apps/web/src/lib/sidedoor/access/state/store.ts');
  return {
    ...store,
    ...load('/app/apps/web/src/lib/sidedoor/jobs/core/job-contracts.ts'),
    ...load('/app/apps/web/src/lib/sidedoor/jobs/core/job-execution-lifetime.ts'),
    ...load('/app/apps/web/src/lib/sidedoor/jobs/core/job-delivery.ts'),
    ...load('/app/apps/web/src/lib/sidedoor/credentials/runtime/provider-credentials.ts'),
    database: prismaUnfiltered,
    namespace: store.SIDEDOOR_STATE_ID,
    names: ALL_QUEUE_NAMES,
    environment: process.env,
    closeRedis,
    migrationDirectory: '/app/apps/web/prisma/migrations',
    createQueue: (name) =>
      new Queue(name, { connection: getSharedQueueRedisClient(), skipMetasUpdate: true }),
  };
}

async function main() {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk);
    assert(bytes <= 65536, 'Input bound exceeded');
    chunks.push(Buffer.from(chunk));
  }
  const input = JSON.parse(Buffer.concat(chunks).toString());
  const runtime = productionRuntime();
  try {
    console.log('SOTTO_DEPLOY_QUEUE=' + JSON.stringify(await run(input, runtime)));
  } finally {
    await Promise.all([runtime.closeRedis(), runtime.database.$disconnect()]);
  }
}

module.exports = { run, connectionIdentity, main };
if (require.main === module)
  main().catch(() => {
    console.error(
      'Deployment queue lifecycle failed. Preserve the original manifest and inspect existing state.'
    );
    process.exitCode = 1;
  });
