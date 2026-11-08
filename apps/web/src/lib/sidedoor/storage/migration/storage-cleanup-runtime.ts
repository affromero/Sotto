import { randomUUID } from 'node:crypto';
import {
  acquirePostgresBackendLock,
  CleanupExecutionJournal,
  runStorageCleanup,
  StorageBackendRegistry,
  StorageReferenceRegistry,
  type BackendLock,
  type DedicatedBackendConnection,
  type PreparedStorageBackend,
  type StorageCleanupBackendPort,
  type StorageCleanupCollectorRecord,
  type StorageCleanupTargetInput,
} from 'thesidedoor-core/storage';
import type { PrismaClient } from '@/generated/prisma/client';
import { captureStorageCleanup } from '@/lib/r2';
import { openSottoStorageConnection } from '@/lib/sidedoor/storage/core/storage-connection';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

function executor(database: {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}) {
  return {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
}

async function registeredBackends(database: PrismaClient, jobId: string) {
  return sottoTransaction(database, async (transaction) => {
    const cleanup = new (await import('thesidedoor-core/storage')).StorageCleanupJournal(
      executor(transaction),
      'postgres',
      SIDEDOOR_STATE_ID
    );
    const registry = new StorageBackendRegistry(
      executor(transaction),
      'postgres',
      SIDEDOOR_STATE_ID
    );
    const found = new Map<string, PreparedStorageBackend>();
    let after: string | null = null;
    do {
      const page = await cleanup.listCollectors(jobId, after);
      for (const collector of page.collectors) {
        for (const backendId of collector.backendIds) {
          const backend = await registry.get(backendId);
          if (!backend) throw new Error('Storage cleanup backend registration is missing');
          found.set(backend.id, backend);
        }
      }
      after = page.cursor;
    } while (after !== null);
    return [...found.values()];
  });
}

async function referencePage(
  database: PrismaClient,
  backend: PreparedStorageBackend,
  collector: StorageCleanupCollectorRecord
) {
  return sottoTransaction(database, async (transaction) => {
    const registry = new StorageReferenceRegistry(
      executor(transaction),
      'postgres',
      SIDEDOOR_STATE_ID
    );
    const page = await registry.listAssets(collector.cursor);
    const targets: StorageCleanupTargetInput[] = page.assets
      .filter(
        (asset) =>
          asset.prepared.target.backendId === backend.id &&
          asset.consumers.length === 0 &&
          asset.prepared.scopes.some((scope) => scope.subjectId === collector.scope)
      )
      .map((asset) => asset.prepared.target);
    return { targets, next: page.cursor };
  });
}

async function inventoryPage(
  cleanup: Awaited<ReturnType<typeof captureStorageCleanup>>,
  backend: PreparedStorageBackend,
  collector: StorageCleanupCollectorRecord,
  signal: AbortSignal
) {
  if (collector.match === 'key') {
    if (collector.cursor !== null)
      throw new Error('Exact storage cleanup collector cannot have a continuation');
    const exists = await cleanup.has(collector.scope, signal);
    return {
      targets: exists
        ? [{ backendId: backend.id, binding: backend.binding, key: collector.scope }]
        : [],
      next: null,
    };
  }
  const offset =
    collector.cursor === null
      ? 0
      : Number(/^offset:(\d+)$/.exec(collector.cursor)?.[1] ?? Number.NaN);
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error('Storage cleanup inventory cursor is invalid');
  const targets: StorageCleanupTargetInput[] = [];
  let more = false;
  let seen = 0;
  for await (const key of cleanup.list(collector.scope, signal)) {
    if (seen++ < offset) continue;
    if (targets.length === 1000) {
      more = true;
      break;
    }
    targets.push({ backendId: backend.id, binding: backend.binding, key });
  }
  return { targets, next: more ? `offset:${offset + targets.length}` : null };
}

/** Recheck old as well as newly admitted cleanup tickets before touching bytes. */
async function requireNoLiveTarget(database: PrismaClient, binding: string, key: string) {
  await sottoTransaction(database, async (transaction) => {
    const registry = new StorageReferenceRegistry(
      executor(transaction),
      'postgres',
      SIDEDOOR_STATE_ID
    );
    let cursor: string | null = null;
    do {
      const page = await registry.listAssets(cursor);
      if (
        page.assets.some(
          (asset) =>
            asset.prepared.target.binding === binding &&
            asset.prepared.target.key === key &&
            asset.consumers.length > 0
        )
      )
        throw new Error('Storage cleanup target still has live consumers');
      cursor = page.cursor;
    } while (cursor !== null);
  });
}

/** Resume one cleanup while retaining database and physical backend ownership. */
export async function runSottoStorageCleanup(
  database: PrismaClient,
  jobId: string,
  options: {
    signal?: AbortSignal;
    openConnection?: () => Promise<DedicatedBackendConnection>;
  } = {}
): Promise<void> {
  const { signal } = options;
  const backends = await registeredBackends(database, jobId);
  if (!backends.length) throw new Error('Storage cleanup has no registered backends');
  const locks = new Map<string, BackendLock>();
  const executorId = randomUUID();
  let inFlight = 0;
  let operationFailure: unknown;
  const tracked = async <T>(operation: () => Promise<T>): Promise<T> => {
    inFlight += 1;
    try {
      return await operation();
    } finally {
      inFlight -= 1;
    }
  };
  try {
    for (const binding of new Set(backends.map((backend) => backend.binding))) {
      locks.set(
        binding,
        await acquirePostgresBackendLock({
          namespace: SIDEDOOR_STATE_ID,
          binding,
          signal,
          openConnection: options.openConnection ?? (() => openSottoStorageConnection()),
        })
      );
    }
    const lifetime = AbortSignal.any([
      ...(signal ? [signal] : []),
      ...[...locks.values()].map((lock) => lock.signal),
    ]);
    const ports: StorageCleanupBackendPort[] = [];
    for (const backend of backends) {
      const cleanup = await captureStorageCleanup(backend.descriptor);
      ports.push({
        backendId: backend.id,
        binding: backend.binding,
        collect: (collector, active) =>
          tracked(() =>
            collector.kind === 'references'
              ? referencePage(database, backend, collector)
              : inventoryPage(cleanup, backend, collector, active)
          ),
        delete: async (key, active) => {
          await tracked(async () => {
            await requireNoLiveTarget(database, backend.binding, key);
            active.throwIfAborted();
            await cleanup.delete(key, { force: true, signal: active });
          });
        },
      });
    }
    await runStorageCleanup({
      namespace: SIDEDOOR_STATE_ID,
      dialect: 'postgres',
      jobId,
      executorId,
      signal: lifetime,
      transaction: <Result>(
        run: (transaction: Parameters<typeof executor>[0]) => Promise<Result>
      ) => sottoTransaction(database, run),
      executor,
      ports,
    });
  } catch (error) {
    operationFailure = error;
    if (
      backends.every((backend) => backend.descriptor.kind === 'local') &&
      inFlight === 0 &&
      locks.size > 0 &&
      !signal?.aborted &&
      [...locks.values()].every((lock) => !lock.signal.aborted)
    ) {
      try {
        for (const lock of locks.values()) lock.assertHeld();
        await sottoTransaction(database, async (transaction) => {
          for (const lock of locks.values()) lock.assertHeld();
          const journal = new CleanupExecutionJournal(
            executor(transaction),
            'postgres',
            SIDEDOOR_STATE_ID
          );
          for (const [binding, lock] of locks) {
            const current = await journal.current(binding);
            if (
              current?.status === 'unconfirmed' &&
              current.executorId === executorId &&
              current.jobId === jobId &&
              current.backendBinding === binding
            )
              await journal.settle({
                executionId: current.executionId,
                executorId: current.executorId,
                jobId: current.jobId,
                backendBinding: current.backendBinding,
              });
            lock.assertHeld();
          }
          if (signal?.aborted) signal.throwIfAborted();
          for (const lock of locks.values()) lock.assertHeld();
        });
      } catch (settlementError) {
        operationFailure = new AggregateError(
          [error, settlementError],
          'Storage cleanup failed and local settlement could not be confirmed'
        );
      }
    }
  }
  const releases = await Promise.allSettled(
    [...locks.values()].reverse().map((lock) => lock.release())
  );
  const releaseFailures = releases.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (releaseFailures.length)
    throw new AggregateError(
      [
        ...(operationFailure === undefined ? [] : [operationFailure]),
        ...releaseFailures.map((failure) => failure.reason),
      ],
      'Storage cleanup execution or backend lock closure failed'
    );
  if (operationFailure !== undefined) throw operationFailure;
}
