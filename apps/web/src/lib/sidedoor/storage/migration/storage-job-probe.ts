import { isDeepStrictEqual } from 'node:util';
import { StorageWriteJournal } from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { captureConfiguredStorageBackend } from '@/lib/r2';
import { getSiteConfig } from '@/lib/site-config';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { runSottoStorageProbe } from '@/lib/sidedoor/storage/core/storage-probe-runtime';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

/** Run inside the parent's execution lifetime, then reuse the returned backend for publication. */
export async function checkSottoJobStorage(options: {
  database: PrismaClient;
  signal: AbortSignal;
  operationId: string;
  fingerprint: string;
  handler: string;
  version: number;
  instanceId: string;
  scopes: ReadonlyArray<{ subjectId: string; generation: number }>;
  validatePending(database: Prisma.TransactionClient): Promise<boolean>;
}) {
  const {
    database,
    signal,
    operationId,
    fingerprint,
    handler,
    version,
    instanceId,
    validatePending,
  } = options;
  const sortScopes = (scopes: typeof options.scopes) =>
    scopes
      .map((scope) => ({ ...scope }))
      .sort((left, right) => left.subjectId.localeCompare(right.subjectId));
  const expectedScopes = sortScopes(options.scopes);
  async function readAdmission(tx: Prisma.TransactionClient) {
    signal.throwIfAborted();
    if (!(await validatePending(tx))) throw new Error('Storage probe parent is no longer pending');
    const parent = await sottoJobOutbox(tx).read(operationId);
    if (
      !parent ||
      parent.complete ||
      parent.fingerprint !== fingerprint ||
      parent.job.handler !== handler ||
      parent.job.version !== version ||
      !isDeepStrictEqual(sortScopes(parent.job.scopes), expectedScopes)
    )
      throw new Error('Storage probe parent identity or scopes changed');
    const instance = await sottoStorageInstance(tx).read();
    if (
      instance.instanceId !== instanceId ||
      !expectedScopes.some(
        (scope) =>
          scope.subjectId === instance.subjectId && scope.generation === instance.generation
      )
    )
      throw new Error('Storage probe instance changed');
    const writes = new StorageWriteJournal(
      {
        query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      SIDEDOOR_STATE_ID
    );
    for (const scope of expectedScopes)
      if (await writes.tombstone(scope.subjectId))
        throw new Error('Storage probe ownership was erased');
    signal.throwIfAborted();
    return {
      instanceId,
      scopes: expectedScopes,
      snapshot: { operationId, fingerprint, handler, version },
    };
  }
  await sottoTransaction(database, readAdmission, { signal });
  const configuration = await getSiteConfig();
  const backend = await captureConfiguredStorageBackend(configuration);
  await runSottoStorageProbe({
    database,
    signal,
    backend,
    readAdmission,
    validateConfiguration: async () => {
      const current = await getSiteConfig();
      if (
        (
          [
            'storageProvider',
            'localStorageRoot',
            'objectStorageEndpoint',
            'objectStorageBucket',
            'objectStorageRegion',
            'objectStoragePublicUrl',
          ] as const
        ).some((key) => current[key] !== configuration[key])
      )
        throw new Error('Storage configuration changed during the check');
    },
  });
  return backend;
}
