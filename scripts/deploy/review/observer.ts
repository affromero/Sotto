import { createHash } from 'node:crypto';
import { Client } from 'pg';
import Redis from 'ioredis';
import { accessStateSchema } from 'thesidedoor-core/access';
import { JobExecutionJournal, JobOutbox } from 'thesidedoor-core/runtime/outbox';
import { StorageCleanupJournal, StorageWriteJournal } from 'thesidedoor-core/storage';
import { StorageInstanceControl } from 'thesidedoor-core/storage/instance';
import { OwnedCredentials } from 'thesidedoor-core/configuration/owned-credentials';
import { CredentialSharing } from 'thesidedoor-core/configuration/credential-sharing';

const namespace = 'sotto-platform-v2';
const limit = 10_000;
type Row = Record<string, unknown>;
type Database = { query(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[] }> };
type RedisReader = {
  dbsize(): Promise<number>;
  scan(cursor: string, token: 'COUNT', count: number): Promise<[string, string[]]>;
};

function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid record');
  return value as Row;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200) throw new Error('Invalid identity');
  return value;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** This observer has no write or provider-execution capability. */
export async function observe(database: Database, redis: RedisReader) {
  await database.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
  try {
    await database.query("SET LOCAL statement_timeout = '5000ms'");
    const identity = (
      await database.query(
        "SELECT current_database() AS database, current_schema() AS schema, current_setting('transaction_read_only') AS read_only"
      )
    ).rows[0];
    if (identity?.read_only !== 'on') throw new Error('Read-only connection required');
    const budget = (
      await database.query(
        'SELECT count(*) AS count, COALESCE(max(octet_length(state::text)),0) AS maximum, COALESCE(sum(octet_length(state::text)),0) AS total FROM "SidedoorState"'
      )
    ).rows[0];
    const sizes = [budget?.count, budget?.maximum, budget?.total].map(Number);
    if (
      sizes.some((value) => !Number.isSafeInteger(value) || value < 0) ||
      sizes[0] > limit ||
      sizes[1] > 2 * 1024 * 1024 ||
      sizes[2] > 16 * 1024 * 1024
    )
      throw new Error('Historical state inspection byte or row bound exceeded');
    const executor = {
      query: async (sql: string, values: readonly unknown[]) =>
        (await database.query(sql, values)).rows,
    };
    const instance = await new StorageInstanceControl(executor, 'postgres', namespace).read();
    const envelopeRows = await database.query('SELECT state FROM "SidedoorState" WHERE id = $1', [
      namespace,
    ]);
    if (envelopeRows.rows.length !== 1) throw new Error('Missing platform state');
    const envelope = object(envelopeRows.rows[0].state);
    if (envelope.version !== 2) throw new Error('Unexpected platform state');
    const access = accessStateSchema.parse(envelope.access);
    const configuration = object(envelope.configuration);
    const automatic = object(configuration.automaticModels);
    const selected = object(automatic.model);
    const platform = object(automatic.platform);
    const site = object(configuration.site);

    const outbox = new JobOutbox(executor, 'postgres', namespace);
    const references = new Map<string, string>();
    for (const index of ['pending', 'incomplete'] as const) {
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const page: Awaited<ReturnType<JobOutbox['listPending']>> =
          index === 'pending'
            ? await outbox.listPending(cursor)
            : await outbox.listIncomplete(cursor);
        for (const item of page.jobs) {
          if (seen.has(item.id) || seen.size >= limit)
            throw new Error('Outbox inspection bound or duplicate');
          seen.add(item.id);
          const prior = references.get(item.id);
          if (prior !== undefined && prior !== item.fingerprint)
            throw new Error('Outbox index conflict');
          references.set(item.id, item.fingerprint);
          if (references.size > limit) throw new Error('Outbox inspection bound exceeded');
        }
        if (page.cursor !== null && (page.cursor === cursor || !page.jobs.length))
          throw new Error('Invalid outbox cursor');
        cursor = page.cursor;
      } while (cursor !== null);
    }
    // Read receipts even if an incomplete job has lost its discovery index.
    const storedJobs = (
      await database.query(
        "SELECT COALESCE(state->'job'->>'namespace',state->>'namespace') AS namespace, COALESCE(state->'job'->>'id',state->>'id') AS id, state->>'fingerprint' AS fingerprint FROM \"SidedoorState\" WHERE state->>'kind' = ANY($1::text[]) LIMIT 10001",
        [['outbox_job', 'outbox_erased']]
      )
    ).rows;
    if (storedJobs.length > limit) throw new Error('Stored outbox inspection bound exceeded');
    for (const row of storedJobs) {
      if (row.namespace !== namespace) throw new Error('Unexpected outbox namespace');
      const id = text(row.id);
      const fingerprint = text(row.fingerprint);
      const prior = references.get(id);
      if (prior !== undefined && prior !== fingerprint)
        throw new Error('Stored outbox index conflict');
      references.set(id, fingerprint);
      if (references.size > limit) throw new Error('Outbox inspection bound exceeded');
    }
    const cleanupJournal = new StorageCleanupJournal(executor, 'postgres', namespace);
    const writes = new StorageWriteJournal(executor, 'postgres', namespace);
    type DeletionProof = {
      status: 'absent' | 'matching-deletion' | 'inconsistent';
      capturedScopeCount: number;
      absent: number;
      matching: number;
      mismatched: number;
      matchingCleanupPhases: Record<string, number>;
    };
    const jobs: {
      id: string;
      status: string;
      handler?: string;
      version?: number;
      delivered?: boolean;
      matchesIndex?: boolean;
      deletionProof?: DeletionProof;
    }[] = [];
    for (const [id, fingerprint] of references) {
      let inspected: {
        receipt: NonNullable<Awaited<ReturnType<JobOutbox['receipt']>>>;
        record: Awaited<ReturnType<JobOutbox['read']>>;
      };
      try {
        const receipt = await outbox.receipt(id);
        if (!receipt) {
          jobs.push({ id, status: 'missing' });
          continue;
        }
        const record = receipt.status === 'erased' ? null : await outbox.read(id);
        if (receipt.status !== 'erased' && !record) throw new Error('Missing outbox record');
        inspected = { receipt, record };
      } catch {
        jobs.push({ id, status: 'invalid' });
        continue;
      }
      const { receipt, record } = inspected;
      let deletionProof: DeletionProof | undefined;
      if (receipt.status === 'pending' && record) {
        deletionProof = {
          status: 'absent',
          capturedScopeCount: record.job.scopes.length,
          absent: 0,
          matching: 0,
          mismatched: 0,
          matchingCleanupPhases: {},
        };
        for (const scope of record.job.scopes) {
          const tombstone = await writes.tombstone(scope.subjectId);
          if (!tombstone) {
            deletionProof.absent++;
            continue;
          }
          // Missing or malformed cleanup proof must fail the observation.
          const deletion = await cleanupJournal.get(tombstone.jobId);
          if (
            tombstone.generation !== scope.generation ||
            deletion.namespace !== namespace ||
            deletion.subjectId !== scope.subjectId ||
            deletion.generation !== scope.generation
          ) {
            deletionProof.mismatched++;
            continue;
          }
          deletionProof.matching++;
          deletionProof.matchingCleanupPhases[deletion.phase] =
            (deletionProof.matchingCleanupPhases[deletion.phase] ?? 0) + 1;
        }
        deletionProof.status = deletionProof.mismatched
          ? 'inconsistent'
          : deletionProof.matching
            ? 'matching-deletion'
            : 'absent';
      }
      jobs.push({
        id,
        status: receipt.status,
        handler: receipt.handler,
        version: receipt.version,
        matchesIndex: receipt.fingerprint === fingerprint,
        ...(record ? { delivered: record.delivered } : {}),
        ...(deletionProof ? { deletionProof } : {}),
      });
    }

    const executionRows = (
      await database.query(
        "SELECT state->>'id' AS id, state->>'parentId' AS \"parentId\", state->>'fingerprint' AS fingerprint, state->>'executorId' AS \"executorId\" FROM \"SidedoorState\" WHERE state->>'kind' = $1 LIMIT 10001",
        ['job_execution']
      )
    ).rows;
    if (executionRows.length > limit) throw new Error('Execution inspection bound exceeded');
    const journal = new JobExecutionJournal(executor, 'postgres', namespace);
    const executions = [];
    for (const row of executionRows) {
      const record = await journal.read({
        id: text(row.id),
        parentId: text(row.parentId),
        fingerprint: text(row.fingerprint),
        executorId: text(row.executorId),
      });
      executions.push({ id: record.id, status: record.status });
    }
    const cleanup = [];
    let cleanupCursor: string | null = null;
    do {
      const page = await cleanupJournal.listJobs(cleanupCursor);
      for (const item of page.jobs) {
        if (cleanup.length >= limit) throw new Error('Cleanup inspection bound exceeded');
        const job = await cleanupJournal.get(item.id);
        cleanup.push({
          id: job.id,
          phase: job.phase,
          pending: job.pending,
          unresolvedManifests: job.unresolvedManifests,
          remainingCollectors: job.remainingCollectors,
        });
      }
      if (page.cursor !== null && (page.cursor === cleanupCursor || !page.jobs.length))
        throw new Error('Invalid cleanup cursor');
      cleanupCursor = page.cursor;
    } while (cleanupCursor !== null);

    const owned = new OwnedCredentials(executor, 'postgres', {
      namespace,
      instanceId: instance.instanceId,
      descriptors: () => [],
      encryptionKey: () => {
        throw new Error('Credential resolution is forbidden in the observer');
      },
    });
    const sharing = new CredentialSharing(executor, 'postgres', namespace, instance.instanceId);
    const credentialCounts = { owned: 0, sharing: 0 };
    for (const kind of ['owned', 'sharing'] as const) {
      let cursor: string | null = null;
      const cursors = new Set<string>();
      do {
        const page:
          | Awaited<ReturnType<OwnedCredentials['list']>>
          | Awaited<ReturnType<CredentialSharing['list']>> =
          kind === 'owned' ? await owned.list(cursor, 100) : await sharing.list(cursor, 100);
        credentialCounts[kind] += page.items.length;
        if (credentialCounts[kind] > limit) throw new Error('Credential inspection bound exceeded');
        if (page.cursor !== null) {
          if (cursors.has(page.cursor) || cursors.size >= 100)
            throw new Error('Invalid credential cursor');
          cursors.add(page.cursor);
        }
        cursor = page.cursor;
      } while (cursor !== null);
    }

    const before = await redis.dbsize();
    let redisCursor = '0';
    let scanned = 0;
    let scans = 0;
    do {
      const page = await redis.scan(redisCursor, 'COUNT', 100);
      redisCursor = page[0];
      scanned += page[1].length;
      if (++scans > 100 || scanned > limit) throw new Error('Redis inspection bound exceeded');
    } while (redisCursor !== '0');
    const after = await redis.dbsize();
    return {
      schemaVersion: 1,
      purpose: 'sotto-review-readonly-preflight',
      namespace,
      database: { name: identity.database, schema: identity.schema, readOnly: true },
      storage: instance,
      access: {
        mode: access.mode,
        principals: access.principals.map((item) => ({ id: item.id, role: item.role })),
        profileCount: access.householdProfiles?.length ?? 0,
        stateSha256: digest(envelope),
      },
      selection: {
        learning: { provider: text(selected.aiProvider), model: text(selected.aiModel) },
        platform: { provider: text(platform.aiProvider), model: text(platform.aiModel) },
        tts: { provider: text(selected.ttsProvider), model: text(selected.ttsModel) },
        stt: { provider: text(selected.sttProvider), model: text(selected.sttModel) },
        storageProvider: text(site.storageProvider),
      },
      credentialCounts,
      jobs,
      executions,
      cleanup,
      redis: { before, after, scanned, empty: before === 0 && after === 0 && scanned === 0 },
      zeroWork:
        jobs.every(
          (job) => ['complete', 'erased'].includes(job.status) && job.matchesIndex === true
        ) &&
        executions.every((item) => item.status === 'settled') &&
        cleanup.every(
          (item) =>
            item.phase === 'complete' &&
            item.pending === 0 &&
            item.unresolvedManifests === 0 &&
            item.remainingCollectors === 0
        ) &&
        before === 0 &&
        after === 0 &&
        scanned === 0,
    };
  } finally {
    await database.query('ROLLBACK');
  }
}

async function main() {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
    throw new Error('Explicit database and Redis connections required');
  const database = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  const redis = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    enableReadyCheck: false,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    connectTimeout: 5000,
    commandTimeout: 5000,
  });
  const deadline = setTimeout(() => {
    redis.disconnect();
    void database.end().catch(() => {});
    process.stderr.write('Read-only review observation exceeded its lifetime.\n');
    process.exit(1);
  }, 60_000);
  deadline.unref();
  try {
    await database.connect();
    await redis.connect();
    const result = await observe(
      { query: async (sql, values = []) => database.query(sql, [...values]) },
      redis
    );
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    redis.disconnect();
    await database.end();
    clearTimeout(deadline);
  }
}

if (require.main === module || process.argv[1] === '-')
  main().catch(() => {
    console.error('Read-only review observation failed; preserve state for canonical inspection.');
    process.exitCode = 1;
  });
