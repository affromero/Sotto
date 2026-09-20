// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, type Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { JobOutbox, prepareJob } from 'thesidedoor-core/runtime/outbox';
import {
  StorageWriteJournal,
  prepareStorageWrite,
  prepareStorageTombstone,
  prepareStorageBackend,
  StorageBackendRegistry,
  storageBackendBinding,
  StorageCleanupJournal,
  prepareStorageCleanup,
} from 'thesidedoor-core/storage';

const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('storage journal with PostgreSQL Serializable transactions', () => {
  let database: PrismaClient;
  const schema = `journal_test_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Use the isolated local sidedoor_test database');
    database = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: databaseUrl, options: `-c search_path=${schema}` },
        { schema }
      ),
    });
    await database.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await database.$executeRawUnsafe(
      'CREATE TABLE "SidedoorState" ("id" TEXT PRIMARY KEY, "revision" TEXT NOT NULL, "state" JSONB NOT NULL)'
    );
    await database.$executeRawUnsafe(
      await readFile('prisma/migrations/20260912014000_storage_journal_index/migration.sql', 'utf8')
    );
    await database.$executeRawUnsafe(
      'CREATE TABLE "JournalSubject" ("id" TEXT PRIMARY KEY, "generation" INTEGER NOT NULL, "reference" TEXT)'
    );
  });
  afterAll(async () => {
    if (!database) return;
    await database.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await database.$disconnect();
  });
  function journal(tx: Prisma.TransactionClient) {
    return new StorageWriteJournal(
      { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
      'postgres',
      'sotto'
    );
  }
  function cleanupJournal(tx: Prisma.TransactionClient) {
    return new StorageCleanupJournal(
      { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
      'postgres',
      'sotto'
    );
  }
  async function fixture() {
    const subjectId = randomUUID();
    await database.$executeRawUnsafe(
      'INSERT INTO "JournalSubject" (id,generation) VALUES ($1,2)',
      subjectId
    );
    const location = {
      kind: 'object' as const,
      endpoint: 'https://storage.example',
      bucket: 'private',
    };
    const backend = prepareStorageBackend('sotto', {
      kind: 'object',
      location,
      binding: storageBackendBinding(location),
    });
    const intent = prepareStorageWrite({
      namespace: 'sotto',
      subjectId,
      generation: 2,
      target: {
        backendId: backend.id,
        binding: backend.binding,
        key: `recordings/${subjectId}.wav`,
      },
    });
    const marker = prepareStorageTombstone({
      namespace: 'sotto',
      subjectId,
      generation: 2,
      jobId: randomUUID(),
    });
    await sottoTransaction(database, async (tx) => {
      await new StorageBackendRegistry(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        'sotto'
      ).register(backend);
      await journal(tx).begin(intent, 2);
    });
    return { subjectId, intent, marker };
  }
  async function authorize(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRawUnsafe<{ generation: number }[]>(
      'SELECT generation FROM "JournalSubject" WHERE id = $1',
      id
    );
    if (!rows[0]) throw new Error('Learner was removed');
    return rows[0].generation;
  }

  it('commits an outbox result once across concurrent PostgreSQL workers and retains undelivered work', async () => {
    const { subjectId } = await fixture();
    const outbox = (tx: Prisma.TransactionClient) =>
      new JobOutbox(
        {
          query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        'sotto'
      );
    const prepared = prepareJob({
      namespace: 'sotto',
      handler: 'test-result',
      version: 1,
      payload: { subjectId, value: 'committed' },
      scopes: [{ subjectId, generation: 2 }],
      delivery: { attempts: 3, priority: 0, availableAt: 0 },
    });
    const record = await sottoTransaction(database, (tx) => outbox(tx).enqueue(prepared));
    const apply = () =>
      sottoTransaction(database, async (tx) => {
        if (!(await outbox(tx).complete(prepared.id, record.fingerprint))) return false;
        await tx.$executeRawUnsafe(
          'UPDATE "JournalSubject" SET generation = generation + 1 WHERE id = $1',
          subjectId
        );
        return true;
      });
    const [results] = await Promise.all([
      Promise.all([apply(), apply()]),
      sottoTransaction(database, (tx) =>
        outbox(tx).acknowledgeDelivery(prepared.id, record.fingerprint)
      ),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect(await sottoTransaction(database, (tx) => authorize(tx, subjectId))).toBe(3);
    expect(await sottoTransaction(database, (tx) => outbox(tx).read(prepared.id))).toMatchObject({
      complete: true,
      delivered: true,
    });
    expect((await sottoTransaction(database, (tx) => outbox(tx).listIncomplete())).jobs).toEqual(
      []
    );
    const pending = prepareJob({ ...prepared, id: randomUUID() });
    await expect(
      sottoTransaction(database, async (tx) => {
        await outbox(tx).enqueue(pending);
        throw new Error('Application rejected');
      })
    ).rejects.toThrow('Application rejected');
    expect(await sottoTransaction(database, (tx) => outbox(tx).read(pending.id))).toBeNull();
    await sottoTransaction(database, (tx) => outbox(tx).enqueue(pending));
    expect((await sottoTransaction(database, (tx) => outbox(tx).listPending())).jobs).toEqual([
      expect.objectContaining({ id: pending.id }),
    ]);
  });

  it('commits raw cleanup references with source deletion and rolls both back on failure', async () => {
    const { subjectId } = await fixture();
    const reference = 'https://historical.example/unattributed.wav';
    await database.$executeRawUnsafe(
      'UPDATE "JournalSubject" SET reference = $1 WHERE id = $2',
      reference,
      subjectId
    );
    const prepared = prepareStorageCleanup({ namespace: 'sotto', subjectId, generation: 2 });
    async function snapshot(tx: Prisma.TransactionClient) {
      const rows = await tx.$queryRawUnsafe<{ id: string; reference: string }[]>(
        'SELECT id, reference FROM "JournalSubject" WHERE id = $1',
        subjectId
      );
      await cleanupJournal(tx).createJob(prepared);
      await cleanupJournal(tx).recordManifestPage(prepared.id, 0, { id: 'source', entries: rows });
      await tx.$executeRawUnsafe('DELETE FROM "JournalSubject" WHERE id = $1', subjectId);
    }
    await expect(
      sottoTransaction(database, async (tx) => {
        await snapshot(tx);
        throw new Error('Deletion transaction rejected');
      })
    ).rejects.toThrow('Deletion transaction rejected');
    expect(await authorize(database, subjectId)).toBe(2);
    expect(await journal(database).tombstone(subjectId)).toBeNull();
    await expect(cleanupJournal(database).get(prepared.id)).rejects.toThrow('job is missing');
    await sottoTransaction(database, snapshot);
    await expect(authorize(database, subjectId)).rejects.toThrow('Learner was removed');
    const manifests = await cleanupJournal(database).listManifests(prepared.id);
    expect(manifests.pages).toEqual([
      expect.objectContaining({
        entries: [{ id: subjectId, reference }],
        resolution: null,
      }),
    ]);
    expect(manifests.cursor).toBeNull();
    await sottoTransaction(database, (tx) =>
      cleanupJournal(tx).recordManifestPage(prepared.id, 0, {
        id: 'source',
        entries: [{ reference, id: subjectId }],
      })
    );
    expect(await cleanupJournal(database).get(prepared.id)).toMatchObject({
      manifestCount: 1,
      unresolvedManifests: 1,
    });
    await expect(
      sottoTransaction(database, (tx) => cleanupJournal(tx).transition(prepared.id, 0))
    ).rejects.toThrow('unresolved reference manifests');
  });

  it('reconciles all scopes after its first snapshot predates the original reference commit', async () => {
    const first = await fixture();
    const second = await fixture();
    const scopes = [first, second];
    let releaseCommit!: () => void;
    let prepared!: () => void;
    let readRecovery!: () => void;
    let releaseRecovery!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const preparedGate = new Promise<void>((resolve) => {
      prepared = resolve;
    });
    const recoveryRead = new Promise<void>((resolve) => {
      readRecovery = resolve;
    });
    const recoveryGate = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    const committing = sottoTransaction(database, async (tx) => {
      for (const scope of scopes) {
        await tx.$executeRawUnsafe(
          'UPDATE "JournalSubject" SET reference = $1 WHERE id = $2',
          scope.intent.target.key,
          scope.subjectId
        );
        await journal(tx).finish(scope.intent, { kind: 'referenced', currentGeneration: 2 });
      }
      prepared();
      await commitGate;
    });
    await preparedGate;
    const recovering = sottoTransaction(database, async (tx) => {
      const outcomes = [];
      for (const scope of scopes) outcomes.push(await journal(tx).completion(scope.intent));
      if (outcomes.every((value) => value === 'referenced')) return 'committed';
      if (outcomes.some((value) => value !== null)) throw new Error('Mixed completion outcomes');
      readRecovery();
      await recoveryGate;
      for (const scope of scopes) await journal(tx).finish(scope.intent, { kind: 'unreferenced' });
      return 'unreferenced';
    });
    await recoveryRead;
    releaseCommit();
    try {
      await committing;
    } finally {
      releaseRecovery();
    }
    expect(await recovering).toBe('committed');
    await sottoTransaction(database, async (tx) => {
      for (const scope of scopes) {
        expect(await journal(tx).completion(scope.intent)).toBe('referenced');
        expect((await journal(tx).list(scope.subjectId)).intents).toEqual([]);
        const rows = await tx.$queryRawUnsafe<{ reference: string }[]>(
          'SELECT reference FROM "JournalSubject" WHERE id = $1',
          scope.subjectId
        );
        expect(rows[0]?.reference).toBe(scope.intent.target.key);
      }
    });
  });

  it('retries a concurrent completion against deleted authority and retains the uploaded target', async () => {
    const { subjectId, intent, marker } = await fixture();
    let releaseFinish!: () => void;
    let sawAuthority!: () => void;
    const waitForDeletion = new Promise<void>((resolve) => {
      releaseFinish = resolve;
    });
    const authorityRead = new Promise<void>((resolve) => {
      sawAuthority = resolve;
    });
    const finishing = sottoTransaction(database, async (tx) => {
      const currentGeneration = await authorize(tx, subjectId);
      await journal(tx).tombstone(subjectId);
      sawAuthority();
      await waitForDeletion;
      await tx.$executeRawUnsafe(
        'UPDATE "JournalSubject" SET reference = $1 WHERE id = $2',
        intent.target.key,
        subjectId
      );
      return journal(tx).finish(intent, { kind: 'referenced', currentGeneration });
    }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await authorityRead;
    try {
      await sottoTransaction(database, async (tx) => {
        await journal(tx).forbidWrites(marker);
        await tx.$executeRawUnsafe('DELETE FROM "JournalSubject" WHERE id = $1', subjectId);
      });
    } finally {
      releaseFinish();
    }
    const result = await finishing;
    expect(result).toHaveProperty('error');
    expect('error' in result && String(result.error)).toContain('Learner was removed');
    await sottoTransaction(database, async (tx) => {
      expect((await journal(tx).list(subjectId)).intents[0]?.status).toBe('active');
      await journal(tx).finish(intent, { kind: 'unreferenced' });
      expect((await journal(tx).list(subjectId)).intents[0]?.target).toEqual(intent.target);
      await expect(journal(tx).begin({ ...intent, operationId: randomUUID() }, 2)).rejects.toThrow(
        'being erased'
      );
    });
  });

  it('preserves committed references for later collection and rejects a completed operation replay', async () => {
    const { subjectId, intent, marker } = await fixture();
    await sottoTransaction(database, async (tx) => {
      const currentGeneration = await authorize(tx, subjectId);
      await tx.$executeRawUnsafe(
        'UPDATE "JournalSubject" SET reference = $1 WHERE id = $2',
        intent.target.key,
        subjectId
      );
      expect(await journal(tx).finish(intent, { kind: 'referenced', currentGeneration })).toBe(
        'removed'
      );
      expect(await journal(tx).begin(intent, currentGeneration)).toBe('already_completed');
    });
    const references = await sottoTransaction(database, async (tx) => {
      const records = await tx.$queryRawUnsafe<{ reference: string }[]>(
        'SELECT reference FROM "JournalSubject" WHERE id = $1',
        subjectId
      );
      await journal(tx).forbidWrites(marker);
      await tx.$executeRawUnsafe('DELETE FROM "JournalSubject" WHERE id = $1', subjectId);
      expect((await journal(tx).list(subjectId)).intents).toEqual([]);
      return records.map((record) => record.reference);
    });
    expect(references).toEqual([intent.target.key]);
  });

  it('persists cleanup with subject deletion and resumes through writer drain and fresh verification', async () => {
    const { subjectId, intent } = await fixture();
    const prepared = prepareStorageCleanup({ namespace: 'sotto', subjectId, generation: 2 });
    const erase = async (tx: Prisma.TransactionClient) => {
      await authorize(tx, subjectId);
      const cleanup = cleanupJournal(tx);
      await cleanup.createJob(prepared);
      await cleanup.registerCollectors(prepared.id, 0, [
        {
          id: 'owned-file',
          kind: 'inventory',
          match: 'key',
          scope: intent.target.key,
          backendIds: [intent.target.backendId],
        },
      ]);
      const job = await cleanup.transition(prepared.id, 0);
      await tx.$executeRawUnsafe('DELETE FROM "JournalSubject" WHERE id = $1', subjectId);
      return job;
    };
    await expect(
      sottoTransaction(database, async (tx) => {
        await erase(tx);
        throw new Error('Application deletion failed');
      })
    ).rejects.toThrow('Application deletion failed');
    await sottoTransaction(database, async (tx) => {
      expect(await authorize(tx, subjectId)).toBe(2);
      expect(await journal(tx).tombstone(subjectId)).toBeNull();
    });
    let job = await sottoTransaction(database, erase);
    await expect(
      sottoTransaction(database, (tx) =>
        cleanupJournal(tx).recordDrainedIntents(job.id, job.epoch, null)
      )
    ).rejects.toThrow('waiting for write completion');
    await sottoTransaction(database, (tx) => journal(tx).finish(intent, { kind: 'unreferenced' }));
    job = await sottoTransaction(database, (tx) =>
      cleanupJournal(tx).recordDrainedIntents(job.id, job.epoch, null)
    );
    expect(job.pending).toBe(1);
    job = await sottoTransaction(database, (tx) =>
      cleanupJournal(tx).recordCollectorPage({
        jobId: job.id,
        epoch: job.epoch,
        collectorId: 'owned-file',
        after: null,
        next: null,
        targets: [intent.target],
      })
    );
    job = await sottoTransaction(database, (tx) =>
      cleanupJournal(tx).transition(job.id, job.epoch)
    );
    job = await sottoTransaction(database, (tx) =>
      cleanupJournal(tx).transition(job.id, job.epoch)
    );
    const page = await sottoTransaction(database, (tx) =>
      cleanupJournal(tx).pendingTargets(job.id, job.epoch)
    );
    expect(page.tickets).toHaveLength(1);
    await sottoTransaction(database, (tx) =>
      cleanupJournal(tx).acknowledgeTarget(page.tickets[0]!)
    );
    job = await sottoTransaction(database, (tx) =>
      cleanupJournal(tx).beginVerification(job.id, job.epoch)
    );
    await expect(
      sottoTransaction(database, (tx) => cleanupJournal(tx).transition(job.id, job.epoch))
    ).rejects.toThrow('verification is incomplete');
    job = await sottoTransaction(database, (tx) =>
      cleanupJournal(tx).recordCollectorPage({
        jobId: job.id,
        epoch: job.epoch,
        collectorId: 'owned-file',
        after: null,
        next: null,
        targets: [],
      })
    );
    job = await sottoTransaction(database, (tx) =>
      cleanupJournal(tx).transition(job.id, job.epoch)
    );
    expect(job).toMatchObject({ phase: 'complete', deleted: 1, pending: 0 });
  });

  it('reads a bounded indexed page when one subject has thousands of pending writes', async () => {
    const { subjectId, intent } = await fixture();
    const rows = await database.$queryRawUnsafe<{ id: string }[]>(
      'SELECT id FROM "SidedoorState" WHERE state->>\'operationId\' = $1',
      intent.operationId
    );
    const prefix = rows[0]!.id.slice(0, -intent.operationId.length);
    await database.$executeRawUnsafe(
      "WITH ids AS MATERIALIZED (SELECT gen_random_uuid()::text AS id FROM generate_series(1,10000)) INSERT INTO \"SidedoorState\" (id,revision,state) SELECT $1 || id, 'test-revision', jsonb_set($2::jsonb, '{operationId}', to_jsonb(id)) FROM ids",
      prefix,
      JSON.stringify(intent)
    );
    await database.$executeRawUnsafe('ANALYZE "SidedoorState"');
    await sottoTransaction(database, async (tx) => {
      const plans: unknown[] = [];
      const measured = new StorageWriteJournal(
        {
          query: async (sql, values) => {
            const explanation = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': unknown }>>(
              `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
              ...values
            );
            plans.push(explanation[0]?.['QUERY PLAN']);
            return tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values);
          },
        },
        'postgres',
        'sotto'
      );
      expect((await measured.list(subjectId, { limit: 100 })).intents).toHaveLength(100);
      const encoded = JSON.stringify(plans);
      expect(encoded).toContain('SidedoorState_id_pattern_idx');
      expect(encoded).toContain('"Node Type":"Index Scan"');
      expect(encoded).not.toContain('"Node Type":"Sort"');
      expect(encoded).not.toContain('"Node Type":"Seq Scan"');
    });
  });
});
