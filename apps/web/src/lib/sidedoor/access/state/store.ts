import { OptimisticStateStore } from 'thesidedoor-core/storage/optimistic';
import { StorageInstanceControl } from 'thesidedoor-core/storage/instance';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import { initialSidedoorState, sidedoorStateSchema } from '@/lib/sidedoor/access/state/state';

export const SIDEDOOR_STATE_ID = 'sotto-platform-v2';

/** Initialization belongs to the local operator setup, never a runtime read. */
export function sottoStorageInstance(database: Pick<Prisma.TransactionClient, '$queryRawUnsafe'>) {
  return new StorageInstanceControl(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
}

/** Uses the caller's transaction so learner rows and shared authority commit together. */
export function sidedoorStateStore(database: Pick<Prisma.TransactionClient, '$queryRawUnsafe'>) {
  return new OptimisticStateStore({
    backend: sqlStateBackend(
      {
        query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      SIDEDOOR_STATE_ID
    ),
    parse: (value) => sidedoorStateSchema.parse(value),
    initial: initialSidedoorState,
  });
}
