import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { isDeepStrictEqual } from 'node:util';
import { AccessError } from 'thesidedoor-core/access';
import { abortable } from 'thesidedoor-core/runtime/stream';
import {
  acquirePostgresBackendLock,
  prepareStorageBackend,
  runStorageProbe,
  type ReferenceSetAdmission,
} from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { CapturedStorageBackend } from '@/lib/r2';
import { openSottoStorageConnection } from '@/lib/sidedoor/storage/core/storage-connection';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

const executorId = randomUUID();

/** The caller retains this captured backend for subsequent writes. */
export async function runSottoStorageProbe<Snapshot>(options: {
  database: PrismaClient;
  signal: AbortSignal;
  backend: CapturedStorageBackend;
  readAdmission(database: Prisma.TransactionClient): Promise<ReferenceSetAdmission<Snapshot>>;
  validateConfiguration(): Promise<void>;
}) {
  const { database, signal: callerSignal, readAdmission, validateConfiguration } = options;
  const source = options.backend;
  const backend = {
    descriptor: structuredClone(source.descriptor),
    writeStream: source.writeStream.bind(source),
    writeBuffer: source.writeBuffer.bind(source),
    has: source.has.bind(source),
    delete: source.delete.bind(source),
  };
  const binding = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor).binding;
  const lock = await acquirePostgresBackendLock({
    namespace: SIDEDOOR_STATE_ID,
    binding,
    signal: callerSignal,
    openConnection: () => openSottoStorageConnection(),
  });
  const signal = AbortSignal.any([callerSignal, lock.signal]);
  async function operation<Result>(
    run: (signal: AbortSignal) => Promise<Result>,
    caller?: AbortSignal
  ) {
    const active = AbortSignal.any([
      lock.signal,
      AbortSignal.timeout(30_000),
      ...(caller ? [caller] : []),
    ]);
    active.throwIfAborted();
    return abortable(run(active), active);
  }
  async function validate(tx: Prisma.TransactionClient, captured: ReferenceSetAdmission<Snapshot>) {
    if (!isDeepStrictEqual(await readAdmission(tx), captured))
      throw new AccessError('conflict', 'Storage ownership changed during the check');
  }
  let captured: ReferenceSetAdmission<Snapshot> | undefined;
  let failed = false;
  let primary: unknown;
  try {
    await runStorageProbe({
      namespace: SIDEDOOR_STATE_ID,
      dialect: 'postgres',
      executorId,
      signal,
      transaction: (run) => sottoTransaction(database, run),
      executor: (tx: Prisma.TransactionClient) => ({
        query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      }),
      captureAdmission: async (tx) => {
        captured = structuredClone(await readAdmission(tx));
        return captured;
      },
      validateAdmission: validate,
      capturePort: async () => ({
        descriptor: backend.descriptor,
        write: (key, body, contentType, caller) =>
          operation(
            (active) =>
              body instanceof Readable
                ? backend.writeStream(key, body, contentType, active)
                : backend.writeBuffer(key, body, contentType, active),
            caller
          ),
        has: (key) => operation((active) => backend.has(key, active)),
        delete: (key) => operation((active) => backend.delete(key, { signal: active })),
      }),
    });
    await validateConfiguration();
  } catch (error) {
    failed = true;
    primary = error;
    throw error;
  } finally {
    try {
      await lock.release();
    } catch (error) {
      if (failed)
        throw new AggregateError([primary, error], 'Storage check and lock release failed', {
          cause: error,
        });
      throw error;
    }
  }
  callerSignal.throwIfAborted();
  await validateConfiguration();
  callerSignal.throwIfAborted();
  if (!captured) throw new AccessError('conflict', 'Storage probe admission is missing');
  const admission = captured;
  await sottoTransaction(database, (tx) => validate(tx, admission));
  callerSignal.throwIfAborted();
}
