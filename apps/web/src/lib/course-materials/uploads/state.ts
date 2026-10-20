import { AccessError } from 'thesidedoor-core/access';
import { materialUploadResumeSchema, type MaterialUploadResume } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';

export const uploadInclude = {
  material: true,
  batch: true,
  parts: { orderBy: { index: 'asc' as const } },
} as const;
export type UploadState = Prisma.MaterialUploadGetPayload<{ include: typeof uploadInclude }>;

export async function readOwnedUpload(
  database: Prisma.TransactionClient,
  userId: string,
  uploadId: string,
  lock = false
): Promise<UploadState> {
  if (lock)
    await database.$queryRaw`SELECT id FROM "MaterialUpload" WHERE id = ${uploadId} FOR UPDATE`;
  const upload = await database.materialUpload.findFirst({
    where: { id: uploadId, batch: { userId }, material: { userId } },
    include: uploadInclude,
  });
  if (!upload) throw new AccessError('forbidden', 'Upload not available.');
  return upload;
}

export function requireUploading(upload: UploadState): void {
  if (upload.expiresAt.getTime() <= Date.now())
    throw new AccessError('conflict', 'This upload has expired. Start a new upload.');
  if (upload.status !== 'UPLOADING')
    throw new AccessError('conflict', 'This upload is no longer accepting parts.');
}

export function uploadResponse(upload: UploadState): MaterialUploadResume {
  const { material } = upload;
  return materialUploadResumeSchema.parse({
    schemaVersion: 1,
    batchId: upload.batchId,
    uploadId: upload.id,
    materialId: material.id,
    limitsVersion: 1,
    file: {
      clientId: upload.clientId,
      name: material.name,
      mimeType: material.mimeType,
      byteSize: material.byteSize,
      ...(upload.expectedSha256 ? { sha256: upload.expectedSha256 } : {}),
    },
    status: upload.status,
    failureReason: upload.failureReason,
    revision: upload.revision,
    expiresAt: upload.expiresAt.toISOString(),
    parts: upload.parts.flatMap((part) =>
      part.originalUrl && part.committedAt
        ? [
            {
              schemaVersion: 1,
              uploadId: upload.id,
              index: part.index,
              offset: part.offset,
              byteSize: part.byteSize,
              sha256: part.sha256,
              committedAt: part.committedAt.toISOString(),
            },
          ]
        : []
    ),
    original:
      upload.status === 'COMPLETE' && upload.completedAt
        ? {
            schemaVersion: 1,
            uploadId: upload.id,
            materialId: material.id,
            byteSize: material.byteSize,
            sha256: material.originalSha256,
            publishedAt: upload.completedAt.toISOString(),
          }
        : null,
  });
}
