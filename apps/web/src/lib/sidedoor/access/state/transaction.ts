import { retrySerializableTransaction } from 'thesidedoor-core/storage/sql';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';

/** Retry only complete database transactions. External effects belong after commit. */
export function sottoTransaction<Result>(
  database: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<Result> {
  if (
    options.timeoutMs !== undefined &&
    (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)
  )
    throw new Error('Transaction timeout must be a positive integer');
  return retrySerializableTransaction(
    () =>
      database.$transaction(operation, {
        isolationLevel: 'Serializable',
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      }),
    options
  );
}
