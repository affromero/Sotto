import { randomUUID } from 'node:crypto';
import {
  prepareStorageBackend,
  prepareStorageCleanup,
  prepareStorageManifestPages,
  StorageBackendRegistry,
  StorageCleanupAttribution,
  StorageCleanupJournal,
  StorageReferenceRegistry,
  StorageRelocationRegistry,
  type StorageCleanupJob,
} from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import {
  ownedStorageReferences,
  visitStorageDeletionReferences,
  type StorageDeletionScope,
} from '@/lib/storage/sidedoor/deletion-targets';
import { captureStorageBackend } from '@/lib/r2';
import { getSiteConfig } from '@/lib/site-config';
import { consumerForStorageField } from '@/lib/sidedoor/storage/core/storage-consumers';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

type Subject = { subjectId: string; generation: number };

function stores(database: Prisma.TransactionClient) {
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  return {
    cleanup: new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID),
    attribution: new StorageCleanupAttribution(executor, 'postgres', SIDEDOOR_STATE_ID),
    backends: new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID),
    references: new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID),
    relocations: new StorageRelocationRegistry(executor, 'postgres', SIDEDOOR_STATE_ID),
  };
}

async function deletionReferences(database: Prisma.TransactionClient, scope: StorageDeletionScope) {
  const configured = await getSiteConfig({ database });
  const consumers = new Map<string, string>();
  await visitStorageDeletionReferences(database, scope, async (page) => {
    for (const row of page.rows) {
      for (const [field, reference] of Object.entries(row.references)) {
        const consumer = consumerForStorageField(page.source, row.id, field);
        if (consumer) consumers.set(consumer, reference);
      }
    }
  });
  return { consumers, publicUrl: configured.objectStoragePublicUrl ?? undefined };
}

function chunks<Value>(values: readonly Value[], size: number) {
  const result: Value[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

/**
 * Permanently revoke entity storage scopes and retain exact cleanup evidence in the
 * same transaction that removes their application rows.
 */
export async function admitLearningStorageDeletion(options: {
  database: Prisma.TransactionClient;
  scope: StorageDeletionScope;
  subjects: readonly Subject[];
  currentBackend: Awaited<ReturnType<typeof captureStorageBackend>>;
}): Promise<StorageCleanupJob[]> {
  const { database } = options;
  const state = stores(database);
  const current = prepareStorageBackend(SIDEDOOR_STATE_ID, options.currentBackend.descriptor);
  await state.backends.register(current);
  const subjects = new Map(options.subjects.map((subject) => [subject.subjectId, subject]));
  if (subjects.size !== options.subjects.length || !subjects.size)
    throw new Error('Learning deletion requires unique storage subjects');
  const jobs = new Map<string, StorageCleanupJob>();
  for (const subject of subjects.values()) {
    const job = prepareStorageCleanup({
      namespace: SIDEDOOR_STATE_ID,
      ...subject,
      retentionPolicy: 'job-id-snapshots-v1',
    });
    await state.cleanup.createJob(job);
    jobs.set(subject.subjectId, job);
  }

  const { consumers, publicUrl } = await deletionReferences(database, options.scope);
  for (const [consumer, reference] of consumers) {
    const resolved = await state.references.resolve({ consumer, reference });
    if (!resolved && ownedStorageReferences([reference], publicUrl).length)
      throw new Error('Storage reference ' + consumer + ' was not imported into Sidedoor');
  }

  type AssetPage = Awaited<ReturnType<typeof state.references.listAssets>>;
  const assetsByJob = new Map<string, AssetPage['assets']>();
  let after: string | null = null;
  do {
    const page = await state.references.listAssets(after);
    for (const asset of page.assets) {
      const matchingScope = asset.prepared.scopes.find((scope) => {
        const job = jobs.get(scope.subjectId);
        return job?.generation === scope.generation;
      });
      const matching = matchingScope ? jobs.get(matchingScope.subjectId) : undefined;
      if (!matching) continue;
      const removed = asset.consumers.filter((consumer) => consumers.has(consumer));
      if (!removed.length && asset.consumers.length) continue;
      for (const consumer of removed) {
        await state.references.retire({
          operationId: randomUUID(),
          consumer,
          previousReference: consumers.get(consumer)!,
        });
      }
      if (removed.length !== asset.consumers.length) continue;
      const values = assetsByJob.get(matching.id) ?? [];
      values.push(asset);
      assetsByJob.set(matching.id, values);
    }
    after = page.cursor;
  } while (after !== null);

  for (const job of jobs.values()) {
    let relocationCursor: string | null = null;
    do {
      const page = await state.relocations.eraseForSubject({
        subjectId: job.subjectId,
        generation: job.generation,
        jobId: job.id,
        epoch: job.epoch,
        after: relocationCursor,
      });
      relocationCursor = page.cursor;
    } while (relocationCursor !== null);

    const assets = assetsByJob.get(job.id) ?? [];
    const targets = new Map<string, { backendId: string; binding: string; key: string }>();
    for (const asset of assets) {
      const backend = await state.backends.get(asset.prepared.target.backendId);
      if (!backend) throw new Error('Storage deletion asset backend is missing');
      targets.set(
        asset.prepared.target.backendId + ':' + asset.prepared.target.key,
        asset.prepared.target
      );
    }
    const inventory = targets.size
      ? [...targets.values()].map((target, index) => ({
          id: 'asset-' + index,
          kind: 'inventory' as const,
          backendIds: [target.backendId],
          scope: target.key,
          match: 'key' as const,
        }))
      : [
          {
            id: 'empty',
            kind: 'inventory' as const,
            backendIds: [current.id],
            scope: '__sidedoor-empty/' + job.id,
            match: 'key' as const,
          },
        ];
    for (const page of chunks(inventory, 1000))
      await state.cleanup.registerCollectors(job.id, job.epoch, page);

    await state.cleanup.recordManifestPage(job.id, job.epoch, {
      id: 'write-protocol',
      entries: [{ kind: 'write_protocol', version: 1 }],
    });
    await state.cleanup.resolveManifest(job.id, job.epoch, 'write-protocol', {
      resolver: 'sotto-learning-deletion-v1',
      entries: [{ index: 0, kind: 'non_storage', reason: 'Sidedoor write journal tombstone' }],
    });
    for (const manifest of prepareStorageManifestPages('assets', assets)) {
      await state.cleanup.recordManifestPage(job.id, job.epoch, manifest);
      const inspected = await state.attribution.inspectPage({
        jobId: job.id,
        epoch: job.epoch,
        subjectId: job.subjectId,
        generation: job.generation,
        pageId: manifest.id,
      });
      const unresolved = inspected.entries.find((entry) => entry.status !== 'attributed');
      if (unresolved)
        throw new Error('Storage deletion attribution is unresolved: ' + unresolved.reason);
      await state.cleanup.resolveManifest(job.id, job.epoch, manifest.id, {
        resolver: 'sotto-learning-deletion-v1',
        entries: inspected.entries.map((entry) => {
          if (entry.status !== 'attributed')
            throw new Error('Storage deletion attribution changed');
          return { index: entry.index, kind: 'storage' as const, targets: [entry.target] };
        }),
      });
    }
  }
  return Promise.all([...jobs.values()].map((job) => state.cleanup.get(job.id)));
}
