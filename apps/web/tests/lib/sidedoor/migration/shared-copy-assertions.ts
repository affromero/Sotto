import { expect } from 'vitest';
import { StorageReferenceRegistry } from 'thesidedoor-core/storage';
import type { PrismaClient } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';

export async function expectUnverifiedSurvivorToBeRejected(options: {
  database: PrismaClient;
  sourceReference: string;
  destinationReference: string;
  removedProfileId: string;
  removedGeneration: number;
  survivingProfileId: string;
  target: Parameters<typeof admitLearningStorageDeletion>[0]['currentBackend'];
}) {
  await options.database.user.update({
    where: { id: options.survivingProfileId },
    data: { image: options.sourceReference },
  });
  try {
    await expect(
      sottoTransaction(options.database, (database) =>
        admitLearningStorageDeletion({
          database,
          scope: { kind: 'profile', id: options.removedProfileId },
          subjects: [
            {
              subjectId: `profile:${options.removedProfileId}`,
              generation: options.removedGeneration,
            },
          ],
          currentBackend: options.target,
        })
      )
    ).rejects.toThrow('Storage reference does not belong to this consumer');
    expect(
      await options.database.user.findUnique({ where: { id: options.removedProfileId } })
    ).not.toBeNull();
  } finally {
    await options.database.user.update({
      where: { id: options.survivingProfileId },
      data: { image: options.destinationReference },
    });
  }
  const survivor = await options.database.user.findUniqueOrThrow({
    where: { id: options.survivingProfileId },
  });
  await options.database.user.update({
    where: { id: options.survivingProfileId },
    data: { createdAt: new Date(survivor.createdAt.getTime() + 1_000) },
  });
  try {
    await expect(
      sottoTransaction(options.database, (database) =>
        admitLearningStorageDeletion({
          database,
          scope: { kind: 'profile', id: options.removedProfileId },
          subjects: [
            {
              subjectId: `profile:${options.removedProfileId}`,
              generation: options.removedGeneration,
            },
          ],
          currentBackend: options.target,
        })
      )
    ).rejects.toThrow('Storage copy consumer ownership changed');
  } finally {
    await options.database.user.update({
      where: { id: options.survivingProfileId },
      data: { createdAt: survivor.createdAt },
    });
  }
}

export async function expectSharedCopyAttribution(options: {
  database: PrismaClient;
  sourceReference: string;
  destinationAssetId: string;
  operationId: string;
  removedProfileId: string;
  survivingProfileId: string;
}) {
  const retained = await sottoTransaction(options.database, async (tx) => {
    const registry = new StorageReferenceRegistry(
      { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
      'postgres',
      SIDEDOOR_STATE_ID
    );
    const source = await registry.readReference(options.sourceReference);
    if (!source) throw new Error('Surviving source attribution is missing');
    return {
      source,
      sourceAllocation: await registry.readAllocation(source.asset.id),
      destination: await registry.readAsset(options.destinationAssetId),
      destinationAllocation: await registry.readAllocation(options.destinationAssetId),
      removedRetirement: await registry.readRetirement(
        options.operationId,
        `profile:${options.removedProfileId}:avatar`
      ),
      survivingRetirement: await registry.readRetirement(
        options.operationId,
        `profile:${options.survivingProfileId}:avatar`
      ),
    };
  });
  const survivor = `profile:${options.survivingProfileId}:avatar`;
  expect(retained.destination?.asset.consumers).toEqual([survivor]);
  expect(retained.sourceAllocation?.claims).toEqual([
    { consumer: survivor, previousReference: null },
  ]);
  expect(retained.destinationAllocation?.claims).toEqual([
    { consumer: survivor, previousReference: options.sourceReference },
  ]);
  expect(retained.removedRetirement).toBeNull();
  expect(retained.survivingRetirement).toMatchObject({
    consumer: survivor,
    previousReference: options.sourceReference,
    attribution: { assetId: retained.source.asset.id, prepared: retained.source.asset.prepared },
  });
  expect(JSON.stringify(retained)).not.toContain(options.removedProfileId);
}
