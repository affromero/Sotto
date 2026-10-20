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
import { materialExtractionPayloadSchema } from '../extraction/admission';
import { materialOptimizationReceiptSchema } from '../optimization/admission';

/** Failure receipts stop redispatch. Uncertain storage and all parts remain available for recovery. */
export async function settleMaterialFinalizationFailure(
  database: Prisma.TransactionClient,
  reference: { operationId: string; fingerprint: string; handler: string; version: number }
) {
  if (
    !['material-finalization', 'material-extraction', 'material-optimization'].includes(
      reference.handler
    ) ||
    reference.version !== 1
  )
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
  if (reference.handler === 'material-optimization') {
    if (authority.kind !== 'material' || authority.upload || !authority.inputSha256)
      throw new Error('PDF optimization requires its retained original authority.');
    await validateDurableAuthority(database, authority);
    const material = await database.courseMaterial.findUniqueOrThrow({
      where: { id: authority.materialId },
    });
    const receipt = materialOptimizationReceiptSchema.parse(material.optimizationReceipt);
    if (
      receipt.operationId !== reference.operationId ||
      receipt.originalSha256 !== authority.inputSha256 ||
      receipt.status !== 'QUEUED' ||
      material.optimizedUrl
    )
      throw new Error('Material optimization failure cannot replace a newer result.');
    await database.courseMaterial.update({
      where: { id: material.id },
      data: {
        optimizationReceipt: {
          ...receipt,
          status: 'RECOVERY_REQUIRED',
          diagnostic: 'Optional PDF optimization requires recovery. The original remains retained.',
        },
      },
    });
    await outbox.complete(reference.operationId, reference.fingerprint);
    return;
  }
  if (reference.handler === 'material-extraction') {
    if (authority.kind !== 'material' || authority.upload || !authority.inputSha256)
      throw new Error('Material extraction requires its retained original authority.');
    await validateDurableAuthority(database, authority);
    const payload = materialExtractionPayloadSchema.parse(envelope.payload);
    const run = await database.materialExtractionRun.findFirstOrThrow({
      where: {
        id: payload.runId,
        materialId: authority.materialId,
        originalSha256: authority.inputSha256,
        processingRevision: authority.processingRevision,
      },
    });
    if (['COMPLETE', 'PARTIAL'].includes(run.status))
      throw new Error('Completed page extraction cannot be replaced by a failure.');
    await database.materialExtractionRun.update({
      where: { id: run.id },
      data: {
        status: 'RECOVERY_REQUIRED',
        completedAt: new Date(),
        failureReason:
          'Page extraction did not complete. The original and saved page text remain retained.',
      },
    });
    await database.courseMaterial.update({
      where: { id: authority.materialId },
      data: {
        processingStatus: 'RECOVERY_REQUIRED',
        processingError: 'Page extraction requires explicit recovery.',
      },
    });
    await outbox.complete(reference.operationId, reference.fingerprint);
    return;
  }
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
  job: Job<unknown>,
  handler:
    | 'material-finalization'
    | 'material-extraction'
    | 'material-optimization' = 'material-finalization'
) {
  const work = await loadDurableQueueJob(database, job, handler, 1);
  if (!work.complete)
    await settleMaterialFinalizationFailure(database, {
      operationId: work.operationId,
      fingerprint: work.fingerprint,
      handler,
      version: 1,
    });
}
