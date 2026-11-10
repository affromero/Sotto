import { createHash } from 'node:crypto';
import {
  selectRelocationComponent,
  StorageReferenceRegistry,
  StorageRelocationRegistry,
} from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

const MAX_INVENTORY_ENTRIES = 100_000;
const MAX_INVENTORY_UNITS = 50_000_000;
const MAX_COMPONENT_ASSETS = 10_000;

/** Reject oversized retained state before transferring it into the application process. */
export async function assertRelocationInventorySize(
  database: Prisma.TransactionClient,
  maxBytes: number
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error('Storage relocation inventory size limit is invalid');
  const namespace = createHash('sha256').update(SIDEDOOR_STATE_ID).digest('hex');
  const kinds = [
    'sd-asset',
    'sd-allocation',
    'sd-retired',
    'sd-rel',
    'sd-rels',
    'sd-b',
    'sotto-rel-proof',
  ];
  const bounds = kinds.flatMap((kind) => {
    const prefix = `${kind}:1:${namespace}:`;
    return [prefix, `${prefix.slice(0, -1)};`];
  });
  const predicate = kinds
    .map((_, index) => `(id ~>=~ $${index * 2 + 1} AND id ~<~ $${index * 2 + 2})`)
    .join(' OR ');
  const rows = await database.$queryRawUnsafe<Array<{ bytes: unknown }>>(
    `SELECT COALESCE(SUM(octet_length(state::text)::bigint), 0)::text AS bytes FROM "SidedoorState" WHERE ${predicate}`,
    ...bounds
  );
  const bytes = rows[0]?.bytes;
  if (rows.length !== 1 || typeof bytes !== 'string' || !/^\d+$/.test(bytes))
    throw new Error('Storage relocation inventory size could not be determined');
  if (BigInt(bytes) > BigInt(maxBytes))
    throw new Error('Storage relocation inventory is too large');
}

/**
 * Capture related history in a bounded Serializable deletion transaction.
 * Cancellation is checked between database queries; the caller bounds each
 * outstanding query through its transaction timeout.
 */
export async function captureRelocationComponent(
  database: Prisma.TransactionClient,
  input: { seedAssetIds: string[]; signal?: AbortSignal }
) {
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  const references = new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID);
  const relocations = new StorageRelocationRegistry(executor, 'postgres', SIDEDOOR_STATE_ID);
  const signal = input.signal;
  signal?.throwIfAborted();
  await assertRelocationInventorySize(database, MAX_INVENTORY_UNITS);
  signal?.throwIfAborted();
  await relocations.verifySuccessorInventory({
    maxEntries: MAX_INVENTORY_ENTRIES,
    ...(signal ? { signal } : {}),
  });
  let count = input.seedAssetIds.length;
  async function readPages<Item>(
    read: (cursor: string | null) => Promise<{ items: Item[]; cursor: string | null }>
  ) {
    const result: Item[] = [];
    let cursor: string | null = null;
    do {
      signal?.throwIfAborted();
      const page = await read(cursor);
      signal?.throwIfAborted();
      count += page.items.length;
      if (count > MAX_INVENTORY_ENTRIES)
        throw new Error('Storage relocation inventory is too large');
      result.push(...page.items);
      if (cursor && page.cursor && page.cursor <= cursor)
        throw new Error('Storage relocation inventory cursor did not advance');
      cursor = page.cursor;
    } while (cursor !== null);
    return result;
  }
  const assets = await readPages(async (cursor) => {
    const page = await references.listAssets(cursor);
    return { items: page.assets, cursor: page.cursor };
  });
  const allocations = await readPages(async (cursor) => {
    const page = await references.listAllocations(cursor);
    return { items: page.allocations, cursor: page.cursor };
  });
  const retirements = await readPages(async (cursor) => {
    const page = await references.listRetirements(cursor);
    return { items: page.retirements, cursor: page.cursor };
  });
  const receipts = await readPages(async (cursor) => {
    const page = await relocations.listAll(cursor);
    return { items: page.receipts, cursor: page.cursor };
  });
  return selectRelocationComponent({
    namespace: SIDEDOOR_STATE_ID,
    assets,
    allocations,
    retirements,
    receipts,
    seedAssetIds: input.seedAssetIds,
    maxAssets: MAX_COMPONENT_ASSETS,
    maxInventoryEntries: MAX_INVENTORY_ENTRIES,
    maxInventoryUnits: MAX_INVENTORY_UNITS,
  });
}
