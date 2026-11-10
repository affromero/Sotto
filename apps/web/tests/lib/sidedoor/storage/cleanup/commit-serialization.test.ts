// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, DatabaseError } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  prepareStorageBackend,
  prepareStorageCleanup,
  StorageBackendRegistry,
  StorageCleanupJournal,
} from 'thesidedoor-core/storage';
import type { PrismaClient } from '@/generated/prisma/client';
import { captureStorageBackend } from '@/lib/r2';
import { setSiteConfig } from '@/lib/site-config';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { openSottoStorageConnection } from '@/lib/sidedoor/storage/core/storage-connection';
import { runSottoStorageCleanup } from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});

const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('cleanup commit serialization', () => {
  let instance: SharedTestInstance;
  beforeAll(async () => {
    instance = await createSharedTestInstance('cleanup_commit');
    boundary.database = instance.database;
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });

  it('retries a confirmed aborted acknowledgement without repeating storage I/O', async () => {
    const identity = await instance.reset();
    const root = await mkdtemp(join(tmpdir(), 'sotto-cleanup-commit-'));
    const other = new Client({
      connectionString: databaseUrl,
      options: `-c search_path=${instance.schema}`,
    });
    const storage = await import('@/lib/r2');
    const originalCapture = storage.captureStorageCleanup;
    let reads = 0;
    const capture = vi
      .spyOn(storage, 'captureStorageCleanup')
      .mockImplementation(async (...args) => {
        const backend = await originalCapture(...args);
        return {
          ...backend,
          async has(...parameters) {
            const result = await backend.has(...parameters);
            reads++;
            return result;
          },
        };
      });
    try {
      await other.connect();
      await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
      const backend = await captureStorageBackend();
      const prepared = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
      const job = prepareStorageCleanup({
        namespace: SIDEDOOR_STATE_ID,
        subjectId: `profile:${identity.ownerId}`,
        generation: Date.now(),
      });
      await instance.database.$executeRawUnsafe(
        'CREATE TABLE cleanup_commit_race (id integer PRIMARY KEY, value integer)'
      );
      await instance.database.$executeRawUnsafe(
        'INSERT INTO cleanup_commit_race VALUES (1, 0), (2, 0)'
      );
      await sottoTransaction(instance.database, async (database) => {
        const executor = {
          query: (sql: string, values: readonly unknown[]) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        };
        await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
          prepared
        );
        const cleanup = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
        await cleanup.createJob(job);
        await cleanup.registerCollectors(job.id, job.epoch, [
          {
            id: 'empty',
            kind: 'inventory',
            backendIds: [prepared.id],
            scope: '__test/empty',
            match: 'key',
          },
        ]);
      });
      let injected = false;
      let commitAborted = false;
      await runSottoStorageCleanup(instance.database, job.id, {
        openConnection: async () => {
          const connection = await openSottoStorageConnection(databaseUrl, instance.schema);
          return {
            ...connection,
            async query(sql, values) {
              if (sql === 'COMMIT' && reads === 1 && !injected) {
                injected = true;
                await connection.query('SELECT sum(value) FROM cleanup_commit_race', []);
                await other.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
                await other.query('SELECT sum(value) FROM cleanup_commit_race');
                await connection.query('UPDATE cleanup_commit_race SET value = 1 WHERE id = 1', []);
                await other.query('UPDATE cleanup_commit_race SET value = 1 WHERE id = 2');
                await other.query('COMMIT');
              }
              try {
                return await connection.query(sql, values);
              } catch (error) {
                if (sql === 'COMMIT' && error instanceof DatabaseError && error.code === '40001')
                  commitAborted = true;
                throw error;
              }
            },
          };
        },
      });
      expect(injected).toBe(true);
      expect(commitAborted).toBe(true);
      expect(reads).toBe(2);
      const status = await sottoTransaction(instance.database, (database) =>
        new StorageCleanupJournal(
          {
            query: (sql, values) =>
              database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          },
          'postgres',
          SIDEDOOR_STATE_ID
        ).get(job.id)
      );
      expect(status.phase).toBe('complete');
    } finally {
      capture.mockRestore();
      await other.end();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
