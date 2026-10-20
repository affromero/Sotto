import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AccessError } from 'thesidedoor-core/access';
import type { MaterialUploadPartMetadata } from '@sotto/shared';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { materialUploadStorageScopes } from './scopes';
import { validateMaterialUploadPartMetadata } from './protocol';
import { createMaterialUploadStream } from './stream';
import { readOwnedUpload, requireUploading, uploadResponse } from './state';

/** A retry fences an older unpublished writer but cannot replace a committed part. */
export async function storeMaterialUploadPart(
  request: Request,
  admission: AuthenticatedRequest,
  uploadId: string,
  input: MaterialUploadPartMetadata
) {
  const claim = await sottoTransaction(
    prisma,
    async (database) => {
      await requireOriginalSottoAdmission(database, request, admission);
      const upload = await readOwnedUpload(database, admission.userId, uploadId, true);
      requireUploading(upload);
      const metadata = validateMaterialUploadPartMetadata(upload.material.byteSize, input);
      const previous = upload.parts.find((part) => part.index === metadata.index);
      if (
        previous?.originalUrl &&
        (previous.offset !== metadata.offset ||
          previous.byteSize !== metadata.byteSize ||
          previous.sha256 !== metadata.sha256)
      )
        throw new AccessError('conflict', 'A different part already owns this position.');
      if (previous?.originalUrl && previous.committedAt) return { complete: true as const, upload };
      const writeToken = randomUUID();
      const part = await database.materialUploadPart.upsert({
        where: { uploadId_index: { uploadId, index: metadata.index } },
        create: {
          uploadId,
          index: metadata.index,
          offset: metadata.offset,
          byteSize: metadata.byteSize,
          sha256: metadata.sha256,
          writeToken,
        },
        update: {
          writeToken,
          offset: metadata.offset,
          byteSize: metadata.byteSize,
          sha256: metadata.sha256,
        },
      });
      return { complete: false as const, upload, part, metadata, writeToken };
    },
    { signal: request.signal }
  );
  if (claim.complete) {
    await request.body?.cancel();
    return uploadResponse(claim.upload);
  }
  const stream = createMaterialUploadStream(request, {
    declaredFileBytes: claim.upload.material.byteSize,
    index: claim.metadata.index,
    sha256: claim.metadata.sha256,
  });
  const inspect = async (database: Parameters<typeof readOwnedUpload>[0], published?: string) => {
    await requireOriginalSottoAdmission(database, request, admission);
    const current = await readOwnedUpload(database, admission.userId, uploadId, true);
    if (!published) requireUploading(current);
    const part = current.parts.find((item) => item.id === claim.part.id);
    if (!part || part.writeToken !== claim.writeToken || part.originalUrl !== (published ?? null))
      throw new AccessError('conflict', 'This part write was superseded. Resume the upload.');
    return materialUploadStorageScopes(database, current);
  };
  await writeStorageReference({
    database: prisma,
    signal: request.signal,
    prefix: `materials/${admission.userId}/${claim.upload.materialId}/parts/${claim.part.id}`,
    extension: 'part',
    body: stream.body,
    contentType: 'application/octet-stream',
    previousReference: () => null,
    captureAdmission: async (database) => ({
      ...(await inspect(database)),
      consumer: `upload-part:${claim.part.id}:original`,
      snapshot: claim.metadata,
    }),
    validateAdmission: async (database, captured, published) => {
      const scopes = await inspect(database, published);
      if (
        !isDeepStrictEqual(scopes.scopes, captured.scopes) ||
        scopes.instanceId !== captured.instanceId
      )
        throw new AccessError('conflict', 'Upload ownership changed.');
    },
    commit: async (database, originalUrl) => {
      const verified = stream.getVerification();
      if (verified.sha256 !== claim.metadata.sha256)
        throw new AccessError('invalid', 'The part checksum changed.');
      await inspect(database);
      const published = await database.materialUploadPart.updateMany({
        where: { id: claim.part.id, writeToken: claim.writeToken, originalUrl: null },
        data: { originalUrl, committedAt: new Date() },
      });
      if (published.count !== 1) throw new AccessError('conflict');
      await database.materialUpload.update({
        where: { id: uploadId },
        data: { revision: { increment: 1 } },
      });
    },
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
