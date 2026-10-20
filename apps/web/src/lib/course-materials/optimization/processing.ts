import { createReadStream } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Job } from 'bullmq';
import { StorageReadCleanupError } from 'thesidedoor-core/storage';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { restoreStorageBackend } from '@/lib/r2';
import { isMediaCleanupFailure } from '@/lib/audio/media-process';
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
import { materialStorageScopes } from '..';
import { assertKnownMaterialWrites } from '../jobs/storage-outcome';
import { materialOptimizationPayloadSchema, materialOptimizationReceiptSchema } from './admission';
import { optimizeMaterialPdf } from './pdf';

class OptimizationStorageUnknown extends Error {
  constructor(cause: unknown) {
    super('Optimized PDF storage requires recovery.', { cause });
    this.name = 'OptimizationStorageUnknown';
  }
}

async function readOptimization(
  database: Parameters<typeof materialStorageScopes>[0],
  job: Job<unknown>
) {
  const work = await loadDurableQueueJob(database, job, 'material-optimization', 1);
  if (work.complete) return work;
  const payload = materialOptimizationPayloadSchema.parse(work.payload.payload);
  const material = await database.courseMaterial.findFirstOrThrow({
    where: {
      id: payload.materialId,
      userId: payload.userId,
      processingRevision: payload.processingRevision,
      originalSha256: payload.inputSha256,
      originalUrl: { not: null },
    },
  });
  const receipt = materialOptimizationReceiptSchema.parse(material.optimizationReceipt);
  if (
    receipt.operationId !== work.operationId ||
    receipt.originalSha256 !== payload.inputSha256 ||
    receipt.status !== 'QUEUED' ||
    material.optimizedUrl
  )
    throw new Error('The original PDF optimization admission changed.');
  const source = await resolveStorageInput(database, {
    consumer: `material:${material.id}:original`,
    reference: material.originalUrl!,
  });
  return { ...work, input: payload, material, receipt, source };
}

export async function processMaterialOptimization(
  job: Job<unknown>,
  signal = AbortSignal.timeout(1_200_000)
) {
  const captured = await sottoTransaction(prisma, (database) => readOptimization(database, job), {
    signal,
  });
  if (captured.complete) return;
  const bound = bindDurableQueueJob(job, captured.input, captured);
  const prefix = `materials/${captured.input.userId}/${captured.input.materialId}/optimized`;
  await withSottoJobExecution({
    database: prisma,
    parentId: captured.operationId,
    fingerprint: captured.fingerprint,
    signal,
    isCleanupFailure: (error) =>
      error instanceof OptimizationStorageUnknown ||
      isDurableQueueCleanupFailure(error) ||
      isMediaCleanupFailure(error),
    validate: async (database) => {
      const current = await readOptimization(database, job);
      if (current.complete) return false;
      if (
        !isDeepStrictEqual(current.receipt, captured.receipt) ||
        !isDeepStrictEqual(current.source, captured.source)
      )
        throw new Error('Material optimization inputs changed.');
      return true;
    },
    run: async ({ directory, markCleanupUnconfirmed }) => {
      const assertWrites = async () => {
        try {
          await assertKnownMaterialWrites(captured.material.id, prefix);
        } catch (error) {
          markCleanupUnconfirmed();
          throw new OptimizationStorageUnknown(error);
        }
      };
      await assertWrites();
      const disk = await statfs(directory);
      if (
        disk.bavail * disk.bsize <
        2 * captured.material.byteSize + 2 * 512 * 1024 * 1024 + 64 * 1024 * 1024
      )
        throw new Error('Insufficient disk for complete original and candidate PDF verification.');
      const originalPath = join(directory, 'original.pdf');
      try {
        const backend = await restoreStorageBackend(captured.source.backend.descriptor);
        await backend.downloadToFile(captured.source.input.key, originalPath, signal);
      } catch (error) {
        if (error instanceof StorageReadCleanupError) markCleanupUnconfirmed();
        throw error;
      }
      const optimized = await optimizeMaterialPdf({
        originalPath,
        outputPath: join(directory, 'optimized.pdf'),
        signal,
      });
      if (
        optimized.status === 'optimized' &&
        optimized.verification.originalSha256 !== captured.input.inputSha256
      )
        throw new Error('The verified optimization belongs to a different original checksum.');
      const receipt = materialOptimizationReceiptSchema.parse({
        ...captured.receipt,
        status: optimized.status.toUpperCase(),
        diagnostic: optimized.diagnostic,
        ...(optimized.status === 'optimized'
          ? {
              originalBytes: optimized.originalBytes,
              optimizedBytes: optimized.optimizedBytes,
              savedBytes: optimized.savedBytes,
              verification: optimized.verification,
            }
          : {}),
      });
      if (optimized.status !== 'optimized') {
        await sottoTransaction(
          prisma,
          async (database) => {
            await readOptimization(database, job);
            await validateStorageInputs(database, [captured.source.input]);
            await database.courseMaterial.update({
              where: { id: captured.material.id },
              data: { optimizationReceipt: receipt },
            });
            await completeDurableQueueJob(database, bound);
          },
          { signal }
        );
        return;
      }
      try {
        await writeStorageReference({
          database: prisma,
          signal,
          prefix,
          extension: 'pdf',
          body: createReadStream(optimized.outputPath, { signal, highWaterMark: 65536 }),
          contentType: 'application/pdf',
          previousReference: () => null,
          captureAdmission: async (database) => {
            const current = await readOptimization(database, job);
            if (current.complete) throw new Error('Optimization already completed.');
            return {
              ...(await materialStorageScopes(database, current.material)),
              consumer: `material:${captured.material.id}:optimized`,
              snapshot: null,
            };
          },
          validateAdmission: async (database, admission, published) => {
            const scopes = await materialStorageScopes(database, captured.material);
            if (
              !isDeepStrictEqual(scopes.scopes, admission.scopes) ||
              scopes.instanceId !== admission.instanceId
            )
              throw new Error('Optimized material ownership changed.');
            if (!published) {
              await readOptimization(database, job);
              return;
            }
            const current = await database.courseMaterial.findUniqueOrThrow({
              where: { id: captured.material.id },
            });
            const work = await loadDurableQueueJob(database, job, 'material-optimization', 1);
            if (
              !work.complete ||
              current.optimizedUrl !== published ||
              !isDeepStrictEqual(current.optimizationReceipt, receipt)
            )
              throw new Error('Optimized PDF publication could not be verified.');
          },
          commit: async (database, optimizedUrl) => {
            const current = await readOptimization(database, job);
            if (current.complete) throw new Error('Optimization admission changed.');
            await validateStorageInputs(database, [captured.source.input]);
            await database.courseMaterial.update({
              where: { id: captured.material.id },
              data: { optimizedUrl, optimizationReceipt: receipt },
            });
            await completeDurableQueueJob(database, bound);
          },
        });
      } catch (error) {
        await assertWrites();
        throw error;
      }
    },
  });
}
