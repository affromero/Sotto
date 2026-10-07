import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { sottoStateWriteTransaction } from '@/lib/sidedoor/access/state/write-transaction';

/** Acquire the shared-state writer lock before the Serializable snapshot. */
export async function sottoStorageWriteTransaction<Result>(
  database: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  callerSignal: AbortSignal
): Promise<Result> {
  return sottoStateWriteTransaction(database, operation, callerSignal);
}
