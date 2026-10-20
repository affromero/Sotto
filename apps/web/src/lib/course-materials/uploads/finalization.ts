import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { isDeepStrictEqual } from 'node:util';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { StorageReadCleanupError } from 'thesidedoor-core/storage';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { restoreStorageBackend } from '@/lib/r2';
import { materialStorageScopes } from '@/lib/course-materials';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { withSottoJobExecution } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  loadDurableQueueJob,
  bindDurableQueueJob,
  completeDurableQueueJob,
  isDurableQueueCleanupFailure,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  resolveStorageInput,
  validateStorageInputs,
} from '@/lib/sidedoor/storage/core/storage-inputs';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { readOwnedUpload, uploadResponse } from './state';
import { validateMaterialUploadCompletion } from './protocol';
import { enqueueMaterialExtraction } from '../extraction/admission';
import { assertKnownMaterialWrites } from '../jobs/storage-outcome';

const finalizationPayload = z
  .object({
    userId: z.string().min(1),
    materialId: z.uuid(),
    uploadId: z.uuid(),
    processingRevision: z.number().int().positive(),
  })
  .strict();

class MaterialFinalizationCleanupError extends Error {
  constructor(cause?: unknown) {
    super('Original storage outcome is unresolved. Uploaded parts are retained.', { cause });
    this.name = 'MaterialFinalizationCleanupError';
  }
}

async function assertKnownOriginalWrites(materialId: string, prefix: string) {
  return assertKnownMaterialWrites(materialId, prefix);
}

async function readFinalization(
  database: Parameters<typeof readOwnedUpload>[0],
  job: Job<unknown>
) {
  const work = await loadDurableQueueJob<z.infer<typeof finalizationPayload>>(
    database,
    job,
    'material-finalization',
    1
  );
  if (work.complete) return work;
  const payload = finalizationPayload.parse(work.payload.payload);
  const upload = await readOwnedUpload(database, payload.userId, payload.uploadId);
  if (
    upload.materialId !== payload.materialId ||
    upload.material.originalUrl !== null ||
    upload.material.originalSha256 !== null ||
    upload.status !== 'FINALIZING' ||
    upload.finalizationOperationId !== work.operationId ||
    upload.material.processingRevision !== payload.processingRevision
  )
    throw new Error('Material finalization identity changed.');
  validateMaterialUploadCompletion(
    upload.id,
    upload.material.byteSize,
    uploadResponse(upload).parts
  );
  const parts = [];
  for (const part of upload.parts) {
    if (!part.originalUrl || !part.committedAt)
      throw new Error('A material part is not committed.');
    parts.push({
      ...part,
      source: await resolveStorageInput(database, {
        consumer: `upload-part:${part.id}:original`,
        reference: part.originalUrl,
      }),
    });
  }
  return { ...work, envelope: work.payload, payload, upload, parts };
}

/** Joins verified immutable parts through one bounded temporary part at a time. */
export async function processMaterialFinalization(
  job: Job<unknown>,
  signal: AbortSignal = AbortSignal.timeout(600000)
) {
  const captured = await sottoTransaction(prisma, (database) => readFinalization(database, job), {
    signal,
  });
  if (captured.complete) return;
  const bound = bindDurableQueueJob(job, captured.payload, {
    ...captured,
    payload: captured.envelope,
  });
  await withSottoJobExecution({
    database: prisma,
    parentId: captured.operationId,
    fingerprint: captured.fingerprint,
    signal,
    isCleanupFailure: isDurableQueueCleanupFailure,
    validate: async (database) => {
      const current = await readFinalization(database, job);
      if (current.complete) return false;
      if (!isDeepStrictEqual(current, captured))
        throw new Error('Material finalization inputs changed.');
      return true;
    },
    run: async ({ directory, markCleanupUnconfirmed }) => {
      const prefix = `materials/${captured.payload.userId}/${captured.payload.materialId}/original`;
      try {
        await assertKnownOriginalWrites(captured.payload.materialId, prefix);
      } catch (error) {
        markCleanupUnconfirmed();
        throw new MaterialFinalizationCleanupError(error);
      }
      let verifiedSha256: string | undefined;
      const bytes = Readable.from(
        (async function* () {
          const hash = createHash('sha256');
          let total = 0;
          for (const [index, part] of captured.parts.entries()) {
            signal.throwIfAborted();
            const backend = await restoreStorageBackend(part.source.backend.descriptor);
            const path = join(directory, `part-${index}`);
            try {
              await backend.downloadToFile(part.source.input.key, path, signal);
            } catch (error) {
              if (error instanceof StorageReadCleanupError) markCleanupUnconfirmed();
              throw error;
            }
            const partHash = createHash('sha256');
            let partBytes = 0;
            for await (const chunk of createReadStream(path, { signal, highWaterMark: 65536 })) {
              if (!(chunk instanceof Uint8Array)) throw new Error('Material part is not binary.');
              partBytes += chunk.byteLength;
              if (partBytes > part.byteSize) throw new Error('Material part exceeds its receipt.');
              partHash.update(chunk);
              hash.update(chunk);
              total += chunk.byteLength;
              yield chunk;
            }
            if (partBytes !== part.byteSize || partHash.digest('hex') !== part.sha256)
              throw new Error('Material part failed its immutable checksum.');
            await rm(path);
            await job.updateProgress(Math.floor((90 * (index + 1)) / captured.parts.length));
          }
          const digest = hash.digest('hex');
          if (
            total !== captured.upload.material.byteSize ||
            (captured.upload.expectedSha256 && digest !== captured.upload.expectedSha256)
          )
            throw new Error('The complete original failed its declared size or checksum.');
          verifiedSha256 = digest;
        })(),
        { objectMode: false }
      );
      const extension = extname(captured.upload.material.name).slice(1).toLowerCase();
      try {
        await writeStorageReference({
          database: prisma,
          signal,
          prefix,
          extension: /^[a-z0-9]{1,12}$/.test(extension) ? extension : 'bin',
          body: bytes,
          contentType: captured.upload.material.mimeType,
          previousReference: () => null,
          captureAdmission: async (database) => {
            const current = await readFinalization(database, job);
            if (current.complete || !isDeepStrictEqual(current, captured))
              throw new Error('Material finalization changed before publication.');
            return {
              ...(await materialStorageScopes(database, captured.upload.material)),
              consumer: `material:${captured.payload.materialId}:original`,
              snapshot: null,
            };
          },
          validateAdmission: async (database, admission, published) => {
            const scopes = await materialStorageScopes(database, captured.upload.material);
            if (
              scopes.instanceId !== admission.instanceId ||
              !isDeepStrictEqual(scopes.scopes, admission.scopes)
            )
              throw new Error('Material ownership changed during finalization.');
            if (!published) {
              const current = await readFinalization(database, job);
              if (current.complete || !isDeepStrictEqual(current, captured))
                throw new Error('Material finalization changed during upload.');
              return;
            }
            const current = await readOwnedUpload(
              database,
              captured.payload.userId,
              captured.payload.uploadId
            );
            const receipt = await loadDurableQueueJob(database, job, 'material-finalization', 1);
            if (
              !receipt.complete ||
              current.status !== 'COMPLETE' ||
              current.material.originalUrl !== published ||
              current.material.originalSha256 !== verifiedSha256 ||
              current.finalizationOperationId !== captured.operationId
            )
              throw new Error('Original publication could not be verified.');
          },
          commit: async (database, originalUrl) => {
            signal.throwIfAborted();
            if (!verifiedSha256) throw new Error('Original bytes were not completely verified.');
            await validateStorageInputs(
              database,
              captured.parts.map((part) => part.source.input)
            );
            const current = await readOwnedUpload(
              database,
              captured.payload.userId,
              captured.payload.uploadId,
              true
            );
            if (
              current.status !== 'FINALIZING' ||
              current.finalizationOperationId !== captured.operationId
            )
              throw new Error('Material finalization was cancelled.');
            await database.courseMaterial.update({
              where: { id: captured.payload.materialId },
              data: { originalUrl, originalSha256: verifiedSha256, processingStatus: 'RETAINED' },
            });
            await database.materialUpload.update({
              where: { id: captured.payload.uploadId },
              data: { status: 'COMPLETE', completedAt: new Date(), revision: { increment: 1 } },
            });
            await enqueueMaterialExtraction(database, captured.payload.materialId);
            await completeDurableQueueJob(database, bound);
          },
        });
      } catch (error) {
        try {
          await assertKnownOriginalWrites(captured.payload.materialId, prefix);
        } catch (recoveryError) {
          markCleanupUnconfirmed();
          throw new MaterialFinalizationCleanupError(new AggregateError([error, recoveryError]));
        }
        throw error;
      }
      await job.updateProgress(100);
    },
  });
}
