import { z } from 'zod';
import { AccessError } from 'thesidedoor-core/access';
import type { Prisma } from '@/generated/prisma/client';
import {
  durableQueueOperationId,
  enqueueDurableQueueJob,
} from '@/lib/sidedoor/jobs/core/durable-queue';

export const materialOptimizationPayloadSchema = z
  .object({
    userId: z.string().min(1),
    materialId: z.uuid(),
    processingRevision: z.number().int().positive(),
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const materialOptimizationReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: z.uuid(),
    processingRevision: z.number().int().positive(),
    originalSha256: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum([
      'QUEUED',
      'OPTIMIZED',
      'UNAVAILABLE',
      'UNCHANGED',
      'FAILED',
      'RECOVERY_REQUIRED',
    ]),
    diagnostic: z.string().max(2000).optional(),
    originalBytes: z.number().int().positive().optional(),
    optimizedBytes: z.number().int().positive().optional(),
    savedBytes: z.number().int().positive().optional(),
    verification: z.json().optional(),
  })
  .strict();

/** Optional compression never replaces or alters the retained original. */
export async function enqueueMaterialOptimization(
  database: Prisma.TransactionClient,
  userId: string,
  materialId: string
) {
  await database.$queryRaw`SELECT id FROM "CourseMaterial" WHERE id = ${materialId} FOR UPDATE`;
  const material = await database.courseMaterial.findFirst({ where: { id: materialId, userId } });
  if (!material?.originalUrl || !material.originalSha256) return null;
  const payload = materialOptimizationPayloadSchema.parse({
    userId,
    materialId,
    processingRevision: material.processingRevision,
    inputSha256: material.originalSha256,
  });
  if (material.mimeType !== 'application/pdf' && !/\.pdf$/i.test(material.name))
    throw new AccessError('invalid', 'Lossless PDF optimization requires a PDF original.');
  const jobId = `material-optimization-${materialId}-${material.processingRevision}`;
  const operationId = durableQueueOperationId('material-optimization', jobId);
  if (material.optimizationReceipt) {
    const receipt = materialOptimizationReceiptSchema.parse(material.optimizationReceipt);
    if (
      receipt.originalSha256 !== material.originalSha256 ||
      receipt.processingRevision > material.processingRevision ||
      receipt.operationId !==
        durableQueueOperationId(
          'material-optimization',
          `material-optimization-${materialId}-${receipt.processingRevision}`
        ) ||
      (receipt.status === 'QUEUED' && receipt.processingRevision !== material.processingRevision)
    )
      throw new Error('The saved optimization belongs to a different original revision.');
    return receipt;
  }
  const receipt = materialOptimizationReceiptSchema.parse({
    schemaVersion: 1,
    operationId,
    processingRevision: material.processingRevision,
    originalSha256: material.originalSha256,
    status: 'QUEUED',
  });
  await database.courseMaterial.update({
    where: { id: materialId },
    data: { optimizationReceipt: receipt },
  });
  await enqueueDurableQueueJob(database, {
    handler: 'material-optimization',
    type: 'optimize_material_pdf',
    payload,
    jobId,
    attempts: 2,
  });
  return receipt;
}
