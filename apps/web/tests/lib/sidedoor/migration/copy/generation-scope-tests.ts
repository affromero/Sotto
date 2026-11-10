import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  StorageReferenceRegistry,
  StorageRelocationRegistry,
  StorageWriteJournal,
  prepareStorageTombstone,
} from 'thesidedoor-core/storage';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { executeSottoStorageCopy } from '@/lib/sidedoor/storage/migration/storage-migration-copy';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';

type CopyFixture = {
  options: Parameters<typeof executeSottoStorageCopy>[0];
  target: Parameters<typeof admitLearningStorageDeletion>[0]['currentBackend'];
  other: { id: string } | null;
};

export function registerGenerationScopeTests({
  fixture,
  context,
}: {
  fixture(episodeId?: string, shared?: boolean): Promise<CopyFixture>;
  context(): { instance: SharedTestInstance; identity: SharedTestIdentity };
}) {
  it('rejects deletion when a relocation has lost its scope index and copy job', async () => {
    const { instance, identity } = context();
    const test = await fixture();
    await executeSottoStorageCopy(test.options);
    const owner = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const scope = { subjectId: `profile:${owner.id}`, generation: owner.createdAt.getTime() };
    const deleted = await instance.database.$executeRaw`
      DELETE FROM "SidedoorState"
      WHERE id LIKE 'sd-rel-scope:1:%' AND state->>'subjectId' = ${scope.subjectId}
    `;
    expect(deleted).toBeGreaterThan(0);
    const withMissingScopeIndex = await instance.database.sidedoorState.findMany({
      orderBy: { id: 'asc' },
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitLearningStorageDeletion({
          database: tx,
          scope: { kind: 'profile', id: owner.id },
          subjects: [scope],
          currentBackend: test.target,
        })
      )
    ).rejects.toThrow('Storage relocation scope index is missing');
    expect(await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } })).toEqual(
      withMissingScopeIndex
    );
    const deletedCopyIndex = await instance.database.$executeRaw`
      DELETE FROM "SidedoorState"
      WHERE id LIKE 'sd-jsc:1:%' AND id LIKE ${`%:${test.options.operationId}`}
    `;
    expect(deletedCopyIndex).toBeGreaterThan(0);
    const deletedCopy = await instance.database.$executeRaw`
      DELETE FROM "SidedoorState"
      WHERE id LIKE 'sd-j:1:%' AND id LIKE ${`%:${test.options.operationId}`}
    `;
    expect(deletedCopy).toBe(1);
    const before = await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitLearningStorageDeletion({
          database: tx,
          scope: { kind: 'profile', id: owner.id },
          subjects: [scope],
          currentBackend: test.target,
        })
      )
    ).rejects.toThrow('Storage relocation scope index is incomplete');
    expect(await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } })).toEqual(
      before
    );
    expect(await instance.database.user.findUnique({ where: { id: owner.id } })).not.toBeNull();
  });

  it('rejects an altered relocation generation even when its index agrees', async () => {
    const { instance, identity } = context();
    const test = await fixture();
    const outcome = await executeSottoStorageCopy(test.options);
    const owner = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const scope = { subjectId: `profile:${owner.id}`, generation: owner.createdAt.getTime() };
    const changedReceipt = await instance.database.$executeRaw`
      UPDATE "SidedoorState" AS saved
      SET state = jsonb_set(saved.state, '{scopes}', (
        SELECT jsonb_agg(
          CASE WHEN entry.value->>'subjectId' = ${scope.subjectId}
            THEN jsonb_set(entry.value, '{generation}', to_jsonb(${scope.generation + 1}::bigint))
            ELSE entry.value
          END ORDER BY entry.position
        )
        FROM jsonb_array_elements(saved.state->'scopes') WITH ORDINALITY AS entry(value, position)
      ))
      WHERE saved.id LIKE 'sd-rel:1:%' AND saved.id LIKE ${`%:${outcome.copyOperationId}`}
    `;
    expect(changedReceipt).toBe(1);
    const changedIndex = await instance.database.$executeRaw`
      UPDATE "SidedoorState"
      SET state = jsonb_set(state, '{generation}', to_jsonb(${scope.generation + 1}::bigint))
      WHERE id LIKE 'sd-rel-scope:1:%'
        AND state->>'subjectId' = ${scope.subjectId}
        AND state->>'operationId' = ${outcome.copyOperationId}
    `;
    expect(changedIndex).toBe(1);
    const deletedCopyIndex = await instance.database.$executeRaw`
      DELETE FROM "SidedoorState"
      WHERE id LIKE 'sd-jsc:1:%' AND id LIKE ${`%:${test.options.operationId}`}
    `;
    expect(deletedCopyIndex).toBeGreaterThan(0);
    const deletedCopy = await instance.database.$executeRaw`
      DELETE FROM "SidedoorState"
      WHERE id LIKE 'sd-j:1:%' AND id LIKE ${`%:${test.options.operationId}`}
    `;
    expect(deletedCopy).toBe(1);
    const before = await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitLearningStorageDeletion({
          database: tx,
          scope: { kind: 'profile', id: owner.id },
          subjects: [scope],
          currentBackend: test.target,
        })
      )
    ).rejects.toThrow('Storage relocation scope attribution does not match its assets');
    expect(await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } })).toEqual(
      before
    );
    expect(await instance.database.user.findUnique({ where: { id: owner.id } })).not.toBeNull();
  });

  it('rejects an omitted relocation scope even when its index and copy job are missing', async () => {
    const { instance, identity } = context();
    const test = await fixture();
    const outcome = await executeSottoStorageCopy(test.options);
    const owner = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const scope = { subjectId: `profile:${owner.id}`, generation: owner.createdAt.getTime() };
    const changedReceipt = await instance.database.$executeRaw`
      UPDATE "SidedoorState" AS saved
      SET state = jsonb_set(saved.state, '{scopes}', (
        SELECT jsonb_agg(entry.value ORDER BY entry.position)
        FROM jsonb_array_elements(saved.state->'scopes') WITH ORDINALITY AS entry(value, position)
        WHERE entry.value->>'subjectId' <> ${scope.subjectId}
      ))
      WHERE saved.id LIKE 'sd-rel:1:%' AND saved.id LIKE ${`%:${outcome.copyOperationId}`}
    `;
    expect(changedReceipt).toBe(1);
    const deletedScope = await instance.database.$executeRaw`
      DELETE FROM "SidedoorState"
      WHERE id LIKE 'sd-rel-scope:1:%'
        AND state->>'subjectId' = ${scope.subjectId}
        AND state->>'operationId' = ${outcome.copyOperationId}
    `;
    expect(deletedScope).toBe(1);
    const deletedCopyIndex = await instance.database.$executeRaw`
      DELETE FROM "SidedoorState"
      WHERE id LIKE 'sd-jsc:1:%' AND id LIKE ${`%:${test.options.operationId}`}
    `;
    expect(deletedCopyIndex).toBeGreaterThan(0);
    const deletedCopy = await instance.database.$executeRaw`
      DELETE FROM "SidedoorState"
      WHERE id LIKE 'sd-j:1:%' AND id LIKE ${`%:${test.options.operationId}`}
    `;
    expect(deletedCopy).toBe(1);
    const before = await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitLearningStorageDeletion({
          database: tx,
          scope: { kind: 'profile', id: owner.id },
          subjects: [scope],
          currentBackend: test.target,
        })
      )
    ).rejects.toThrow('Storage relocation scope attribution does not match its assets');
    expect(await instance.database.sidedoorState.findMany({ orderBy: { id: 'asc' } })).toEqual(
      before
    );
    expect(await instance.database.user.findUnique({ where: { id: owner.id } })).not.toBeNull();
  });

  it('allows a new generation to be deleted while an old shared receipt has a tombstoned co-owner', async () => {
    const { instance, identity } = context();
    const test = await fixture(undefined, true);
    if (!test.other) throw new Error('Missing shared owner');
    const outcome = await executeSottoStorageCopy(test.options);
    const owner = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const other = await instance.database.user.findUniqueOrThrow({ where: { id: test.other.id } });
    const newGeneration = owner.createdAt.getTime() + 1000;
    await sottoTransaction(instance.database, async (tx) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).retire({
        operationId: randomUUID(),
        consumer: `profile:${owner.id}:avatar`,
        previousReference: outcome.reference,
      });
      await tx.user.update({
        where: { id: owner.id },
        data: { image: null, createdAt: new Date(newGeneration) },
      });
      await new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID).forbidWrites(
        prepareStorageTombstone({
          namespace: SIDEDOOR_STATE_ID,
          subjectId: `profile:${other.id}`,
          generation: other.createdAt.getTime(),
          jobId: randomUUID(),
        })
      );
    });
    await sottoTransaction(instance.database, async (tx) => {
      await admitLearningStorageDeletion({
        database: tx,
        scope: { kind: 'profile', id: owner.id },
        subjects: [{ subjectId: `profile:${owner.id}`, generation: newGeneration }],
        currentBackend: test.target,
      });
      await tx.user.delete({ where: { id: owner.id } });
    });
    expect(await instance.database.user.findUnique({ where: { id: owner.id } })).toBeNull();
    expect(
      await instance.database.user.findUniqueOrThrow({ where: { id: other.id } })
    ).toMatchObject({
      image: outcome.reference,
    });
    const retained = await sottoTransaction(instance.database, (tx) =>
      new StorageRelocationRegistry(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        SIDEDOOR_STATE_ID
      ).listForSubject(`profile:${other.id}`)
    );
    expect(retained.receipts).toEqual([
      expect.objectContaining({ operationId: outcome.copyOperationId }),
    ]);
  });
}
