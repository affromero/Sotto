import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { StorageReferenceRegistry } from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const storageInputSchema = z
  .object({
    consumer: z.string().min(1).max(200),
    reference: z.string().min(1),
    assetId: digest,
    backendId: digest,
    binding: digest,
    key: z.string().min(1),
  })
  .strict();
export type StorageInput = z.infer<typeof storageInputSchema>;

/** Caller checks application ownership and erasure scopes in the same transaction. */
export async function resolveStorageInput(
  database: Prisma.TransactionClient,
  request: { consumer: string; reference: string }
) {
  const registry = new StorageReferenceRegistry(
    {
      query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  const resolved = await registry.resolve(request);
  if (!resolved)
    throw new Error('Storage input requires explicit imported attribution before processing');
  return {
    input: storageInputSchema.parse({
      ...request,
      assetId: resolved.assetId,
      ...resolved.prepared.target,
    }),
    backend: resolved.backend,
  };
}

/** Recheck queued identities before reading and again in the publication transaction. */
export async function validateStorageInputs(
  database: Prisma.TransactionClient,
  inputs: readonly StorageInput[]
) {
  const backends = [];
  const consumers = new Set<string>();
  for (const input of inputs) {
    if (consumers.has(input.consumer)) throw new Error('Storage input consumers must be distinct');
    consumers.add(input.consumer);
    const current = await resolveStorageInput(database, input);
    if (!isDeepStrictEqual(current.input, input))
      throw new Error('Storage input attribution changed');
    backends.push(current.backend);
  }
  return backends;
}
