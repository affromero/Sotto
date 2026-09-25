// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { JobRetentionCleanup, prepareJob } from 'thesidedoor-core/runtime/outbox';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import {
  StorageCleanupJournal,
  StorageBackendRegistry,
  prepareStorageBackend,
  prepareStorageCleanup,
  storageBackendBinding,
} from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('retention cleanup with concurrent PostgreSQL transactions', () => {
  let instance: SharedTestInstance;
  beforeAll(async () => {
    instance = await createSharedTestInstance('job_retention');
  });
  beforeEach(async () => {
    await instance.reset();
  });
  afterAll(async () => {
    await instance?.close();
  });
  const executor = (tx: Prisma.TransactionClient) => ({
    query: (sql: string, values: readonly unknown[]) =>
      tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  });
  it.each(['step', 'transition'])(
    'retains complete coverage through concurrent %s calls sharing jobs and snapshots',
    async (mode) => {
      const scopes = [
        { subjectId: 'profile:first', generation: 1 },
        { subjectId: 'profile:second', generation: 2 },
      ];
      const records = await sottoTransaction(instance.database, async (tx) => {
        const outbox = sottoJobOutbox(tx);
        const result = [];
        for (let index = 0; index < 25; index++)
          result.push(
            await outbox.enqueue(
              prepareJob({
                namespace: SIDEDOOR_STATE_ID,
                handler: 'notifications',
                version: 1,
                payload: { text: `private-retention-text-${index}` },
                scopes,
                delivery: { attempts: 3, priority: 0, availableAt: 0 },
              })
            )
          );
        const first = result[0]!;
        const snapshots = sottoJobSnapshot(tx);
        await snapshots.createForJob({ id: first.job.id, fingerprint: first.fingerprint });
        for (let page = 0; page < 12; page++)
          await snapshots.append(first.job.id, first.fingerprint, page, [
            `private-retention-device-${page}`,
          ]);
        await snapshots.seal(first.job.id, first.fingerprint);
        return result;
      });
      const jobs = scopes.map((scope) =>
        prepareStorageCleanup({
          namespace: SIDEDOOR_STATE_ID,
          ...scope,
          retentionPolicy: 'job-id-snapshots-v1',
        })
      );
      const location = {
        kind: 'object' as const,
        endpoint: 'https://storage.example',
        bucket: 'retention-test',
      };
      const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, {
        kind: 'object',
        location,
        binding: storageBackendBinding(location),
      });
      await sottoTransaction(instance.database, async (tx) => {
        await new StorageBackendRegistry(executor(tx), 'postgres', SIDEDOOR_STATE_ID).register(
          backend
        );
        const journal = new StorageCleanupJournal(executor(tx), 'postgres', SIDEDOOR_STATE_ID);
        for (const job of jobs) {
          await journal.createJob(job);
          await journal.registerCollectors(job.id, 0, [
            { id: 'inventory', kind: 'inventory', backendIds: [backend.id], scope: 'retention/' },
          ]);
          const waiting = await journal.transition(job.id, 0);
          let current = await journal.recordDrainedIntents(job.id, waiting.epoch, null);
          if (mode === 'transition') {
            current = await journal.recordCollectorPage({
              jobId: job.id,
              epoch: current.epoch,
              collectorId: 'inventory',
              targets: [],
              after: null,
              next: null,
            });
            current = await journal.transition(job.id, current.epoch);
            current = await journal.transition(job.id, current.epoch);
            current = await journal.beginVerification(job.id, current.epoch);
            await journal.recordCollectorPage({
              jobId: job.id,
              epoch: current.epoch,
              collectorId: 'inventory',
              targets: [],
              after: null,
              next: null,
            });
          }
        }
      });
      const finished = new Set<string>();
      for (let round = 0; round < 15 && finished.size !== jobs.length; round++) {
        const results = await Promise.allSettled(
          jobs.flatMap((job) =>
            Array.from({ length: 2 }, async () => {
              const result = await sottoTransaction(instance.database, async (tx) => {
                if (mode === 'step')
                  return new JobRetentionCleanup(executor(tx), 'postgres', SIDEDOOR_STATE_ID).step(
                    job.id
                  );
                const journal = new StorageCleanupJournal(
                  executor(tx),
                  'postgres',
                  SIDEDOOR_STATE_ID
                );
                const current = await journal.get(job.id);
                if (current.phase === 'complete') return { complete: true };
                return {
                  complete: (await journal.transition(job.id, current.epoch)).phase === 'complete',
                };
              });
              if (result.complete) finished.add(job.id);
            })
          )
        );
        for (const result of results) {
          if (result.status === 'rejected')
            expect(isSerializationConflict(result.reason), String(result.reason)).toBe(true);
        }
      }
      expect(finished.size).toBe(2);
      for (const record of records)
        expect(
          await sottoTransaction(instance.database, (tx) =>
            sottoJobOutbox(tx).receipt(record.job.id)
          )
        ).toMatchObject({ status: 'erased' });
      const privateRows = await instance.database.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*) FROM "SidedoorState" WHERE state::text LIKE '%private-retention-%'`
      );
      expect(Number(privateRows[0]!.count)).toBe(0);
    }
  );
});
