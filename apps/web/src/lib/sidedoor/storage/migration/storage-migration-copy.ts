import { createReadStream } from 'node:fs';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AccessError } from 'thesidedoor-core/access';
import { prepareJob, type OutboxJob } from 'thesidedoor-core/runtime/outbox';
import {
  StorageReferenceRegistry,
  StorageRelocationRegistry,
  StorageWriteJournal,
  prepareStorageBackend,
  prepareStorageReference,
  storageCleanupDescriptorSchema,
  writeReferenceSet,
  type PreparedStorageReference,
  type StorageCopyContent,
} from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import {
  contentTypeForKey,
  LOCAL_STORAGE_URL_PREFIX,
  restoreStorageBackend,
  type CapturedStorageBackend,
} from '@/lib/r2';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { withSottoJobExecution } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  inspectStorageMigrationConsumer,
  type readStorageMigrationAssetPage,
} from '@/lib/sidedoor/storage/migration/storage-migration-plan';
import {
  readStorageConsumerReference,
  replaceStorageConsumerReference,
} from '@/lib/sidedoor/storage/core/storage-consumers';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

const identity = z.string().min(1).max(200);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const scope = z
  .object({ subjectId: identity, generation: z.number().int().nonnegative().safe() })
  .strict();
const reference = z
  .unknown()
  .transform((value) => prepareStorageReference(value as PreparedStorageReference));
const payloadSchema = z
  .object({
    mode: z.literal('relocation'),
    requesterId: identity,
    instanceId: z.uuid(),
    sourceAssetId: digest,
    source: reference,
    target: storageCleanupDescriptorSchema,
    timeoutMs: z.number().int().positive().max(2_147_483_647),
    claims: z
      .array(
        z
          .object({
            consumer: identity,
            previousReference: z.string().min(1),
            requiredScopes: z.array(scope).min(1),
            requiredAssociations: z.json(),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict();
const outcomeSchema = z
  .object({
    reference: z.string().min(1),
    assetId: digest,
    copyOperationId: z.uuid(),
    content: z.object({ sha256: digest, bytes: z.number().int().nonnegative().safe() }).strict(),
  })
  .strict();
type Payload = z.infer<typeof payloadSchema>;
type Entry = Awaited<ReturnType<typeof readStorageMigrationAssetPage>>['entries'][number];
const executor = (database: Prisma.TransactionClient) => ({
  query: (sql: string, values: readonly unknown[]) =>
    database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
});
const references = (database: Prisma.TransactionClient) =>
  new StorageReferenceRegistry(executor(database), 'postgres', SIDEDOOR_STATE_ID);
const relocations = (database: Prisma.TransactionClient) =>
  new StorageRelocationRegistry(executor(database), 'postgres', SIDEDOOR_STATE_ID);

async function validateSource(database: Prisma.TransactionClient, payload: Payload) {
  const instance = await sottoStorageInstance(database).read();
  const source = await references(database).readAsset(payload.sourceAssetId);
  if (
    instance.instanceId !== payload.instanceId ||
    !source ||
    !isDeepStrictEqual(source.asset.prepared, payload.source) ||
    !isDeepStrictEqual(
      [...source.asset.consumers].sort(),
      payload.claims.map((claim) => claim.consumer).sort()
    )
  )
    throw new Error('Storage copy source or consumer set changed');
  for (const claim of payload.claims) {
    const current = await inspectStorageMigrationConsumer(database, claim.consumer, payload.source);
    if (
      claim.previousReference !== payload.source.reference ||
      current.reason ||
      !isDeepStrictEqual(current.requiredScopes, claim.requiredScopes) ||
      !isDeepStrictEqual(current.requiredAssociations, claim.requiredAssociations)
    )
      throw new Error('Storage copy consumer ownership changed');
  }
  return source;
}

/** Admit one asset only, in the caller's Serializable transaction after capturing its target backend. */
export async function admitSottoStorageCopy(
  database: Prisma.TransactionClient,
  options: {
    request: Request;
    admission: AuthenticatedRequest;
    operationId: string;
    entry: Entry;
    target: CapturedStorageBackend['descriptor'];
    timeoutMs: number;
  }
) {
  const admission = structuredClone(options.admission);
  const { request, operationId, timeoutMs } = options;
  const entry = structuredClone(options.entry);
  const target = storageCleanupDescriptorSchema.parse(options.target);
  if (!admission.isOwner) throw new AccessError('forbidden');
  await requireOriginalSottoAdmission(database, request, admission);
  const instance = await sottoStorageInstance(database).read();
  const payload = payloadSchema.parse({
    mode: 'relocation',
    requesterId: admission.userId,
    instanceId: instance.instanceId,
    sourceAssetId: entry.assetId,
    source: entry.source.prepared,
    claims: entry.claims,
    target,
    timeoutMs,
  });
  await validateSource(database, payload);
  const owner = await database.user.findUniqueOrThrow({
    where: { id: admission.userId },
    select: { createdAt: true },
  });
  const scopes = [...payload.source.scopes];
  const ownerScope = {
    subjectId: `profile:${admission.userId}`,
    generation: owner.createdAt.getTime(),
  };
  const saved = scopes.find((item) => item.subjectId === ownerScope.subjectId);
  if (saved && !isDeepStrictEqual(saved, ownerScope))
    throw new Error('Storage copy requester generation changed');
  if (!saved) scopes.push(ownerScope);
  const prepared = prepareJob({
    id: operationId,
    namespace: SIDEDOOR_STATE_ID,
    handler: 'storage-migration-copy',
    version: 1,
    payload: z.json().parse(payload),
    scopes,
    delivery: { attempts: 1, priority: 0, availableAt: 0 },
  });
  request.signal.throwIfAborted();
  return sottoJobOutbox(database).enqueue(prepared);
}

async function completedCopy(
  database: Prisma.TransactionClient,
  parent: OutboxJob,
  payload: Payload,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  if (!parent.complete) throw new Error('Storage copy is not complete');
  const page = await sottoJobSnapshot(database).read(parent.job.id, parent.fingerprint, 0);
  if (page.pages !== 1 || page.next !== null || page.items.length !== 1)
    throw new Error('Storage copy outcome is incomplete');
  const outcome = outcomeSchema.parse(page.items[0]);
  const asset = await references(database).readAsset(outcome.assetId);
  if (
    !asset ||
    asset.asset.prepared.operationId !== outcome.copyOperationId ||
    asset.asset.prepared.reference !== outcome.reference ||
    !isDeepStrictEqual(asset.backend.descriptor, payload.target)
  )
    throw new Error('Storage copy outcome attribution changed');
  for (const claim of payload.claims) {
    const currentReference = await readStorageConsumerReference(database, claim.consumer);
    if (!currentReference) throw new Error('Storage copy consumer disappeared');
    const proof = await relocations(database).resolve({
      consumer: claim.consumer,
      originalReference: payload.source.reference,
      currentReference,
      maxHops: 1000,
      signal,
      requiredOperation: {
        operationId: outcome.copyOperationId,
        sourceAssetId: payload.sourceAssetId,
        destinationAssetId: outcome.assetId,
      },
    });
    if (!proof || !isDeepStrictEqual(proof.content, outcome.content))
      throw new Error('Storage copy publication cannot be verified');
    const current = await inspectStorageMigrationConsumer(
      database,
      claim.consumer,
      proof.current.prepared
    );
    if (
      current.reason ||
      !isDeepStrictEqual(current.requiredScopes, claim.requiredScopes) ||
      !isDeepStrictEqual(current.requiredAssociations, claim.requiredAssociations)
    )
      throw new Error('Storage copy consumer ownership changed');
  }
  signal.throwIfAborted();
  return outcome;
}

/** Execute an admitted one-asset copy. Configuration activation belongs to the migration coordinator. */
export async function executeSottoStorageCopy(options: {
  database: PrismaClient;
  request: Request;
  admission: AuthenticatedRequest;
  operationId: string;
  fingerprint: string;
  target: CapturedStorageBackend;
}) {
  const { database, request, operationId, fingerprint } = options;
  const admission = structuredClone(options.admission);
  const target = {
    descriptor: storageCleanupDescriptorSchema.parse(options.target.descriptor),
    writeStream: options.target.writeStream.bind(options.target),
    downloadToFile: options.target.downloadToFile.bind(options.target),
  };
  async function inspect(tx: Prisma.TransactionClient) {
    if (!admission.isOwner) throw new AccessError('forbidden');
    await requireOriginalSottoAdmission(tx, request, admission);
    const parent = await sottoJobOutbox(tx).read(operationId);
    if (
      !parent ||
      parent.fingerprint !== fingerprint ||
      parent.job.handler !== 'storage-migration-copy' ||
      parent.job.version !== 1
    )
      throw new Error('Storage copy parent does not match');
    const payload = payloadSchema.parse(parent.job.payload);
    if (
      payload.requesterId !== admission.userId ||
      !isDeepStrictEqual(payload.target, target.descriptor)
    )
      throw new Error('Storage copy destination or requester changed');
    const owner = await tx.user.findUniqueOrThrow({
      where: { id: admission.userId },
      select: { createdAt: true },
    });
    const scopes = [...payload.source.scopes];
    const ownerScope = {
      subjectId: `profile:${admission.userId}`,
      generation: owner.createdAt.getTime(),
    };
    const saved = scopes.find((item) => item.subjectId === ownerScope.subjectId);
    if (saved && !isDeepStrictEqual(saved, ownerScope))
      throw new Error('Storage copy requester generation changed');
    if (!saved) scopes.push(ownerScope);
    const sortScopes = (values: typeof scopes) =>
      [...values].sort((a, b) => a.subjectId.localeCompare(b.subjectId));
    if (!isDeepStrictEqual(sortScopes(parent.job.scopes), sortScopes(scopes)))
      throw new Error('Storage copy parent scopes changed');
    const writes = new StorageWriteJournal(executor(tx), 'postgres', SIDEDOOR_STATE_ID);
    for (const scope of scopes)
      if (await writes.tombstone(scope.subjectId))
        throw new Error('Storage copy ownership was erased');
    return { parent, payload };
  }
  const initial = await sottoTransaction(database, inspect, { signal: request.signal });
  if (initial.parent.complete)
    return sottoTransaction(
      database,
      async (tx) => {
        const current = await inspect(tx);
        return completedCopy(tx, current.parent, current.payload, request.signal);
      },
      { signal: request.signal }
    );
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(initial.payload.timeoutMs)]);
  const pending = async (tx: Prisma.TransactionClient) => {
    const current = await inspect(tx);
    if (current.parent.complete || !isDeepStrictEqual(current.payload, initial.payload))
      throw new Error('Storage copy work changed');
    await validateSource(tx, current.payload);
    signal.throwIfAborted();
    return current;
  };
  await withSottoJobExecution({
    database,
    parentId: operationId,
    fingerprint,
    signal,
    isCleanupFailure: () => false,
    validate: async (tx) => {
      await pending(tx);
      return true;
    },
    run: async ({ directory }) => {
      const source = await sottoTransaction(
        database,
        async (tx) => {
          await pending(tx);
          return references(tx).readAsset(initial.payload.sourceAssetId);
        },
        { signal }
      );
      if (!source) throw new Error('Storage copy source disappeared');
      const reader = await restoreStorageBackend(source.backend.descriptor);
      await sottoTransaction(database, pending, { signal });
      const sourceFile = join(directory, 'source');
      const sourceRead = await reader.downloadToFile(
        initial.payload.source.reference,
        sourceFile,
        signal
      );
      let verified:
        { operationId: string; reference: string; content: StorageCopyContent } | undefined;
      const extension = extname(initial.payload.source.target.key).slice(1).toLowerCase() || 'bin';
      await writeReferenceSet({
        namespace: SIDEDOOR_STATE_ID,
        dialect: 'postgres',
        signal,
        executor,
        transaction: (run) => sottoTransaction(database, run),
        captureAdmission: async (tx) => {
          await pending(tx);
          return {
            instanceId: initial.payload.instanceId,
            scopes: initial.payload.source.scopes,
            snapshot: initial.payload,
          };
        },
        validateAdmission: async (tx, captured, published) => {
          if (!published) {
            await pending(tx);
            return;
          }
          const current = await inspect(tx);
          const outcome = await completedCopy(tx, current.parent, captured.snapshot, signal);
          if (outcome.reference !== published.asset)
            throw new Error('Storage copy completion reference changed');
        },
        artifacts: [
          {
            name: 'asset',
            prefix: 'storage-migrations',
            extension,
            contentType: contentTypeForKey(initial.payload.source.target.key),
            body: createReadStream(sourceFile),
            consumers: (payload) =>
              payload.claims.map((claim) => ({
                consumer: claim.consumer,
                previousReference: claim.previousReference,
              })),
            captureWriter: async () => ({
              descriptor: target.descriptor,
              ...(target.descriptor.kind === 'local'
                ? { localRoutePrefix: LOCAL_STORAGE_URL_PREFIX }
                : {}),
              write: async (key, body, contentType, active) => {
                if (!(body instanceof Readable))
                  throw new Error('Storage copy requires its owned source stream');
                return target.writeStream(key, body, contentType, active);
              },
            }),
          },
        ],
        verifyArtifact: async (artifact, active) => {
          await sottoTransaction(database, pending, { signal: active });
          if (!isDeepStrictEqual(artifact.descriptor, target.descriptor))
            throw new Error('Storage copy target changed');
          const readback = await target.downloadToFile(
            artifact.reference,
            join(directory, 'readback'),
            active
          );
          if (!isDeepStrictEqual(sourceRead, readback))
            throw new Error('Storage copy readback does not match source bytes');
          verified = {
            operationId: artifact.operationId,
            reference: artifact.reference,
            content: readback,
          };
        },
        commit: async (tx, published, payload) => {
          if (!verified || verified.reference !== published.asset)
            throw new Error('Storage copy has no verified readback');
          for (const claim of payload.claims)
            await replaceStorageConsumerReference(
              tx,
              claim.consumer,
              claim.previousReference,
              verified.reference
            );
          const destination = await references(tx).readReference(verified.reference);
          if (
            !destination ||
            destination.asset.prepared.operationId !== verified.operationId ||
            destination.asset.prepared.target.backendId !==
              prepareStorageBackend(SIDEDOOR_STATE_ID, target.descriptor).id
          )
            throw new Error('Storage copy destination attribution changed');
          await relocations(tx).record({
            operationId: verified.operationId,
            sourceAssetId: payload.sourceAssetId,
            destinationAssetId: destination.asset.id,
            consumers: payload.claims.map((claim) => claim.consumer),
            sourceRead: { assetId: payload.sourceAssetId, ...sourceRead },
            destinationRead: { assetId: destination.asset.id, ...verified.content },
          });
          if (!(await sottoJobOutbox(tx).complete(operationId, fingerprint)))
            throw new Error('Storage copy was already completed');
          const snapshot = sottoJobSnapshot(tx);
          await snapshot.createForJob({ id: operationId, fingerprint });
          await snapshot.append(operationId, fingerprint, 0, [
            {
              reference: verified.reference,
              assetId: destination.asset.id,
              copyOperationId: verified.operationId,
              content: verified.content,
            },
          ]);
          await snapshot.seal(operationId, fingerprint);
        },
      });
    },
  });
  return sottoTransaction(
    database,
    async (tx) => {
      const current = await inspect(tx);
      return completedCopy(tx, current.parent, current.payload, request.signal);
    },
    { signal: request.signal }
  );
}
