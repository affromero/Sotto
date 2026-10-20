import { StorageWriteJournal } from 'thesidedoor-core/storage';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

class MaterialStorageOutcomeUnknown extends Error {
  constructor() {
    super('Material storage writes have an unresolved outcome.');
    this.name = 'MaterialStorageOutcomeUnknown';
  }
}

/** A retry cannot start another write while a prior publication may still exist. */
export async function assertKnownMaterialWrites(materialId: string, prefix: string) {
  await sottoTransaction(prismaUnfiltered, async (database) => {
    const writes = new StorageWriteJournal(
      {
        query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      SIDEDOOR_STATE_ID
    );
    let after: string | null = null;
    do {
      const page = await writes.list(`material:${materialId}`, {
        after: after ?? undefined,
        limit: 1000,
      });
      if (
        page.intents.some(
          (intent) =>
            intent.target.key.startsWith(prefix + '/') &&
            (intent.status !== 'settled' || intent.outcome === 'uncertain')
        )
      )
        throw new MaterialStorageOutcomeUnknown();
      after = page.cursor;
    } while (after !== null);
  });
}
