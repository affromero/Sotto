import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  prepareStorageCleanup,
  prepareStorageBackend,
  StorageBackendRegistry,
  StorageCleanupJournal,
  StorageReferenceRegistry,
  StorageRelocationRegistry,
  writeSurvivorProjection,
} from 'thesidedoor-core/storage';
import type { CapturedStorageBackend } from '@/lib/r2';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { openSottoStorageConnection } from '@/lib/sidedoor/storage/core/storage-connection';
import { runSottoStorageCleanup } from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';
import {
  assertRelocationInventorySize,
  captureRelocationComponent,
} from '@/lib/sidedoor/storage/migration/relocation/inventory';
import { buildStorageSurvivorGraph } from '@/lib/sidedoor/storage/migration/relocation/paths';
import { verifyAvatarProjectionOwnership } from '@/lib/sidedoor/storage/migration/relocation/avatar-ownership';
import { planStorageSurvivorProjection } from '@/lib/sidedoor/storage/migration/relocation/projection';
import { inspectRetainedAvatarProjection } from '@/lib/sidedoor/storage/migration/relocation/retained-avatar';
import {
  eraseRetainedAvatarHistory,
  finalizeRetainedProfileHistory,
  readSurvivorCopyProof,
  retainSurvivorCopyProofs,
  verifySurvivorCopyProofInventory,
} from '@/lib/sidedoor/storage/migration/relocation/proof';
import {
  admitSottoStorageCopy,
  executeSottoStorageCopy,
  prepareStorageCopiesForDeletion,
} from '@/lib/sidedoor/storage/migration/storage-migration-copy';
import { readStorageMigrationAssetPage } from '@/lib/sidedoor/storage/migration/storage-migration-plan';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';

type SharedCopyFixture = {
  bytes: Buffer;
  reference: string;
  source: CapturedStorageBackend;
  target: CapturedStorageBackend;
  other: { id: string } | null;
  options: Parameters<typeof executeSottoStorageCopy>[0];
};

export function registerSharedHistoryTests({
  fixture,
  backend,
  context,
}: {
  fixture(episodeId?: string, shared?: boolean): Promise<SharedCopyFixture>;
  backend(): Promise<CapturedStorageBackend>;
  context(): { instance: SharedTestInstance; identity: SharedTestIdentity };
}) {
  const prepareChain = async () => {
    const { instance, identity } = context();
    const test = await fixture(undefined, true);
    const other = test.other;
    if (!other) throw new Error('Missing shared owner');
    const first = await executeSottoStorageCopy(test.options);
    const { request, admission } = test.options;
    const page = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationAssetPage({ database, request, admission })
    );
    const entry = page.entries[0];
    if (!entry || page.entries.length !== 1 || page.issues.length)
      throw new Error('Missing second copy candidate');
    const target = await backend();
    const operationId = randomUUID();
    const parent = await sottoTransaction(instance.database, (tx) =>
      admitSottoStorageCopy(tx, {
        request,
        admission,
        operationId,
        entry,
        target: target.descriptor,
        timeoutMs: 30_000,
      })
    );
    const second = await executeSottoStorageCopy({
      ...test.options,
      target,
      operationId,
      fingerprint: parent.fingerprint,
    });
    return {
      instance,
      identity,
      test,
      other,
      first,
      second,
      target,
      secondJob: { id: operationId, fingerprint: parent.fingerprint },
    };
  };

  it('traces the complete shared relocation suffix for each current owner', async () => {
    const { instance, identity, test, other, first, second } = await prepareChain();
    for (const id of [identity.ownerId, other.id]) {
      const trace = await sottoTransaction(instance.database, (tx) =>
        new StorageRelocationRegistry(
          { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
          'postgres',
          SIDEDOOR_STATE_ID
        ).traceBackward({
          consumer: `profile:${id}:avatar`,
          currentReference: second.reference,
          maxHops: 2,
        })
      );
      expect(trace.edges.map((edge) => edge.operationId)).toEqual([
        first.copyOperationId,
        second.copyOperationId,
      ]);
      expect(trace.boundary).toMatchObject({
        kind: 'allocation-origin',
        reference: test.reference,
      });
    }
  });

  it('captures the complete shared copy component from the current asset', async () => {
    const { instance, first, second } = await prepareChain();
    const component = await sottoTransaction(instance.database, (tx) =>
      captureRelocationComponent(tx, { seedAssetIds: [second.assetId] })
    );
    expect(component.receipts.map((receipt) => receipt.operationId).sort()).toEqual(
      [first.copyOperationId, second.copyOperationId].sort()
    );
    expect(component.assets).toHaveLength(3);
    expect(component.outsideAssets).toEqual([]);
    expect(component.missingOutsideAssetIds).toEqual([]);
    expect(component.unresolvedPreviousReferences).toEqual([]);
    expect(component.missingRetirementClaims).toEqual([]);
    const graph = buildStorageSurvivorGraph(component);
    expect(graph.paths).toHaveLength(2);
    expect(graph.paths.every((path) => path.terminal.assetId === second.assetId)).toBe(true);
    expect(() =>
      buildStorageSurvivorGraph({
        ...component,
        unresolvedPreviousReferences: ['https://media.example/unclassified'],
      })
    ).toThrow('Storage relocation has unclassified related history');
  });

  it('rejects oversized relocation evidence before loading the inventory', async () => {
    const { instance } = await prepareChain();
    await expect(
      sottoTransaction(instance.database, (tx) => assertRelocationInventorySize(tx, 1))
    ).rejects.toThrow('Storage relocation inventory is too large');
  });

  it('classifies both copies by deleted and surviving owner without authorizing erasure', async () => {
    const { instance, identity, test, other, first, second, secondJob } = await prepareChain();
    const user = await instance.database.user.findUniqueOrThrow({ where: { id: other.id } });
    const scope = { subjectId: `profile:${other.id}`, generation: user.createdAt.getTime() };
    const deleted = `profile:${other.id}:avatar`;
    const survivor = `profile:${identity.ownerId}:avatar`;
    const copies = await sottoTransaction(instance.database, (tx) =>
      prepareStorageCopiesForDeletion(
        tx,
        [{ id: test.options.operationId, fingerprint: test.options.fingerprint }, secondJob].map(
          (job) => ({
            ...job,
            scope,
            subjects: [scope],
            consumers: new Map([[deleted, second.reference]]),
          })
        )
      )
    );
    expect(copies.map((copy) => copy.relocationId)).toEqual([
      first.copyOperationId,
      second.copyOperationId,
    ]);
    expect(copies.every((copy) => copy.deletedConsumers.has(deleted))).toBe(true);
    expect(copies.every((copy) => copy.survivingConsumers.has(survivor))).toBe(true);
    expect(copies.every((copy) => copy.claims.length === 2)).toBe(true);
  });

  it('rejects a deleted owner omitted from the application reference inventory', async () => {
    const { instance, other, secondJob } = await prepareChain();
    const user = await instance.database.user.findUniqueOrThrow({ where: { id: other.id } });
    const scope = { subjectId: `profile:${other.id}`, generation: user.createdAt.getTime() };
    await expect(
      sottoTransaction(instance.database, (tx) =>
        prepareStorageCopiesForDeletion(tx, [
          { ...secondJob, scope, subjects: [scope], consumers: new Map() },
        ])
      )
    ).rejects.toThrow('Storage copy deletion inventory is incomplete');
  });

  it('classifies a deleted owner who switched to a bundled avatar after copying', async () => {
    const { instance, other, second, secondJob } = await prepareChain();
    const user = await instance.database.user.findUniqueOrThrow({ where: { id: other.id } });
    const scope = { subjectId: `profile:${other.id}`, generation: user.createdAt.getTime() };
    const consumer = `profile:${other.id}:avatar`;
    await sottoTransaction(instance.database, async (tx) => {
      const registry = new StorageReferenceRegistry(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      await registry.retire({
        operationId: randomUUID(),
        consumer,
        previousReference: second.reference,
      });
      await tx.user.update({ where: { id: other.id }, data: { image: '/avatars/jaguar.png' } });
    });
    const [copy] = await sottoTransaction(instance.database, (tx) =>
      prepareStorageCopiesForDeletion(tx, [
        { ...secondJob, scope, subjects: [scope], consumers: new Map() },
      ])
    );
    expect(copy?.deletedConsumers.has(consumer)).toBe(true);
    expect(copy?.retiredConsumers.has(consumer)).toBe(true);
  });

  it('preserves the other owner through a verified shared-history projection', async () => {
    const { instance, identity, test, other, second, secondJob } = await prepareChain();
    const user = await instance.database.user.findUniqueOrThrow({ where: { id: other.id } });
    const scope = { subjectId: `profile:${other.id}`, generation: user.createdAt.getTime() };
    const deleted = `profile:${other.id}:avatar`;
    const survivor = `profile:${identity.ownerId}:avatar`;
    await sottoTransaction(instance.database, async (tx) => {
      const component = await captureRelocationComponent(tx, { seedAssetIds: [second.assetId] });
      const graph = buildStorageSurvivorGraph(component);
      const copies = await prepareStorageCopiesForDeletion(
        tx,
        [{ id: test.options.operationId, fingerprint: test.options.fingerprint }, secondJob].map(
          (job) => ({
            ...job,
            scope,
            subjects: [scope],
            consumers: new Map([[deleted, second.reference]]),
          })
        )
      );
      const projection = planStorageSurvivorProjection(graph, copies, [scope]);
      const wrongScope = { ...scope, generation: scope.generation + 1 };
      expect(() => planStorageSurvivorProjection(graph, copies, [wrongScope])).toThrow(
        'Storage copy deletion scopes do not match'
      );
      const wrongGeneration = copies.map((copy) => ({
        ...copy,
        deletionScope: wrongScope,
        deletionSubjects: [wrongScope],
      }));
      expect(() => planStorageSurvivorProjection(graph, wrongGeneration, [wrongScope])).toThrow(
        'Storage deletion scope generation changed'
      );
      const wrongConsumer = copies.map((copy) => ({
        ...copy,
        deletedConsumers: new Set([survivor]),
        survivingConsumers: new Set([deleted]),
      }));
      expect(() => planStorageSurvivorProjection(graph, wrongConsumer, [scope])).toThrow(
        'Storage copy deletion ownership is not independently verified'
      );
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const job = prepareStorageCleanup({
        namespace: SIDEDOOR_STATE_ID,
        ...scope,
        retentionPolicy: 'job-id-snapshots-v1',
      });
      await new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID).createJob(job);
      const projected = await writeSurvivorProjection({
        database: executor,
        dialect: 'postgres',
        projection,
        authorities: [{ ...scope, jobId: job.id, epoch: job.epoch }],
        verifyApplication: async (original) => {
          await verifyAvatarProjectionOwnership(tx, original, copies, [scope]);
          return true;
        },
      });
      await expect(verifySurvivorCopyProofInventory(tx, 10)).rejects.toThrow(
        'Storage projected relocation has no survivor copy proof'
      );
      await expect(
        retainSurvivorCopyProofs(tx, projected, copies, [
          { ...scope, jobId: job.id, epoch: job.epoch + 1 },
        ])
      ).rejects.toThrow('Storage survivor cleanup authority does not match');
      const forged = copies.map((copy) => ({
        ...copy,
        claims: copy.claims.map((claim) =>
          claim.consumer === survivor
            ? { ...claim, requiredAssociations: { changed: true } }
            : claim
        ),
      }));
      await expect(
        retainSurvivorCopyProofs(tx, projected, forged, [
          { ...scope, jobId: job.id, epoch: job.epoch },
        ])
      ).rejects.toThrow('Storage survivor original copy payload changed');
      await retainSurvivorCopyProofs(tx, projected, copies, [
        { ...scope, jobId: job.id, epoch: job.epoch },
      ]);
      await expect(verifySurvivorCopyProofInventory(tx, 10)).rejects.toThrow(
        'Storage survivor original copy erasure is not verified'
      );
      for (const copy of copies) {
        if (!(await sottoJobSnapshot(tx).eraseNext(copy.jobId, copy.fingerprint)).complete)
          throw new Error('Copy snapshot erasure did not complete');
        await sottoJobOutbox(tx).erase(copy.jobId, copy.fingerprint, scope);
      }
    });
    await sottoTransaction(instance.database, async (tx) => {
      const relocations = new StorageRelocationRegistry(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      await expect(
        relocations.resolve({
          consumer: survivor,
          originalReference: test.reference,
          currentReference: second.reference,
          maxHops: 2,
        })
      ).resolves.toMatchObject({ current: { assetId: second.assetId } });
      expect((await relocations.listForSubject(scope.subjectId)).receipts).toEqual([]);
      const owner = await tx.user.findUniqueOrThrow({ where: { id: identity.ownerId } });
      const ownerScope = {
        subjectId: `profile:${owner.id}`,
        generation: owner.createdAt.getTime(),
      };
      const retained = buildStorageSurvivorGraph(
        await captureRelocationComponent(tx, { seedAssetIds: [second.assetId] })
      );
      await expect(verifySurvivorCopyProofInventory(tx, 10)).resolves.toBeUndefined();
      for (const receipt of retained.receipts) {
        const proof = await readSurvivorCopyProof(tx, receipt);
        expect(JSON.stringify(proof)).not.toContain(other.id);
        await expect(
          readSurvivorCopyProof(tx, {
            ...receipt,
            content: { ...receipt.content, bytes: receipt.content.bytes + 1 },
          })
        ).rejects.toThrow('Storage survivor copy proof does not match relocation');
      }
      const finalDeletion = {
        subjects: [ownerScope],
        consumers: new Map([[survivor, second.reference]]),
      };
      await expect(inspectRetainedAvatarProjection(tx, retained, finalDeletion)).rejects.toThrow(
        'Storage projection has an unaccounted application reference'
      );
      const terminal = retained.assets.find((asset) => asset.id === second.assetId);
      if (!terminal) throw new Error('Missing retained terminal asset');
      await tx.user.update({
        where: { id: other.id },
        data: { image: terminal.prepared.target.key },
      });
      await expect(inspectRetainedAvatarProjection(tx, retained, finalDeletion)).rejects.toThrow(
        'Storage projection has an unaccounted application reference'
      );
      await tx.user.update({
        where: { id: other.id },
        data: { image: `https://app.example${terminal.prepared.reference}?download=1` },
      });
      await expect(inspectRetainedAvatarProjection(tx, retained, finalDeletion)).rejects.toThrow(
        'Storage projection has an unaccounted application reference'
      );
      await tx.user.update({
        where: { id: other.id },
        data: {
          image: `https://app.example/${terminal.prepared.reference.slice(1).replaceAll('/', '%252F')}`,
        },
      });
      await expect(inspectRetainedAvatarProjection(tx, retained, finalDeletion)).rejects.toThrow(
        'Storage projection has an unaccounted application reference'
      );
      await tx.user.update({
        where: { id: other.id },
        data: {
          image: `https://app.example${terminal.prepared.reference.replace('/v1/', '//v1/')}`,
        },
      });
      await expect(inspectRetainedAvatarProjection(tx, retained, finalDeletion)).rejects.toThrow(
        'Storage projection has an unaccounted application reference'
      );
      const backendRegistry = new StorageBackendRegistry(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        SIDEDOOR_STATE_ID
      );
      const originalBackend = await backendRegistry.get(terminal.prepared.target.backendId);
      if (!originalBackend || originalBackend.descriptor.kind !== 'local')
        throw new Error('Missing local test backend');
      const aliasRoot = '/tmp/sotto-historical-reference-alias';
      await backendRegistry.register(
        prepareStorageBackend(SIDEDOOR_STATE_ID, {
          ...originalBackend.descriptor,
          referenceRoot: aliasRoot,
        })
      );
      await tx.user.update({
        where: { id: other.id },
        data: { image: `file://${aliasRoot}/${terminal.prepared.target.key}` },
      });
      await expect(inspectRetainedAvatarProjection(tx, retained, finalDeletion)).rejects.toThrow(
        'Storage projection has an unaccounted application reference'
      );
      await tx.user.update({ where: { id: other.id }, data: { image: null } });
      await expect(
        inspectRetainedAvatarProjection(tx, retained, finalDeletion)
      ).resolves.toHaveLength(2);
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const ownerJob = prepareStorageCleanup({
        namespace: SIDEDOOR_STATE_ID,
        ...ownerScope,
        retentionPolicy: 'job-id-snapshots-v1',
      });
      await new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID).createJob(ownerJob);
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).retire({
        operationId: randomUUID(),
        consumer: survivor,
        previousReference: second.reference,
      });
      const retired = buildStorageSurvivorGraph(
        await captureRelocationComponent(tx, { seedAssetIds: [second.assetId] })
      );
      await expect(
        eraseRetainedAvatarHistory(tx, retired, [
          { ...ownerScope, jobId: ownerJob.id, epoch: ownerJob.epoch },
        ])
      ).rejects.toThrow('Storage projection has an unaccounted application reference');
      await tx.user.delete({ where: { id: owner.id } });
      await expect(eraseRetainedAvatarHistory(tx, retired, [])).rejects.toThrow(
        'Storage survivor cleanup authority is missing'
      );
      await eraseRetainedAvatarHistory(tx, retired, [
        { ...ownerScope, jobId: ownerJob.id, epoch: ownerJob.epoch },
      ]);
      await expect(verifySurvivorCopyProofInventory(tx, 10)).resolves.toBeUndefined();
    });
  });

  it.each(['requester', 'other'] as const)(
    'preserves a shared relocation chain when the %s is deleted first',
    async (firstDeleted) => {
      const { instance, identity, test, other, first, second, target } = await prepareChain();
      const deletedId = firstDeleted === 'requester' ? identity.ownerId : other.id;
      const survivorId = firstDeleted === 'requester' ? other.id : identity.ownerId;
      const remove = async (id: string) => {
        const user = await instance.database.user.findUniqueOrThrow({ where: { id } });
        const jobs = await sottoTransaction(instance.database, async (tx) => {
          let retainedAsset: string | undefined;
          const admitted = await admitLearningStorageDeletion({
            database: tx,
            scope: { kind: 'profile', id },
            subjects: [{ subjectId: `profile:${id}`, generation: user.createdAt.getTime() }],
            currentBackend: target,
            deferRetainedProfile: (assetId) => {
              retainedAsset = assetId;
            },
          });
          await tx.user.delete({ where: { id } });
          if (retainedAsset) {
            const job = admitted.find((item) => item.subjectId === `profile:${id}`);
            if (!job) throw new Error('Missing profile cleanup');
            await finalizeRetainedProfileHistory(tx, retainedAsset, {
              subjectId: job.subjectId,
              generation: job.generation,
              jobId: job.id,
              epoch: job.epoch,
            });
          }
          return admitted;
        });
        for (const job of jobs)
          await runSottoStorageCleanup(instance.database, job.id, {
            openConnection: () =>
              openSottoStorageConnection(process.env.SIDEDOOR_TEST_DATABASE_URL, instance.schema),
          });
      };
      const root = await mkdtemp(join(tmpdir(), 'sotto-shared-chain-'));
      try {
        await remove(deletedId);
        expect(await instance.database.user.findUnique({ where: { id: deletedId } })).toBeNull();
        expect(
          await instance.database.user.findUniqueOrThrow({ where: { id: survivorId } })
        ).toMatchObject({
          image: second.reference,
        });
        const surviving = await sottoTransaction(instance.database, async (tx) => {
          const executor = {
            query: (sql: string, values: readonly unknown[]) =>
              tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          };
          return {
            reference: await new StorageReferenceRegistry(
              executor,
              'postgres',
              SIDEDOOR_STATE_ID
            ).resolve({
              consumer: `profile:${survivorId}:avatar`,
              reference: second.reference,
            }),
            lineage: await new StorageRelocationRegistry(
              executor,
              'postgres',
              SIDEDOOR_STATE_ID
            ).resolve({
              consumer: `profile:${survivorId}:avatar`,
              originalReference: test.reference,
              currentReference: second.reference,
              maxHops: 1000,
            }),
          };
        });
        expect(surviving.reference).toMatchObject({ assetId: second.assetId });
        expect(surviving.lineage).toMatchObject({
          current: { assetId: second.assetId },
          content: first.content,
        });
        const survivorFile = join(root, 'survivor');
        await target.downloadToFile(second.reference, survivorFile);
        expect(await readFile(survivorFile)).toEqual(test.bytes);
        await remove(survivorId);
        expect(await instance.database.user.findUnique({ where: { id: survivorId } })).toBeNull();
        await expect(
          test.source.downloadToFile(test.reference, join(root, 'source'))
        ).rejects.toThrow();
        await expect(
          test.target.downloadToFile(first.reference, join(root, 'first'))
        ).rejects.toThrow();
        await expect(
          target.downloadToFile(second.reference, join(root, 'second'))
        ).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    60_000
  );
}
