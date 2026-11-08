import { isDeepStrictEqual } from 'node:util';
import { StorageReferenceRegistry } from 'thesidedoor-core/storage';
import { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { storageInputSchema, type StorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';

const pointRead = 'SELECT "revision", "state" FROM "SidedoorState" WHERE "id" = $1';

/** Lock every registry row used by the canonical resolver until the candidate transaction ends. */
export async function fenceAssessmentStorageInputs(
  database: Prisma.TransactionClient,
  inputs: readonly StorageInput[]
) {
  if (!inputs.length) return;
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment storage requires a Serializable transaction');
  const expected = inputs.map((input) => storageInputSchema.parse(input));
  if (new Set(expected.map((input) => input.consumer)).size !== expected.length)
    throw new Error('Assessment storage consumers must be distinct');

  const resolve = async () => {
    const ids = new Set<string>();
    const registry = new StorageReferenceRegistry(
      {
        query: async (sql, values) => {
          if (sql !== pointRead || values.length !== 1 || typeof values[0] !== 'string')
            throw new Error('Assessment storage resolver used an unsupported query');
          const rows = await database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values);
          if (rows.length !== 1) throw new Error('Assessment storage attribution is missing');
          ids.add(values[0]);
          return rows;
        },
      },
      'postgres',
      SIDEDOOR_STATE_ID
    );
    const resolved = [];
    for (const input of expected) {
      const current = await registry.resolve(input);
      if (!current) throw new Error('Assessment storage attribution is missing');
      const identity = storageInputSchema.parse({
        consumer: input.consumer,
        reference: input.reference,
        assetId: current.assetId,
        ...current.prepared.target,
      });
      if (!isDeepStrictEqual(identity, input))
        throw new Error('Assessment storage attribution changed');
      resolved.push(current);
    }
    return { ids: [...ids].sort(), resolved };
  };
  const before = await resolve();
  if (!before.ids.length) throw new Error('Assessment storage attribution is missing');
  const locked = await database.$queryRaw<{ id: string }[]>`
    SELECT id FROM "SidedoorState" WHERE id IN (${Prisma.join(before.ids)}) ORDER BY id FOR SHARE`;
  if (locked.length !== before.ids.length)
    throw new Error('Assessment storage attribution changed');
  const after = await resolve();
  if (!isDeepStrictEqual(before, after)) throw new Error('Assessment storage attribution changed');
}
