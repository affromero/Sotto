// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { expect, it } from 'vitest';
import {
  StorageInstanceControl,
  StorageReferenceRegistry,
  StorageWriteJournal,
  storageBackendBinding,
  writeReferenceSet,
} from 'thesidedoor-core/storage';
import {
  retrySerializableTransaction,
  isSerializationConflict,
} from 'thesidedoor-core/storage/sql';

it.skipIf(!process.env.SIDEDOOR_TEST_DATABASE_URL)(
  'publishes concurrent segment references without repeating external storage writes',
  async () => {
    const url = new URL(process.env.SIDEDOOR_TEST_DATABASE_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Use isolated local sidedoor_test database');
    const schema = `publication_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: url.toString(), max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({
      connectionString: url.toString(),
      max: 15,
      options: `-c search_path=${schema},public`,
    });
    let conflicts = 0;
    const executor = (connection: PoolClient) => ({
      query: async (sql: string, values: readonly unknown[]) =>
        (await connection.query(sql, [...values])).rows as Record<string, unknown>[],
    });
    async function transaction<Result>(run: (connection: PoolClient) => Promise<Result>) {
      return retrySerializableTransaction(async () => {
        const connection = await pool.connect();
        try {
          await connection.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
          const result = await run(connection);
          await connection.query('COMMIT');
          return result;
        } catch (error) {
          await connection.query('ROLLBACK');
          if (isSerializationConflict(error)) conflicts++;
          throw error;
        } finally {
          connection.release();
        }
      });
    }
    const writes = new Map<string, number>();
    const count = 15;
    let accepted = 0;
    let release!: () => void;
    const allUploaded = new Promise<void>((resolve) => {
      release = resolve;
    });
    const releaseTimeout = setTimeout(() => release(), 2000);
    let publicationReads = 0;
    let releaseReads!: () => void;
    const overlappingReads = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    try {
      await pool.query(
        'CREATE TABLE "SidedoorState" (id TEXT PRIMARY KEY, revision TEXT NOT NULL, state JSONB NOT NULL)'
      );
      await pool.query('CREATE TABLE "Published" (slot INTEGER PRIMARY KEY, url TEXT NOT NULL)');
      const instance = await transaction((connection) =>
        new StorageInstanceControl(executor(connection), 'postgres', 'contention').initialize(
          randomUUID()
        )
      );
      const location = {
        kind: 'object' as const,
        endpoint: 'https://storage.example',
        bucket: 'audio',
      };
      const results = await Promise.allSettled(
        Array.from({ length: count }, (_, slot) =>
          writeReferenceSet({
            namespace: 'contention',
            dialect: 'postgres',
            signal: new AbortController().signal,
            executor,
            transaction,
            captureAdmission: async () => ({
              instanceId: instance.instanceId,
              scopes: [instance, { subjectId: 'episode:one', generation: 1 }].map(
                ({ subjectId, generation }) => ({ subjectId, generation })
              ),
              snapshot: slot,
            }),
            validateAdmission: async () => undefined,
            artifacts: [
              {
                name: 'audio',
                prefix: 'segment',
                extension: 'mp3',
                contentType: 'audio/mpeg',
                body: Buffer.from(`audio-${slot}`),
                consumers: () => [{ consumer: `segment:${slot}`, previousReference: null }],
                captureWriter: async () => ({
                  descriptor: {
                    kind: 'object',
                    location,
                    binding: storageBackendBinding(location),
                    access: null,
                    publicUrl: 'https://storage.example/audio',
                    referenceEncoding: 'raw',
                  },
                  write: async (key) => {
                    writes.set(key, (writes.get(key) ?? 0) + 1);
                    if (++accepted === count) release();
                    await allUploaded;
                    return `https://storage.example/audio/${key}`;
                  },
                }),
              },
            ],
            commit: async (connection, urls) => {
              // Segment completion also inspects sibling readiness before admitting stitching.
              await connection.query('SELECT slot FROM "Published" ORDER BY slot');
              if (++publicationReads <= 2) {
                if (publicationReads === 2) releaseReads();
                await overlappingReads;
              }
              await connection.query('INSERT INTO "Published" (slot,url) VALUES ($1,$2)', [
                slot,
                urls.audio,
              ]);
            },
          })
        )
      );
      expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
      expect(conflicts).toBeGreaterThan(0);
      expect([...writes.values()]).toEqual(Array.from({ length: count }, () => 1));
      expect((await pool.query('SELECT * FROM "Published"')).rows).toHaveLength(count);
      await transaction(async (connection) => {
        expect(
          (
            await new StorageWriteJournal(executor(connection), 'postgres', 'contention').list(
              'episode:one'
            )
          ).intents
        ).toEqual([]);
        const registry = new StorageReferenceRegistry(
          executor(connection),
          'postgres',
          'contention'
        );
        for (const row of (await connection.query('SELECT * FROM "Published"')).rows)
          expect(
            await registry.resolve({ consumer: `segment:${row.slot}`, reference: row.url })
          ).not.toBeNull();
      });
    } finally {
      clearTimeout(releaseTimeout);
      releaseReads();
      release();
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  },
  30000
);
