import { StorageCleanupJournal, StorageWriteJournal } from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

/** Validate parent identity before propagating cancellation to its dependent job. */
export async function readJobParent(
  database: Prisma.TransactionClient,
  work: Parameters<typeof completeErasedJob>[1],
  parent: { id: string; fingerprint: string; handler: string; version: number }
) {
  const result = await sottoJobOutbox(database).readParent(parent.id, {
    fingerprint: parent.fingerprint,
    handler: parent.handler,
    version: parent.version,
    scopes: work.scopes,
  });
  if (result.status === 'erased') {
    if (!(await completeErasedJob(database, work)))
      throw new Error('Erased parent has no matching dependency deletion proof');
    return null;
  }
  if (result.status !== 'complete') throw new Error('Parent operation is not complete');
  return result.record;
}

/** Call after validating the immutable job, parent and captured scopes. */
export async function completeErasedJob(
  database: Prisma.TransactionClient,
  work: {
    operationId: string;
    fingerprint: string;
    scopes: readonly { subjectId: string; generation: number }[];
  }
): Promise<boolean> {
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  const writes = new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
  const cleanup = new StorageCleanupJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
  for (const scope of work.scopes) {
    const tombstone = await writes.tombstone(scope.subjectId);
    if (!tombstone) continue;
    if (tombstone.generation !== scope.generation)
      throw new Error('Job erasure generation does not match its captured scope');
    const deletion = await cleanup.get(tombstone.jobId);
    if (
      deletion.namespace !== SIDEDOOR_STATE_ID ||
      deletion.subjectId !== scope.subjectId ||
      deletion.generation !== scope.generation
    )
      throw new Error('Job erasure does not match its cleanup operation');
    const outbox = sottoJobOutbox(database);
    const receipt = await outbox.receipt(work.operationId);
    if (!receipt || receipt.fingerprint !== work.fingerprint)
      throw new Error('Job erasure completion identity mismatch');
    if (receipt.status !== 'erased') await outbox.complete(work.operationId, work.fingerprint);
    return true;
  }
  return false;
}
