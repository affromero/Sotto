import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  StorageReferenceRegistry,
  StorageRelocationRegistry,
  prepareStorageReference,
} from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { captureStorageBackend } from '@/lib/r2';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

/** Fixture construction only. Actual local bytes and readback back the synthetic migration receipt. */
export async function relocateStorageFixture(options: {
  database: PrismaClient;
  directory: string;
  reference: string;
  consumers: string[];
  recordProof?: boolean;
  publish(tx: Prisma.TransactionClient, reference: string): Promise<unknown>;
}) {
  const bytes = await readFile(
    join(options.directory, options.reference.replace('/api/v1/storage/', ''))
  );
  const backend = await captureStorageBackend();
  const key = `relocated/${randomUUID()}.bin`;
  const reference = await backend.writeBuffer(
    key,
    bytes,
    'application/octet-stream',
    new AbortController().signal
  );
  const readback = await readFile(join(options.directory, key));
  if (!bytes.equals(readback)) throw new Error('Fixture readback differs from source');
  await sottoTransaction(options.database, async (tx) => {
    const executor = {
      query: (sql: string, values: readonly unknown[]) =>
        tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    };
    const registry = new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID);
    const original = await registry.resolve({
      consumer: options.consumers[0]!,
      reference: options.reference,
    });
    if (!original) throw new Error('Fixture source is unregistered');
    const prepared = prepareStorageReference({
      ...original.prepared,
      operationId: randomUUID(),
      reference,
      target: { ...original.prepared.target, key },
    });
    await registry.replaceMany({
      next: prepared,
      consumers: options.consumers.map((consumer) => ({
        consumer,
        previousReference: options.reference,
      })),
    });
    const destination = await registry.resolve({ consumer: options.consumers[0]!, reference });
    if (!destination) throw new Error('Fixture destination is unregistered');
    if (options.recordProof !== false)
      await new StorageRelocationRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).record({
        operationId: prepared.operationId,
        sourceAssetId: original.assetId,
        destinationAssetId: destination.assetId,
        consumers: options.consumers,
        sourceRead: {
          assetId: original.assetId,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes: bytes.length,
        },
        destinationRead: {
          assetId: destination.assetId,
          sha256: createHash('sha256').update(readback).digest('hex'),
          bytes: readback.length,
        },
      });
    await options.publish(tx, reference);
  });
  return reference;
}
