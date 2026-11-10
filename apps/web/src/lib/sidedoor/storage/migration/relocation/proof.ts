import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  StorageCleanupJournal,
  StorageCleanupAttribution,
  StorageRelocationRegistry,
  StorageWriteJournal,
  storageRelocationReceiptSchema,
  validateStorageSurvivorPaths,
  type StorageSurvivorGraph,
} from 'thesidedoor-core/storage';
import { sqlStateBackend, sqlStateRows } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { hasSettledSottoExecution } from '@/lib/sidedoor/jobs/core/job-settlement-proof';
import {
  storageCopyOutcomeSchema,
  storageCopyPayloadSchema,
  type prepareStorageCopiesForDeletion,
} from '../storage-migration-copy';
import { captureRelocationComponent } from './inventory';
import { buildStorageSurvivorGraph } from './paths';
import { requireAccountedRelocationReferences } from './retained-avatar';

const scope = z
  .object({
    subjectId: z.string().min(1).max(200),
    generation: z.number().int().nonnegative().safe(),
  })
  .strict();
const proofSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('sotto_survivor_copy_proof'),
    namespace: z.literal(SIDEDOOR_STATE_ID),
    operationId: z.uuid(),
    jobId: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    receiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
    claims: z
      .array(
        z
          .object({
            consumer: z.string().min(1).max(200),
            requiredScopes: z.array(scope).length(2),
            requiredAssociations: z.null(),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict();
type PreparedCopy = Awaited<ReturnType<typeof prepareStorageCopiesForDeletion>>[number];
type Receipt = StorageSurvivorGraph['receipts'][number];

function proofPrefix() {
  const namespace = createHash('sha256').update(SIDEDOOR_STATE_ID).digest('hex');
  return `sotto-rel-proof:1:${namespace}:`;
}

function receiptDigest(receipt: Receipt) {
  receipt = storageRelocationReceiptSchema.parse(receipt);
  const consumers = [...receipt.consumers].sort();
  const scopes = [...receipt.scopes].sort((left, right) =>
    left.subjectId < right.subjectId ? -1 : left.subjectId > right.subjectId ? 1 : 0
  );
  if (
    receipt.schemaVersion !== 2 ||
    receipt.namespace !== SIDEDOOR_STATE_ID ||
    new Set(consumers).size !== consumers.length ||
    new Set(scopes.map((item) => item.subjectId)).size !== scopes.length ||
    !isDeepStrictEqual(consumers, receipt.consumers) ||
    !isDeepStrictEqual(scopes, receipt.scopes)
  )
    throw new Error('Storage survivor relocation receipt is not canonical');
  return createHash('sha256')
    .update(
      JSON.stringify([
        'sotto-survivor-receipt-v1',
        receipt.namespace,
        receipt.schemaVersion,
        receipt.kind,
        receipt.operationId,
        receipt.sourceAssetId,
        receipt.destinationAssetId,
        receipt.consumers,
        receipt.content.sha256,
        receipt.content.bytes,
        receipt.scopes.map((item) => [item.subjectId, item.generation]),
      ])
    )
    .digest('hex');
}

function backend(database: Prisma.TransactionClient, operationId: string) {
  return sqlStateBackend(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    `${proofPrefix()}${z.uuid().parse(operationId)}`
  );
}

/** Record survivor-only proof after the verified projection and before erasing original jobs. */
export async function retainSurvivorCopyProofs(
  database: Prisma.TransactionClient,
  graph: StorageSurvivorGraph,
  copies: readonly PreparedCopy[],
  authorities: readonly { subjectId: string; generation: number; jobId: string; epoch: number }[]
) {
  const coverage = validateStorageSurvivorPaths(graph);
  const byOperation = new Map(copies.map((copy) => [copy.relocationId, copy]));
  const receiptIds = new Set(graph.receipts.map((receipt) => receipt.operationId));
  if (
    byOperation.size !== copies.length ||
    receiptIds.size !== graph.receipts.length ||
    receiptIds.size !== copies.length ||
    [...byOperation.keys()].some((id) => !receiptIds.has(id))
  )
    throw new Error('Storage survivor copy evidence is incomplete');
  const instance = await sottoStorageInstance(database).read();
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  const cleanup = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
  const writes = new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
  const authorityScopes = new Map<string, { subjectId: string; generation: number }>();
  for (const authority of authorities) {
    if (authorityScopes.has(authority.subjectId))
      throw new Error('Storage survivor cleanup authority is duplicated');
    const job = await cleanup.get(authority.jobId);
    const tombstone = await writes.tombstone(authority.subjectId);
    if (
      job.subjectId !== authority.subjectId ||
      job.generation !== authority.generation ||
      job.epoch !== authority.epoch ||
      job.phase !== 'preparing' ||
      job.retentionPolicy !== 'job-id-snapshots-v1' ||
      tombstone?.jobId !== job.id ||
      tombstone.generation !== authority.generation
    )
      throw new Error('Storage survivor cleanup authority does not match');
    authorityScopes.set(authority.subjectId, {
      subjectId: authority.subjectId,
      generation: authority.generation,
    });
  }
  if (!authorityScopes.size) throw new Error('Storage survivor cleanup authority is missing');
  const relocations = new StorageRelocationRegistry(executor, 'postgres', SIDEDOOR_STATE_ID);
  for (const receipt of graph.receipts) {
    const copy = byOperation.get(receipt.operationId);
    if (
      !copy ||
      receipt.schemaVersion !== 2 ||
      copy.sourceAssetId !== receipt.sourceAssetId ||
      copy.destinationAssetId !== receipt.destinationAssetId ||
      !isDeepStrictEqual(copy.content, receipt.content)
    )
      throw new Error('Storage survivor copy evidence changed');
    const copySubjects = new Map(copy.deletionSubjects.map((item) => [item.subjectId, item]));
    if (
      copySubjects.size !== copy.deletionSubjects.length ||
      copySubjects.size !== authorityScopes.size ||
      [...authorityScopes].some(([id, item]) => !isDeepStrictEqual(copySubjects.get(id), item)) ||
      !isDeepStrictEqual(authorityScopes.get(copy.deletionScope.subjectId), copy.deletionScope)
    )
      throw new Error('Storage survivor cleanup scopes changed');
    const originalConsumers = copy.claims.map((claim) => claim.consumer);
    const survivingConsumers = [...copy.survivingConsumers].sort();
    if (
      new Set(originalConsumers).size !== originalConsumers.length ||
      !isDeepStrictEqual(survivingConsumers, receipt.consumers) ||
      copy.deletedConsumers.size + copy.survivingConsumers.size !== originalConsumers.length ||
      originalConsumers.some(
        (consumer) => copy.deletedConsumers.has(consumer) === copy.survivingConsumers.has(consumer)
      )
    )
      throw new Error('Storage survivor copy consumers changed');
    const parent = await sottoJobOutbox(database).read(copy.jobId);
    if (
      !parent ||
      !parent.complete ||
      parent.fingerprint !== copy.fingerprint ||
      parent.job.id !== copy.jobId ||
      parent.job.namespace !== SIDEDOOR_STATE_ID ||
      parent.job.handler !== 'storage-migration-copy' ||
      parent.job.version !== 1 ||
      !parent.job.scopes.some((item) => isDeepStrictEqual(item, copy.deletionScope))
    )
      throw new Error('Storage survivor original copy is unavailable');
    const payload = storageCopyPayloadSchema.parse(parent.job.payload);
    if (
      payload.sourceAssetId !== copy.sourceAssetId ||
      !isDeepStrictEqual(payload.source, copy.source) ||
      !isDeepStrictEqual(payload.target, copy.target) ||
      !isDeepStrictEqual(payload.claims, copy.claims)
    )
      throw new Error('Storage survivor original copy payload changed');
    if (
      !(await hasSettledSottoExecution(database, { id: copy.jobId, fingerprint: copy.fingerprint }))
    )
      throw new Error('Storage survivor original copy is not settled');
    await sottoJobExecutions(database).requireParentDrained(copy.jobId, copy.fingerprint);
    const snapshot = await sottoJobSnapshot(database).read(copy.jobId, copy.fingerprint, 0);
    if (snapshot.pages !== 1 || snapshot.next !== null || snapshot.items.length !== 1)
      throw new Error('Storage survivor original copy outcome is incomplete');
    const outcome = storageCopyOutcomeSchema.parse(snapshot.items[0]);
    if (
      outcome.assetId !== copy.destinationAssetId ||
      outcome.copyOperationId !== receipt.operationId ||
      outcome.reference !== copy.destination.reference ||
      !isDeepStrictEqual(outcome.content, copy.content)
    )
      throw new Error('Storage survivor original copy outcome changed');
    await relocations.verifyExisting({
      operationId: receipt.operationId,
      sourceAssetId: receipt.sourceAssetId,
      destinationAssetId: receipt.destinationAssetId,
      consumers: receipt.consumers,
      sourceRead: { assetId: receipt.sourceAssetId, ...receipt.content },
      destinationRead: { assetId: receipt.destinationAssetId, ...receipt.content },
    });
    const claims = [];
    for (const consumer of receipt.consumers) {
      const claim = copy.claims.find((candidate) => candidate.consumer === consumer);
      if (
        !claim ||
        !copy.survivingConsumers.has(consumer) ||
        copy.deletedConsumers.has(consumer) ||
        claim.requiredAssociations !== null ||
        !consumer.startsWith('profile:') ||
        !consumer.endsWith(':avatar')
      )
        throw new Error('Storage survivor copy ownership is not verified');
      const subjectId = consumer.slice(0, -':avatar'.length);
      const profile = await database.user.findUnique({
        where: { id: subjectId.slice('profile:'.length) },
        select: { createdAt: true, image: true },
      });
      const paths = coverage.filter(
        (entry) =>
          entry.path.consumer === consumer && entry.assetIds.includes(receipt.sourceAssetId)
      );
      const terminal =
        paths.length === 1 && paths[0]!.path.terminal.kind === 'live'
          ? graph.assets.find((asset) => asset.id === paths[0]!.path.terminal.assetId)
          : null;
      const expectedScopes = [
        { subjectId: instance.subjectId, generation: instance.generation },
        { subjectId, generation: profile?.createdAt.getTime() },
      ];
      if (
        !profile ||
        !terminal ||
        profile.image !== terminal.prepared.reference ||
        !isDeepStrictEqual(claim.requiredScopes, expectedScopes) ||
        claim.requiredScopes.some((item) =>
          copy.deletionSubjects.some((deleted) => deleted.subjectId === item.subjectId)
        )
      )
        throw new Error('Storage survivor copy scopes changed');
      claims.push({ consumer, requiredScopes: claim.requiredScopes, requiredAssociations: null });
    }
    const proof = proofSchema.parse({
      schemaVersion: 1,
      kind: 'sotto_survivor_copy_proof',
      namespace: SIDEDOOR_STATE_ID,
      operationId: receipt.operationId,
      jobId: copy.jobId,
      fingerprint: copy.fingerprint,
      receiptDigest: receiptDigest(receipt),
      claims,
    });
    if (
      !(await backend(database, receipt.operationId).compareAndSwap(null, {
        revision: randomUUID(),
        state: proof,
      }))
    )
      throw new Error('Storage survivor copy proof already exists');
  }
}

/** Read matching historical proof. Current ownership and erasure authority require separate checks. */
export async function readSurvivorCopyProof(database: Prisma.TransactionClient, receipt: Receipt) {
  const row = await backend(database, receipt.operationId).read();
  if (!row) throw new Error('Storage survivor copy proof is missing');
  const proof = proofSchema.parse(row.state);
  if (
    proof.operationId !== receipt.operationId ||
    proof.receiptDigest !== receiptDigest(receipt) ||
    !isDeepStrictEqual(
      proof.claims.map((claim) => claim.consumer),
      receipt.consumers
    )
  )
    throw new Error('Storage survivor copy proof does not match relocation');
  const parent = await sottoJobOutbox(database).receipt(proof.jobId);
  if (
    !parent ||
    parent.status !== 'erased' ||
    parent.id !== proof.jobId ||
    parent.handler !== 'storage-migration-copy' ||
    parent.version !== 1 ||
    parent.fingerprint !== proof.fingerprint
  )
    throw new Error('Storage survivor original copy erasure is not verified');
  await sottoJobExecutions(database).requireParentDrained(proof.jobId, proof.fingerprint);
  return proof;
}

/** Erase retired projected receipts and their proofs in one caller-owned transaction. */
export async function eraseRetainedAvatarHistory(
  database: Prisma.TransactionClient,
  graph: StorageSurvivorGraph,
  authorities: readonly { subjectId: string; generation: number; jobId: string; epoch: number }[]
) {
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  const cleanup = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
  const writes = new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
  const relocations = new StorageRelocationRegistry(executor, 'postgres', SIDEDOOR_STATE_ID);
  const authorized = new Map<string, number>();
  for (const authority of authorities) {
    if (authorized.has(authority.subjectId))
      throw new Error('Storage survivor cleanup authority is duplicated');
    const job = await cleanup.get(authority.jobId);
    const tombstone = await writes.tombstone(authority.subjectId);
    if (
      job.subjectId !== authority.subjectId ||
      job.generation !== authority.generation ||
      job.epoch !== authority.epoch ||
      job.phase !== 'preparing' ||
      job.retentionPolicy !== 'job-id-snapshots-v1' ||
      tombstone?.jobId !== job.id ||
      tombstone.generation !== authority.generation
    )
      throw new Error('Storage survivor cleanup authority does not match');
    authorized.set(authority.subjectId, authority.generation);
  }
  if (!authorized.size) throw new Error('Storage survivor cleanup authority is missing');
  const captured = buildStorageSurvivorGraph(
    await captureRelocationComponent(database, {
      seedAssetIds: graph.assets.map((asset) => asset.id),
    })
  );
  if (
    !isDeepStrictEqual(captured, graph) ||
    !graph.receipts.length ||
    graph.paths.some((path) => path.terminal.kind !== 'retired')
  )
    throw new Error('Storage survivor relocation is not fully retired');
  await verifySurvivorCopyProofInventory(database, 100_000);
  await requireAccountedRelocationReferences(database, graph, new Map());
  const instance = await sottoStorageInstance(database).read();
  for (const asset of graph.assets)
    for (const item of asset.prepared.scopes)
      if (
        !(item.subjectId === instance.subjectId && item.generation === instance.generation) &&
        authorized.get(item.subjectId) !== item.generation
      )
        throw new Error('Storage survivor asset has another owner');
  const savedProofs = [];
  const expected = new Map(graph.receipts.map((receipt) => [receipt.operationId, receipt]));
  for (const receipt of graph.receipts) {
    const saved = await backend(database, receipt.operationId).read();
    if (!saved) throw new Error('Storage survivor copy proof is missing');
    const proof = await readSurvivorCopyProof(database, receipt);
    for (const claim of proof.claims) {
      if (!claim.consumer.startsWith('profile:') || !claim.consumer.endsWith(':avatar'))
        throw new Error('Storage survivor proof owner is unsupported');
      const subjectId = claim.consumer.slice(0, -':avatar'.length);
      if (
        !claim.requiredScopes.some(
          (item) => item.subjectId === subjectId && authorized.get(subjectId) === item.generation
        )
      )
        throw new Error('Storage survivor proof has another owner');
      if (
        await database.user.findUnique({
          where: { id: subjectId.slice('profile:'.length) },
          select: { id: true },
        })
      )
        throw new Error('Storage survivor profile has not been deleted');
    }
    savedProofs.push({ operationId: receipt.operationId, revision: saved.revision });
  }
  const indexed = new Set<string>();
  for (const authority of authorities) {
    let cursor: string | null = null;
    do {
      const page = await relocations.listForSubject(authority.subjectId, cursor);
      for (const receipt of page.receipts) {
        if (
          !receipt.scopes.some(
            (item) =>
              item.subjectId === authority.subjectId && item.generation === authority.generation
          ) ||
          !isDeepStrictEqual(expected.get(receipt.operationId), receipt)
        )
          throw new Error('Storage survivor cleanup has unrelated relocation history');
        indexed.add(receipt.operationId);
      }
      if (cursor && page.cursor && page.cursor <= cursor)
        throw new Error('Storage relocation cursor did not advance');
      cursor = page.cursor;
    } while (cursor !== null);
  }
  if (indexed.size !== expected.size)
    throw new Error('Storage survivor cleanup scope inventory is incomplete');
  let erased = 0;
  for (const authority of authorities) {
    let cursor: string | null = null;
    do {
      const page = await relocations.eraseForSubject({
        ...authority,
        after: cursor,
        verifyProjectedErasure: async (candidate) => {
          const receipt = expected.get(candidate.operationId);
          return (
            !!receipt &&
            receipt.sourceAssetId === candidate.sourceAssetId &&
            receipt.destinationAssetId === candidate.destinationAssetId &&
            isDeepStrictEqual(receipt.consumers, candidate.consumers) &&
            isDeepStrictEqual(receipt.scopes, candidate.scopes)
          );
        },
      });
      erased += page.erased;
      if (cursor && page.cursor && page.cursor <= cursor)
        throw new Error('Storage relocation cursor did not advance');
      cursor = page.cursor;
    } while (cursor !== null);
  }
  if (erased !== expected.size)
    throw new Error('Storage survivor relocation erasure is incomplete');
  for (const saved of savedProofs) {
    const rows = await executor.query(
      'DELETE FROM "SidedoorState" WHERE "id" = $1 AND "revision" = $2 RETURNING "id"',
      [`${proofPrefix()}${saved.operationId}`, saved.revision]
    );
    if (rows.length !== 1) throw new Error('Storage survivor proof changed concurrently');
  }
  await verifySurvivorCopyProofInventory(database, 100_000);
}

/** Complete deferred profile history after its row has been deleted in this transaction. */
export async function finalizeRetainedProfileHistory(
  database: Prisma.TransactionClient,
  assetId: string,
  authority: { subjectId: string; generation: number; jobId: string; epoch: number }
) {
  const graph = buildStorageSurvivorGraph(
    await captureRelocationComponent(database, { seedAssetIds: [assetId] })
  );
  await eraseRetainedAvatarHistory(database, graph, [authority]);
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  const cleanup = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
  const attribution = new StorageCleanupAttribution(executor, 'postgres', SIDEDOOR_STATE_ID);
  let cursor: string | null = null;
  do {
    const page = await cleanup.listManifests(authority.jobId, cursor);
    for (const manifest of page.pages) {
      if (manifest.resolution) continue;
      const inspected = await attribution.inspectPage({ ...authority, pageId: manifest.id });
      if (inspected.entries.some((entry) => entry.status !== 'attributed'))
        throw new Error('Storage survivor relocation attribution is unresolved');
      await cleanup.resolveManifest(authority.jobId, authority.epoch, manifest.id, {
        resolver: 'sotto-learning-deletion-v1',
        entries: inspected.entries.map((entry) => {
          if (entry.status !== 'attributed')
            throw new Error('Storage survivor attribution changed');
          return { index: entry.index, kind: 'storage' as const, targets: [entry.target] };
        }),
      });
    }
    cursor = page.cursor;
  } while (cursor !== null);
}

/** Compare every retained proof with the complete v2 receipt inventory. */
export async function verifySurvivorCopyProofInventory(
  database: Prisma.TransactionClient,
  maxEntries: number
) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1)
    throw new Error('Storage survivor proof inventory limit is invalid');
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  const relocations = new StorageRelocationRegistry(executor, 'postgres', SIDEDOOR_STATE_ID);
  const receipts = new Map<string, Receipt>();
  let cursor: string | null = null;
  let inspected = 0;
  do {
    const page = await relocations.listAll(cursor);
    for (const receipt of page.receipts) {
      if (++inspected > maxEntries)
        throw new Error('Storage survivor proof inventory exceeds its limit');
      if (receipt.schemaVersion !== 2) continue;
      if (receipts.has(receipt.operationId))
        throw new Error('Storage survivor relocation is duplicated');
      receipts.set(receipt.operationId, receipt);
      if (receipts.size > maxEntries)
        throw new Error('Storage survivor proof inventory exceeds its limit');
    }
    if (cursor && page.cursor && page.cursor <= cursor)
      throw new Error('Storage relocation cursor did not advance');
    cursor = page.cursor;
  } while (cursor !== null);
  const prefix = proofPrefix();
  cursor = null;
  let count = 0;
  do {
    const rows = await sqlStateRows(executor, 'postgres', prefix, cursor, 100, 'uuid');
    for (const row of rows) {
      if (typeof row.id !== 'string' || typeof row.revision !== 'string')
        throw new Error('Storage survivor proof identity is invalid');
      const proof = proofSchema.parse(row.state);
      if (row.id !== `${prefix}${proof.operationId}`)
        throw new Error('Storage survivor proof identity changed');
      if (++count > maxEntries)
        throw new Error('Storage survivor proof inventory exceeds its limit');
      const receipt = receipts.get(proof.operationId);
      if (!receipt) throw new Error('Storage survivor proof has no matching relocation');
      await readSurvivorCopyProof(database, receipt);
      receipts.delete(proof.operationId);
    }
    const next = rows.length === 100 ? String(rows.at(-1)!.id) : null;
    if (cursor && next && next <= cursor)
      throw new Error('Storage survivor proof cursor did not advance');
    cursor = next;
  } while (cursor !== null);
  if (receipts.size) throw new Error('Storage projected relocation has no survivor copy proof');
}
