import { randomUUID } from 'node:crypto';
import { JobExecutionJournal, runJobExecution } from 'thesidedoor-core/runtime/outbox';
import { openExecutionLocation } from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { resolveSottoExecutionDirectory } from './execution-directory';
export { resolveSottoExecutionDirectory } from './execution-directory';

const executorId = randomUUID();
const executor = (database: Prisma.TransactionClient) => ({
  query: (sql: string, values: readonly unknown[]) =>
    database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
});
export function sottoJobExecutions(database: Prisma.TransactionClient) {
  return new JobExecutionJournal(executor(database), 'postgres', SIDEDOOR_STATE_ID);
}

/** Application authority and transactions adapt the shared execution lifecycle. */
export async function withSottoJobExecution<Result>(options: {
  database: PrismaClient;
  parentId: string;
  fingerprint: string;
  signal: AbortSignal;
  validate: (database: Prisma.TransactionClient) => Promise<boolean>;
  isCleanupFailure: (error: unknown) => boolean;
  run: (context: { markCleanupUnconfirmed: () => void; directory: string }) => Promise<Result>;
}): Promise<Result | undefined> {
  const { database, parentId, fingerprint, signal, validate, isCleanupFailure, run } = options;
  const executionDirectory = resolveSottoExecutionDirectory();
  const location = await openExecutionLocation(executionDirectory, { create: true, signal });
  return runJobExecution({
    namespace: SIDEDOOR_STATE_ID,
    dialect: 'postgres',
    executorId,
    parentId,
    fingerprint,
    signal,
    validate,
    isCleanupFailure,
    executor,
    transaction: (operation, transactionSignal) =>
      sottoTransaction(database, operation, { signal: transactionSignal }),
    workspace: { root: location.root.root, locationId: location.locationId },
    run: ({ markCleanupUnconfirmed, directory }) => {
      if (!directory) throw new Error('Execution workspace was not created');
      return run({ markCleanupUnconfirmed, directory });
    },
  });
}
