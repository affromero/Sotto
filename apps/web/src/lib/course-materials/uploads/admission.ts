import { createHash, randomUUID } from 'node:crypto';
import { AccessError } from 'thesidedoor-core/access';
import {
  materialUploadBatchRequestSchema,
  materialUploadBatchReceiptSchema,
  materialUploadLimits,
  type MaterialUploadBatchRequest,
} from '@sotto/shared';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { uploadInclude, uploadResponse } from './state';

/** Reserve every declared file together. A repeated request cannot reserve new bytes. */
export async function createMaterialUploadBatch(
  request: Request,
  admission: AuthenticatedRequest,
  input: MaterialUploadBatchRequest,
  courseId?: string
) {
  const declaration = materialUploadBatchRequestSchema.parse(input);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ courseId: courseId ?? null, ...declaration }))
    .digest('hex');
  return sottoTransaction(
    prisma,
    async (database) => {
      await requireOriginalSottoAdmission(database, request, admission);
      await database.$queryRaw`SELECT id FROM "User" WHERE id = ${admission.userId} FOR UPDATE`;
      const existing = await database.materialUploadBatch.findUnique({
        where: { userId_requestId: { userId: admission.userId, requestId: declaration.requestId } },
        include: { uploads: { include: uploadInclude, orderBy: { id: 'asc' } } },
      });
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new AccessError('conflict', 'This upload request belongs to a different file set.');
        return materialUploadBatchReceiptSchema.parse({
          schemaVersion: 1,
          batchId: existing.id,
          requestId: existing.requestId,
          uploads: existing.uploads.map(uploadResponse),
        });
      }
      if (
        courseId &&
        !(await database.course.findFirst({
          where: { id: courseId, userId: admission.userId },
          select: { id: true },
        }))
      )
        throw new AccessError('forbidden', 'Course not available.');
      const pending = await database.materialUpload.findMany({
        where: {
          batch: { userId: admission.userId },
          status: { in: ['UPLOADING', 'FINALIZING', 'FAILED'] },
        },
        select: { material: { select: { byteSize: true } } },
      });
      const bytes = declaration.files.reduce((sum, file) => sum + file.byteSize, 0);
      if (
        pending.length + declaration.files.length > 2 * materialUploadLimits.maxFiles ||
        pending.reduce((sum, upload) => sum + upload.material.byteSize, bytes) >
          2 * materialUploadLimits.maxBatchBytes
      )
        throw new AccessError(
          'conflict',
          'Complete or cancel your pending uploads before adding more.'
        );
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const batch = await database.materialUploadBatch.create({
        data: {
          userId: admission.userId,
          requestId: declaration.requestId,
          fingerprint,
          expiresAt,
        },
      });
      const uploads = [];
      for (const file of declaration.files) {
        const name = file.name.replace(/[\u0000-\u001f\/\\]/g, '_') || 'course-material';
        const material = await database.courseMaterial.create({
          data: {
            id: randomUUID(),
            userId: admission.userId,
            courseId,
            name,
            mimeType: file.mimeType,
            byteSize: file.byteSize,
            extractedText: '',
            processingStatus: 'AWAITING_UPLOAD',
          },
        });
        uploads.push(
          await database.materialUpload.create({
            data: {
              batchId: batch.id,
              materialId: material.id,
              clientId: file.clientId,
              expectedSha256: file.sha256,
              expiresAt,
            },
            include: uploadInclude,
          })
        );
      }
      return materialUploadBatchReceiptSchema.parse({
        schemaVersion: 1,
        batchId: batch.id,
        requestId: batch.requestId,
        uploads: uploads.sort((left, right) => left.id.localeCompare(right.id)).map(uploadResponse),
      });
    },
    { signal: request.signal }
  );
}
