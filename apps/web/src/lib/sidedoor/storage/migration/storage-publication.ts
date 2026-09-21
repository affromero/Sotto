import { StorageReferenceRegistry, StorageRelocationRegistry } from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

/** Preserve sealed references. Only exact attribution or a verified migration chain proves reuse. */
export async function resolvePublishedStorageReference(
  database: Prisma.TransactionClient,
  options: {
    consumer: string;
    originalReference: string;
    currentReference: string;
    signal?: AbortSignal;
  }
) {
  const captured = { ...options };
  const executor = {
    query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  } satisfies ConstructorParameters<typeof StorageRelocationRegistry>[0];
  const registry = new StorageRelocationRegistry(executor, 'postgres', SIDEDOOR_STATE_ID);
  const proof = await registry.resolve({ ...captured, maxHops: 1000 });
  if (!proof) return null;
  const original = await new StorageReferenceRegistry(
    executor,
    'postgres',
    SIDEDOOR_STATE_ID
  ).readReference(captured.originalReference);
  captured.signal?.throwIfAborted();
  if (!original || original.asset.id !== proof.originalAssetId)
    throw new Error('Original publication attribution changed');
  return { ...proof, original: original.asset.prepared };
}
