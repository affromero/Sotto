import { Readable } from 'node:stream';
import { AccessError } from 'thesidedoor-core/access';
import {
  writeReferenceSet,
  isReferenceSetError,
  type ReferenceSetWriter,
} from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import {
  captureConfiguredStorageBackend,
  captureStorageBackend,
  LOCAL_STORAGE_URL_PREFIX,
  type CapturedStorageBackend,
} from '@/lib/r2';
import type { ServerInfraConfig } from '@/lib/site-config';
import { requireOriginalSottoAdmission as requireOriginalAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

function executor(database: Prisma.TransactionClient) {
  return {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
}

export async function captureSottoStorageWriter(
  configuration?: ServerInfraConfig
): Promise<ReferenceSetWriter> {
  const backend = configuration
    ? await captureConfiguredStorageBackend(configuration)
    : await captureStorageBackend();
  return storageWriterForBackend(backend);
}

export function storageWriterForBackend(backend: CapturedStorageBackend): ReferenceSetWriter {
  const writeStream = backend.writeStream.bind(backend);
  const writeBuffer = backend.writeBuffer.bind(backend);
  return {
    descriptor: structuredClone(backend.descriptor),
    ...(backend.descriptor.kind === 'local' ? { localRoutePrefix: LOCAL_STORAGE_URL_PREFIX } : {}),
    write: (key, body, contentType, signal) =>
      body instanceof Readable
        ? writeStream(key, body, contentType, signal)
        : writeBuffer(key, body, contentType, signal),
  };
}

async function profileScope(database: Prisma.TransactionClient, userId: string) {
  const instance = await sottoStorageInstance(database).read();
  const user = await database.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  });
  if (!user) throw new AccessError('unauthorized');
  return {
    instanceId: instance.instanceId,
    scopes: [
      { subjectId: instance.subjectId, generation: instance.generation },
      { subjectId: `profile:${userId}`, generation: user.createdAt.getTime() },
    ],
  };
}

/**
 * Profile-owned files only. Course, episode and job artifacts require their additional scopes.
 * inspect and commit perform database work exclusively through the supplied transaction.
 * Every retry uses the same operation key; no retry may restart external I/O.
 */
export async function writeProfileStorageReference<Snapshot>(options: {
  database: PrismaClient;
  request: Request;
  admission: AuthenticatedRequest;
  prefix: string;
  extension: string;
  body: Uint8Array | Readable;
  contentType: string;
  referenceSlot: string;
  inspect(database: Prisma.TransactionClient): Promise<Snapshot>;
  previousReference(snapshot: Snapshot): string | null;
  commit(database: Prisma.TransactionClient, url: string, snapshot: Snapshot): Promise<void>;
}): Promise<string> {
  const { request, admission } = options;
  if (!/^[a-z][a-z0-9_-]{0,49}$/.test(options.referenceSlot)) {
    if (options.body instanceof Readable) options.body.destroy();
    throw new AccessError('invalid');
  }
  return writeStorageReference({
    ...options,
    signal: request.signal,
    captureAdmission: async (tx) => {
      await requireOriginalAdmission(tx, request, admission);
      return {
        ...(await profileScope(tx, admission.userId)),
        consumer: `profile:${admission.userId}:${options.referenceSlot}`,
        snapshot: await options.inspect(tx),
      };
    },
    validateAdmission: async (tx, captured, committedReference) => {
      await requireOriginalAdmission(tx, request, admission);
      const current = await profileScope(tx, admission.userId);
      if (
        current.instanceId !== captured.instanceId ||
        JSON.stringify(current.scopes) !== JSON.stringify(captured.scopes)
      )
        throw new AccessError('conflict', 'Storage ownership changed during this upload');
      if (
        committedReference &&
        options.previousReference(await options.inspect(tx)) !== committedReference
      )
        throw new AccessError('conflict', 'The uploaded profile reference is no longer current');
    },
  });
}

export interface StorageReferenceAdmission<Snapshot> {
  readonly instanceId: string;
  readonly scopes: ReadonlyArray<{ readonly subjectId: string; readonly generation: number }>;
  readonly consumer: string;
  readonly additionalConsumers?: ReadonlyArray<{
    readonly consumer: string;
    readonly previousReference: string | null;
  }>;
  readonly snapshot: Snapshot;
}

/** Admission callbacks perform transaction-local database work only, including on retries. */
export async function writeStorageReference<Snapshot>(options: {
  database: PrismaClient;
  signal: AbortSignal;
  prefix: string;
  extension: string;
  body: Uint8Array | Readable;
  contentType: string;
  writer?: ReferenceSetWriter;
  captureAdmission(
    database: Prisma.TransactionClient
  ): Promise<StorageReferenceAdmission<Snapshot>>;
  validateAdmission(
    database: Prisma.TransactionClient,
    captured: StorageReferenceAdmission<Snapshot>,
    committedReference?: string
  ): Promise<void>;
  previousReference(snapshot: Snapshot): string | null;
  commit(database: Prisma.TransactionClient, url: string, snapshot: Snapshot): Promise<void>;
}): Promise<string> {
  const writer = options.writer;
  try {
    const published = await writeReferenceSet({
      namespace: SIDEDOOR_STATE_ID,
      dialect: 'postgres',
      signal: options.signal,
      executor,
      transaction: (operation) => sottoTransaction(options.database, operation),
      artifacts: [
        {
          name: 'asset',
          prefix: options.prefix,
          extension: options.extension,
          contentType: options.contentType,
          body: options.body,
          consumers: (admission: StorageReferenceAdmission<Snapshot>) => [
            {
              consumer: admission.consumer,
              previousReference: options.previousReference(structuredClone(admission.snapshot)),
            },
            ...(admission.additionalConsumers ?? []),
          ],
          captureWriter: writer ? async () => writer : captureSottoStorageWriter,
        },
      ],
      captureAdmission: async (tx) => {
        const admission = await options.captureAdmission(tx);
        return { instanceId: admission.instanceId, scopes: admission.scopes, snapshot: admission };
      },
      validateAdmission: (tx, admission, committed) =>
        options.validateAdmission(tx, admission.snapshot, committed?.asset),
      commit: (tx, urls, admission) => options.commit(tx, urls.asset!, admission.snapshot),
    });
    return published.asset!;
  } catch (error) {
    if (isReferenceSetError(error)) throw new AccessError(error.code, error.message);
    throw error;
  }
}
