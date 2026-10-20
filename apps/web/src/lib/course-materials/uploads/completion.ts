import { AccessError } from 'thesidedoor-core/access';
import {
  materialUploadCompletionRequestSchema,
  type MaterialUploadCompletionRequest,
} from '@sotto/shared';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { materialFinalizationQueue } from '@/lib/queue';
import { admitDurableQueueJob } from '@/lib/sidedoor/jobs/core/durable-queue';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { validateMaterialUploadCompletion } from './protocol';
import { readOwnedUpload, requireUploading, uploadResponse } from './state';

/** Publication is asynchronous. PostgreSQL admission survives a Redis delivery failure. */
export async function completeMaterialUpload(
  request: Request,
  admission: AuthenticatedRequest,
  uploadId: string,
  input: MaterialUploadCompletionRequest
) {
  const completion = materialUploadCompletionRequestSchema.parse(input);
  const upload = await sottoTransaction(
    prisma,
    async (database) => {
      await requireOriginalSottoAdmission(database, request, admission);
      return readOwnedUpload(database, admission.userId, uploadId);
    },
    { signal: request.signal }
  );
  if (upload.status === 'COMPLETE') return uploadResponse(upload);
  await admitDurableQueueJob({
    queue: materialFinalizationQueue,
    type: 'finalize_material_upload',
    jobId: `material-upload-${uploadId}`,
    payload: {
      userId: admission.userId,
      materialId: upload.materialId,
      uploadId,
      processingRevision: upload.material.processingRevision,
    },
    authorize: async (database) => {
      await requireOriginalSottoAdmission(database, request, admission);
      return { userId: admission.userId };
    },
    mutate: async (database, operationId) => {
      const current = await readOwnedUpload(database, admission.userId, uploadId, true);
      if (current.status === 'FINALIZING' && current.finalizationOperationId === operationId)
        return;
      requireUploading(current);
      if (current.revision !== completion.expectedRevision)
        throw new AccessError(
          'conflict',
          'Upload changed. Refresh its receipts before finalizing.'
        );
      validateMaterialUploadCompletion(
        current.id,
        current.material.byteSize,
        uploadResponse(current).parts
      );
      await database.materialUpload.update({
        where: { id: uploadId },
        data: {
          status: 'FINALIZING',
          finalizationOperationId: operationId,
          revision: { increment: 1 },
        },
      });
    },
    attempts: 3,
  });
  return sottoTransaction(
    prisma,
    async (database) => {
      await requireOriginalSottoAdmission(database, request, admission);
      return uploadResponse(await readOwnedUpload(database, admission.userId, uploadId));
    },
    { signal: request.signal }
  );
}
