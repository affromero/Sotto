import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  prepareStorageBackend,
  prepareStorageCleanup,
  prepareStorageManifestPages,
  StorageBackendRegistry,
  StorageCleanupAttribution,
  StorageCleanupJournal,
  StorageReferenceRegistry,
  StorageRelocationRegistry,
  StorageWriteJournal,
  type StorageCleanupJob,
} from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import {
  ownedStorageReferences,
  visitStorageDeletionReferences,
  type StorageDeletionInventoryScope,
  type StorageDeletionScope,
} from '@/lib/storage/sidedoor/deletion-targets';
import { captureStorageBackend } from '@/lib/r2';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { worksheetPdfPayloadSchema } from '@/lib/sidedoor/jobs/stitch/worksheet-pdf-work';
import { getSiteConfig } from '@/lib/site-config';
import { consumerForStorageField } from '@/lib/sidedoor/storage/core/storage-consumers';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { verifyStorageCopyForDeletion } from '@/lib/sidedoor/storage/migration/storage-migration-copy';
import {
  eraseMaterialAnalysisState,
  materialAnalysisDeletionSubjects,
} from '@/lib/course-materials/jobs/analysis-erasure';
import {
  erasePrerequisiteDeletion,
  eraseCompletedClassCleanupReceipts,
  inspectPrerequisiteDeletions,
} from '@/lib/classes/help/prerequisite-deletion';
import {
  eraseSpeakingGradingDeletion,
  inspectClassSpeakingMedia,
  inspectSpeakingGradingDeletion,
  requireLegacySpeakingClassDeletionSafe,
} from '@/lib/sidedoor/jobs/stitch/speaking-grading-deletion';
import {
  eraseAssessmentSpeakingForDeletion,
  reconcileAssessmentSpeakingDeletionScopes,
} from '@/lib/learning/classes/speaking/lifecycle/assessment-speaking-deletion';
import {
  inspectClassListeningDeletion,
  requireClassWorksheetOwnership,
  inspectLegacyWorksheetDeletion,
} from '@/lib/classes/help/listening-deletion';

type Subject = { subjectId: string; generation: number };

/** Delegated cleanup requires the database fence, including during rollbacks. */
export async function requireStorageTargetFence(database: Prisma.TransactionClient) {
  const rows = await database.$queryRaw<{ active: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = to_regclass('"SidedoorState"')
        AND tgname = 'SidedoorState_storage_target_fence'
        AND tgfoid = to_regprocedure('"guardStorageTargetFence"()')
        AND NOT tgisinternal
        AND tgtype = 31 AND tgnargs = 0 AND tgqual IS NULL
        AND (tgenabled = 'A' OR (tgenabled = 'O' AND current_setting('session_replication_role') <> 'replica'))
    ) AS active`;
  if (rows[0]?.active !== true) throw new Error('Storage target fence is unavailable');
}

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
    writes: new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID),
  };
}

async function deletionReferences(
  database: Prisma.TransactionClient,
  scope: StorageDeletionInventoryScope
) {
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

/** Erasure removes exact grant rows before their page/operation foreign keys cascade. */
async function eraseMaterialRecognitionGrants(
  database: Prisma.TransactionClient,
  scope: StorageDeletionScope
) {
  // Retiring completed transfer parts preserves the retained document and its journal.
  if (scope.kind === 'material-upload') return;
  const material: Prisma.CourseMaterialWhereInput =
    scope.kind === 'instance'
      ? {}
      : scope.kind === 'profile'
        ? { userId: scope.id }
        : scope.kind === 'material'
          ? { id: scope.id }
          : { courseId: scope.id };
  let after: string | null = null;
  while (true) {
    const operations: Array<{ id: string }> = await database.materialRecognitionOperation.findMany({
      where: { ...(after ? { id: { gt: after } } : {}), page: { run: { material } } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    if (!operations.length) return;
    await database.sidedoorState.deleteMany({
      where: {
        id: {
          in: operations.map(
            (operation) => `${SIDEDOOR_STATE_ID}:material-recognition-grant:${operation.id}`
          ),
        },
      },
    });
    if (operations.length < 100) return;
    after = operations[operations.length - 1]!.id;
  }
}

/**
 * Permanently revoke entity storage scopes and retain exact cleanup evidence in the
 * same transaction that removes their application rows.
 */
export async function admitLearningStorageDeletion(options: {
  database: Prisma.TransactionClient;
  scope: StorageDeletionInventoryScope;
  subjects: readonly Subject[];
  currentBackend: Awaited<ReturnType<typeof captureStorageBackend>>;
}): Promise<StorageCleanupJob[]> {
  const { database } = options;
  if (options.scope.kind === 'profile')
    await eraseCompletedClassCleanupReceipts(database, options.scope.id);
  if (
    options.scope.kind === 'class' &&
    options.subjects[0]?.subjectId !== `class:${options.scope.id}`
  )
    throw new Error('Class deletion requires its exact class scope');
  const state = stores(database);
  const prerequisite = await inspectPrerequisiteDeletions(database, options.scope);
  if (
    options.scope.kind === 'class' &&
    (prerequisite.length !== 1 ||
      prerequisite[0]!.classScope.generation !== options.subjects[0]!.generation)
  )
    throw new Error('Class deletion ownership changed');
  const assessmentEpisodeIds = prerequisite.flatMap((item) => item.audio.episodeIds);
  if (options.scope.kind === 'class') {
    const item = prerequisite[0]!;
    const listening = await inspectClassListeningDeletion(
      database,
      item.classId,
      item.courseId,
      item.userId
    );
    const expected = listening.map((subject) => subject.subjectId.slice('episode:'.length)).sort();
    if (
      JSON.stringify([...options.scope.episodeIds].sort()) !== JSON.stringify(expected) ||
      options.subjects.length !== listening.length + 1 ||
      listening.some(
        (subject) =>
          !options.subjects.some(
            (candidate) =>
              candidate.subjectId === subject.subjectId &&
              candidate.generation === subject.generation
          )
      )
    )
      throw new Error('Class listening ownership changed');
  }
  if (options.scope.kind === 'course') {
    const { episodeIds } = options.scope;
    if (assessmentEpisodeIds.some((id) => !episodeIds.includes(id)))
      throw new Error('Course assessment audio inventory changed');
  }
  const storageScope =
    options.scope.kind === 'class'
      ? { ...options.scope, episodeIds: [...options.scope.episodeIds, ...assessmentEpisodeIds] }
      : options.scope;
  let legacy: {
    classId: string;
    courseScope: Subject;
    scopes: Subject[];
    operations: { id: string; fingerprint: string }[];
    reference: string | null;
  } | null = null;
  if (options.scope.kind === 'class') {
    const classId = options.scope.id;
    const inventory = prerequisite[0]!;
    const cls = await database.courseClass.findUnique({
      where: { id: classId },
      select: { worksheetPdfUrl: true },
    });
    const courseScope = inventory.scopes.find(
      (scope) => scope.subjectId === `course:${inventory.courseId}`
    );
    if (!cls || !courseScope) throw new Error('Class media requires complete cleanup');
    const operations = await inspectLegacyWorksheetDeletion(
      database,
      courseScope,
      classId,
      inventory.courseId
    );
    const ownership = operations.length
      ? await captureCourseStorage(database, inventory.courseId)
      : null;
    if (ownership)
      legacy = {
        classId,
        courseScope,
        scopes: ownership.scopes,
        operations,
        reference: cls.worksheetPdfUrl,
      };
    if (cls.worksheetPdfUrl)
      await requireClassWorksheetOwnership(
        database,
        classId,
        cls.worksheetPdfUrl,
        inventory.scopes,
        inventory.worksheetOperations,
        ownership ? { scopes: ownership.scopes, operations } : undefined
      );
    await requireLegacySpeakingClassDeletionSafe(database, courseScope, classId);
  }
  const assessmentSpeaking = prerequisite.flatMap((item) => item.assessmentSpeakingOperations);
  const speaking = await inspectSpeakingGradingDeletion(
    database,
    options.subjects,
    assessmentSpeaking
  );
  if (options.scope.kind === 'class') {
    const inventory = prerequisite[0]!;
    await inspectClassSpeakingMedia(
      database,
      {
        classId: options.scope.id,
        courseId: inventory.courseId,
        userId: inventory.userId,
        scope: inventory.classScope,
      },
      speaking
    );
  }
  const current = prepareStorageBackend(SIDEDOOR_STATE_ID, options.currentBackend.descriptor);
  await state.backends.register(current);
  const subjects = new Map(options.subjects.map((subject) => [subject.subjectId, subject]));
  if (subjects.size !== options.subjects.length || !subjects.size)
    throw new Error('Learning deletion requires unique storage subjects');
  const materialSubjects =
    options.scope.kind === 'class'
      ? []
      : await materialAnalysisDeletionSubjects(database, options.scope);
  for (const subject of materialSubjects) {
    const previous = subjects.get(subject.subjectId);
    if (previous && previous.generation !== subject.generation)
      throw new Error('Derived source deletion generation changed');
    subjects.set(subject.subjectId, subject);
  }
  const assessedSpeaking = await reconcileAssessmentSpeakingDeletionScopes(
    database,
    [...subjects.values()],
    assessmentSpeaking
  );
  const { consumers, publicUrl } = await deletionReferences(database, storageScope);
  const copies = new Map<string, { id: string; fingerprint: string; scope: Subject }>();
  const outbox = sottoJobOutbox(database);
  for (const subject of subjects.values()) {
    let copyCursor: string | null = null;
    do {
      const page = await outbox.listForScope(subject.subjectId, subject.generation, copyCursor);
      for (const reference of page.jobs) {
        const receipt = await outbox.receipt(reference.id);
        if (!receipt || receipt.fingerprint !== reference.fingerprint)
          throw new Error('Storage copy scope changed');
        if (receipt.handler !== 'storage-migration-copy' || receipt.version !== 1) continue;
        if (receipt.status === 'erased') continue;
        const previous = copies.get(reference.id);
        if (previous) {
          if (previous.fingerprint !== reference.fingerprint)
            throw new Error('Storage copy changed');
          const record = await outbox.read(reference.id);
          if (
            !record ||
            !record.job.scopes.some(
              (scope) =>
                scope.subjectId === subject.subjectId && scope.generation === subject.generation
            )
          )
            throw new Error('Storage copy scope index changed');
          continue;
        }
        await verifyStorageCopyForDeletion(database, {
          id: reference.id,
          fingerprint: reference.fingerprint,
          scope: subject,
          consumers: new Set(consumers.keys()),
        });
        copies.set(reference.id, {
          id: reference.id,
          fingerprint: reference.fingerprint,
          scope: subject,
        });
      }
      if (page.cursor !== null && copyCursor !== null && page.cursor <= copyCursor)
        throw new Error('Storage copy scope cursor did not advance');
      copyCursor = page.cursor;
    } while (copyCursor !== null);
  }
  for (const inventory of prerequisite) {
    for (const expected of inventory.copyOperations) {
      if (copies.get(expected.id)?.fingerprint !== expected.fingerprint)
        throw new Error('Storage copy scope index is incomplete');
    }
  }
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
  if (legacy) await requireStorageTargetFence(database);
  if (legacy?.reference) {
    const reference = legacy.reference;
    const consumer = `class:${legacy.classId}:worksheet`;
    const resolved = await state.references.resolve({ consumer, reference });
    if (resolved && isDeepStrictEqual(resolved.prepared.scopes, legacy.scopes)) {
      const job = jobs.get(`class:${legacy.classId}`);
      if (!job) throw new Error('Legacy worksheet deletion scope is missing');
      const current = legacy;
      const asset = await state.references.readAsset(resolved.assetId);
      if (!asset || !asset.asset.consumers.includes(consumer))
        throw new Error('Legacy worksheet consumer changed');
      if (asset.asset.consumers.length > 1) {
        await state.references.retire({
          operationId: randomUUID(),
          consumer,
          previousReference: reference,
        });
      } else
        await state.attribution.admitDelegatedAsset({
          jobId: job.id,
          epoch: job.epoch,
          subjectId: job.subjectId,
          generation: job.generation,
          originalScope: current.courseScope,
          operationId: randomUUID(),
          consumer,
          reference,
          verifyOwnership: async () => {
            const cls = await database.courseClass.findUnique({
              where: { id: current.classId },
              select: { worksheetPdfUrl: true },
            });
            return cls?.worksheetPdfUrl === reference;
          },
        });
      consumers.delete(consumer);
    }
  }
  for (const [consumer, reference] of consumers) {
    const resolved = await state.references.resolve({ consumer, reference });
    if (!resolved && ownedStorageReferences([reference], publicUrl).length)
      throw new Error('Storage reference ' + consumer + ' was not imported into Sidedoor');
    if (
      resolved &&
      !resolved.prepared.scopes.some((scope) => {
        const subject = subjects.get(scope.subjectId);
        return subject?.generation === scope.generation;
      })
    )
      throw new Error('Storage reference ' + consumer + ' has no matching deletion scope');
  }

  type AssetPage = Awaited<ReturnType<typeof state.references.listAssets>>;
  const assetsByJob = new Map<string, AssetPage['assets']>();
  const liveTargets = new Set<string>();
  let after: string | null = null;
  do {
    const page = await state.references.listAssets(after);
    for (const asset of page.assets) {
      const matchingScope = asset.prepared.scopes.find((scope) => {
        const job = jobs.get(scope.subjectId);
        return job?.generation === scope.generation;
      });
      const matching = matchingScope ? jobs.get(matchingScope.subjectId) : undefined;
      const removed = asset.consumers.filter((consumer) => consumers.has(consumer));
      if (!matching || removed.length !== asset.consumers.length) {
        if (asset.consumers.length)
          liveTargets.add(
            JSON.stringify([asset.prepared.target.binding, asset.prepared.target.key])
          );
        if (!matching || !removed.length) continue;
      }
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
    let intentCursor: string | null = null;
    do {
      const page = await state.writes.list(job.subjectId, {
        after: intentCursor ?? undefined,
        limit: 1000,
      });
      for (const intent of page.intents) {
        if (intent.generation !== job.generation)
          throw new Error('Storage deletion intent generation changed');
        if (liveTargets.has(JSON.stringify([intent.target.binding, intent.target.key])))
          throw new Error('Storage write intent targets an asset with surviving consumers');
        targets.set(`${intent.target.backendId}:${intent.target.key}`, intent.target);
      }
      intentCursor = page.cursor;
    } while (intentCursor !== null);
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
    let manifestCursor: string | null = null;
    do {
      const page = await state.cleanup.listManifests(job.id, manifestCursor);
      for (const manifest of page.pages) {
        if (manifest.resolution) continue;
        const inspected = await state.attribution.inspectPage({
          jobId: job.id,
          epoch: job.epoch,
          subjectId: job.subjectId,
          generation: job.generation,
          pageId: manifest.id,
        });
        const unresolved = inspected.entries.find(
          (entry) => entry.status !== 'attributed' && entry.reason !== 'live_consumers'
        );
        if (unresolved)
          throw new Error('Storage deletion attribution is unresolved: ' + unresolved.reason);
        if (inspected.entries.some((entry) => entry.status !== 'attributed')) continue;
        await state.cleanup.resolveManifest(job.id, job.epoch, manifest.id, {
          resolver: 'sotto-learning-deletion-v1',
          entries: inspected.entries.map((entry) => {
            if (entry.status !== 'attributed')
              throw new Error('Storage deletion attribution changed');
            return { index: entry.index, kind: 'storage' as const, targets: [entry.target] };
          }),
        });
      }
      manifestCursor = page.cursor;
    } while (manifestCursor !== null);
  }
  const admitted = await Promise.all([...jobs.values()].map((job) => state.cleanup.get(job.id)));
  // Tombstones and complete reference manifests already exist. The caller's cascade
  // shares this transaction, so any failure restores both grant metadata and rows.
  if (options.scope.kind !== 'class') {
    await eraseMaterialRecognitionGrants(database, options.scope);
    await eraseMaterialAnalysisState(database, options.scope);
  }
  await eraseSpeakingGradingDeletion(database, speaking);
  await eraseAssessmentSpeakingForDeletion(database, assessedSpeaking);
  if (legacy) {
    const job = jobs.get(`class:${legacy.classId}`);
    if (!job) throw new Error('Legacy worksheet deletion scope is missing');
    const current = legacy;
    for (const operation of current.operations) {
      await outbox.eraseDelegated({
        ...operation,
        expectedHandler: 'worksheet-pdf',
        expectedVersion: 1,
        originalScope: current.courseScope,
        deletionScope: { subjectId: job.subjectId, generation: job.generation },
        cleanupJobId: job.id,
        verifyOwnership: async (record) => {
          const payload = worksheetPdfPayloadSchema.safeParse(record.job.payload);
          return (
            payload.success &&
            payload.data.classId === current.classId &&
            isDeepStrictEqual(record.job.scopes, current.scopes)
          );
        },
      });
    }
  }
  for (const copy of copies.values()) {
    const tombstone = await state.writes.tombstone(copy.scope.subjectId);
    if (!tombstone || tombstone.generation !== copy.scope.generation)
      throw new Error('Storage copy deletion scope changed');
    if (!(await sottoJobSnapshot(database).eraseNext(copy.id, copy.fingerprint)).complete)
      throw new Error('Storage copy snapshot could not be erased');
    await outbox.erase(copy.id, copy.fingerprint, copy.scope);
  }
  for (const inventory of prerequisite) {
    const subjectId =
      options.scope.kind === 'profile'
        ? `profile:${options.scope.id}`
        : options.scope.kind === 'class'
          ? `class:${options.scope.id}`
          : `course:${inventory.courseId}`;
    const scope = subjects.get(subjectId);
    if (!scope) throw new Error('Prerequisite deletion scope is missing');
    await erasePrerequisiteDeletion(database, inventory, scope);
  }
  return admitted;
}
