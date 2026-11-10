import type { Prisma } from '@/generated/prisma/client';
import { StorageWriteJournal } from 'thesidedoor-core/storage';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

export async function hasClassStorageWrites(database: Prisma.TransactionClient, classId: string) {
  const journal = new StorageWriteJournal(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  const page = await journal.list(`class:${classId}`, { limit: 1 });
  return page.intents.length > 0;
}
