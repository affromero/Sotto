import type { Job } from 'bullmq';
import type { Prisma } from '@/generated/prisma/client';
import {
  durableEnvelopeSchema,
  loadDurableQueueJob,
  validateDurableAuthority,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { completeErasedJob } from '@/lib/sidedoor/access/deletion/job-erasure';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { readOwnedUpload } from '../uploads/state';

/** Failure receipts stop redispatch. Uncertain storage and all parts remain available for recovery. */
export async function settleMaterialFinalizationFailure(
  database: Prisma.TransactionClient,
  reference: { operationId: string; fingerprint: string; handler: string; version: number }
) {
  if (reference.handler !== 'material-finalization' || reference.version !== 1)
    throw new Error('Unsupported material failure contract.');
  const outbox = sottoJobOutbox(database);
  const work = await outbox.read(reference.operationId);
  if (
    !work ||
    work.fingerprint !== reference.fingerprint ||
    work.job.handler !== reference.handler ||
    work.job.version !== reference.version
  )
    throw new Error('Material failure receipt identity does not match its admitted work.');
  if (work.complete) return;
  if (
    await completeErasedJob(database, {
      operationId: reference.operationId,
      fingerprint: reference.fingerprint,
      scopes: work.job.scopes,
    })
  )
    return;
  const envelope = durableEnvelopeSchema.parse(work.job.payload);
  const authority = envelope.authority;
  if (authority.kind !== 'material' || !authority.upload)
    throw new Error('Material finalization failure has no captured upload authority.');
  await validateDurableAuthority(database, authority);
  const upload = await readOwnedUpload(database, authority.userId, authority.upload.id, true);
  if (
    upload.finalizationOperationId !== reference.operationId ||
    upload.status !== 'FINALIZING' ||
    upload.materialId !== authority.materialId ||
    upload.material.originalUrl
  )
    throw new Error('Material failure cannot replace a newer or retained original.');
  await database.materialUpload.update({
    where: { id: upload.id },
    data: {
      status: 'FAILED',
      revision: { increment: 1 },
      failureReason:
        'Finalization needs recovery. Uploaded parts are retained. Cancel this upload before starting again.',
    },
  });
  await database.courseMaterial.update({
    where: { id: upload.materialId },
    data: {
      processingStatus: 'RECOVERY_REQUIRED',
      processingError: 'Original finalization did not complete.',
    },
  });
  await outbox.complete(reference.operationId, reference.fingerprint);
}

export async function settleFailedMaterialJob(
  database: Prisma.TransactionClient,
  job: Job<unknown>
) {
  const work = await loadDurableQueueJob(database, job, 'material-finalization', 1);
  if (!work.complete)
    await settleMaterialFinalizationFailure(database, {
      operationId: work.operationId,
      fingerprint: work.fingerprint,
      handler: 'material-finalization',
      version: 1,
    });
}
