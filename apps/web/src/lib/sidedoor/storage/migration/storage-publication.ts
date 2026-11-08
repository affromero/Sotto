import { StorageReferenceRegistry, StorageRelocationRegistry } from 'thesidedoor-core/storage';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type { StorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';

type ResolutionOptions = {
  consumer: string;
  originalReference: string;
  currentReference: string;
  signal?: AbortSignal;
};
type Executor = ConstructorParameters<typeof StorageRelocationRegistry>[0];

async function resolvePublication(executor: Executor, options: ResolutionOptions) {
  const captured = { ...options };
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

/** Preserve sealed references. Only exact attribution or a verified migration chain proves reuse. */
export function resolvePublishedStorageReference(
  database: Prisma.TransactionClient,
  options: ResolutionOptions
) {
  return resolvePublication(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    options
  );
}

/** Lock the full positive proof. The caller also fences all owner lifecycle rows. */
export async function resolveLockedPublishedStorageReference(
  database: Prisma.TransactionClient,
  options: ResolutionOptions
) {
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Published storage verification requires a Serializable transaction');
  return resolvePublication(
    {
      query: (sql, values) => {
        if (
          sql !== 'SELECT "revision", "state" FROM "SidedoorState" WHERE "id" = $1' ||
          values.length !== 1 ||
          typeof values[0] !== 'string'
        )
          throw new Error('Published storage used an unsupported registry query');
        return database.$queryRawUnsafe<Record<string, unknown>[]>(`${sql} FOR SHARE`, ...values);
      },
    },
    options
  );
}

/** Bind a verified relocation chain to the originally published bytes and asset. */
export function matchesPublishedStorageIdentity(
  proof: {
    originalAssetId: string;
    original: { target: Pick<StorageInput, 'backendId' | 'binding' | 'key'> };
    content: { sha256: string; bytes: number } | null;
  } | null,
  expected: {
    original: StorageInput;
    currentReference: string;
    contentSha256: string;
    contentBytes: number;
  }
) {
  return !(
    !proof ||
    proof.originalAssetId !== expected.original.assetId ||
    !isDeepStrictEqual(proof.original.target, {
      backendId: expected.original.backendId,
      binding: expected.original.binding,
      key: expected.original.key,
    }) ||
    (proof.content !== null &&
      (proof.content.sha256 !== expected.contentSha256 ||
        proof.content.bytes !== expected.contentBytes)) ||
    (expected.currentReference !== expected.original.reference && proof.content === null)
  );
}
