import { AccessError } from 'thesidedoor-core/access';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { captureStorageBackend } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { runSottoStorageCleanup } from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';
import { readOwnedUpload, uploadResponse, type UploadState } from './state';

async function retireUploadParts(
  database: Prisma.TransactionClient,
  upload: UploadState,
  backend: Awaited<ReturnType<typeof captureStorageBackend>>,
  status: 'CANCELLED' | 'EXPIRED' | 'COMPLETE'
) {
  const completed = status === 'COMPLETE';
  if (
    completed &&
    (upload.status !== 'COMPLETE' ||
      !upload.material.originalUrl ||
      !upload.material.originalSha256)
  )
    throw new AccessError('conflict');
  if (
    !completed &&
    (upload.status === 'COMPLETE' || upload.material.originalUrl || upload.material.optimizedUrl)
  )
    throw new AccessError('conflict', 'A retained original cannot be cancelled as an upload.');
  const jobs = await admitLearningStorageDeletion({
    database,
    scope: completed
      ? { kind: 'material-upload', id: upload.id }
      : { kind: 'material', id: upload.materialId },
    subjects: [
      {
        subjectId: completed ? `material-upload:${upload.id}` : `material:${upload.materialId}`,
        generation: (completed ? upload.createdAt : upload.material.createdAt).getTime(),
      },
    ],
    currentBackend: backend,
  });
  await database.materialUploadPart.deleteMany({ where: { uploadId: upload.id } });
  if (!completed) {
    await database.materialUpload.update({
      where: { id: upload.id },
      data: { status, revision: { increment: 1 } },
    });
    await database.courseMaterial.update({
      where: { id: upload.materialId },
      data: { processingStatus: status },
    });
  }
  await database.materialUpload.update({
    where: { id: upload.id },
    data: { cleanupJobIds: jobs.map((job) => job.id) },
  });
  return jobs.map((job) => job.id);
}

async function finishCleanup(uploadId: string, jobIds: string[], signal: AbortSignal) {
  for (const jobId of jobIds) await runSottoStorageCleanup(prisma, jobId, { signal });
  if (jobIds.length)
    await prisma.materialUpload.updateMany({
      where: { id: uploadId, cleanupJobIds: { equals: jobIds } },
      data: { cleanupJobIds: [] },
    });
}

export async function cancelMaterialUpload(
  request: Request,
  admission: AuthenticatedRequest,
  uploadId: string
) {
  const backend = await captureStorageBackend();
  const result = await sottoTransaction(
    prisma,
    async (database) => {
      await requireOriginalSottoAdmission(database, request, admission);
      const upload = await readOwnedUpload(database, admission.userId, uploadId, true);
      if (upload.status === 'CANCELLED' || upload.status === 'EXPIRED')
        return { jobs: upload.cleanupJobIds, upload: uploadResponse(upload) };
      const jobs = await retireUploadParts(database, upload, backend, 'CANCELLED');
      return {
        jobs,
        upload: uploadResponse(await readOwnedUpload(database, admission.userId, uploadId)),
      };
    },
    { signal: request.signal, timeoutMs: 60000 }
  );
  await finishCleanup(uploadId, result.jobs, request.signal);
  return result.upload;
}

/** Bounded restart-safe maintenance. Unknown storage cleanup stays in its canonical journal. */
export async function maintainMaterialUploads(
  signal: AbortSignal,
  after?: string | null
): Promise<string | null> {
  const candidates = await prisma.materialUpload.findMany({
    where: {
      ...(after ? { id: { gt: after } } : {}),
      OR: [
        { status: 'UPLOADING', expiresAt: { lte: new Date() } },
        { status: 'COMPLETE', parts: { some: {} } },
        { cleanupJobIds: { isEmpty: false } },
      ],
    },
    select: { id: true, material: { select: { userId: true } } },
    orderBy: { id: 'asc' },
    take: 20,
  });
  if (!candidates.length) return null;
  const backend = await captureStorageBackend();
  for (const candidate of candidates) {
    signal.throwIfAborted();
    try {
      const jobs = await sottoTransaction(
        prisma,
        async (database) => {
          const upload = await readOwnedUpload(
            database,
            candidate.material.userId,
            candidate.id,
            true
          );
          if (upload.cleanupJobIds.length) return upload.cleanupJobIds;
          if (upload.status === 'COMPLETE' && upload.parts.length)
            return retireUploadParts(database, upload, backend, 'COMPLETE');
          if (upload.status === 'UPLOADING' && upload.expiresAt.getTime() <= Date.now())
            return retireUploadParts(database, upload, backend, 'EXPIRED');
          return [];
        },
        { signal, timeoutMs: 60000 }
      );
      await finishCleanup(candidate.id, jobs, signal);
    } catch (error) {
      signal.throwIfAborted();
      logger.error('Material upload cleanup remains pending', {
        uploadId: candidate.id,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
  return candidates.length === 20 ? candidates.at(-1)!.id : null;
}
