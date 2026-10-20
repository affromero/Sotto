import { isDeepStrictEqual } from 'node:util';
import { statfs } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { materialVisualCoverageSchema } from '@sotto/shared';
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
  durableJobProviderExecution,
  bindDurableQueueCleanup,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  resolveStorageInput,
  validateStorageInputs,
} from '@/lib/sidedoor/storage/core/storage-inputs';
import { materialExtractionPayloadSchema, materialExtractionRunKey } from './admission';
import { isTextMaterial } from '@/lib/note-upload';
import { extractMaterialText } from './runtime/text';
import { extractMaterialPdf } from './pdf';
import { materialPdfPageSchema, materialPdfDefaultLimits } from './pdf-protocol';
import { readMaterialArtifact, readMaterialChunkArtifact } from './artifacts';
import {
  initializeMaterialPages,
  publishMaterialPageText,
  finishMaterialExtraction,
  requireMaterialRun,
} from './persistence';
import {
  materialRecognitionPolicySchema,
  materialEmbeddedOnlyPolicySchema,
} from '../recognition/policy';
import { recognizeMaterialPage } from '../recognition/pages';

async function readExtraction(
  database: Parameters<typeof requireMaterialRun>[0],
  job: Job<unknown>
) {
  const work = await loadDurableQueueJob(database, job, 'material-extraction', 1);
  if (work.complete) return work;
  const payload = materialExtractionPayloadSchema.parse(work.payload.payload);
  const identity = { ...payload, originalSha256: payload.inputSha256 };
  const run = await requireMaterialRun(database, identity);
  const recognition = materialRecognitionPolicySchema.safeParse(run.recognitionPolicy);
  if (!recognition.success) materialEmbeddedOnlyPolicySchema.parse(run.recognitionPolicy);
  if (
    materialExtractionRunKey({
      ...run,
      recognition: recognition.success ? recognition.data : undefined,
    }) !== run.runKey ||
    !isDeepStrictEqual(
      run.providerSelection,
      recognition.success ? recognition.data.selection : null
    )
  )
    throw new Error('The admitted material extraction policy or model selection changed.');
  const material = await database.courseMaterial.findUniqueOrThrow({
    where: { id: payload.materialId },
  });
  if (!material.originalUrl) throw new Error('The original material is unavailable.');
  const source = await resolveStorageInput(database, {
    consumer: `material:${material.id}:original`,
    reference: material.originalUrl,
  });
  return { ...work, payload: work.payload, input: payload, identity, run, material, source };
}

/** Sequential page work leaves immutable text receipts and an honest visual coverage ledger. */
export async function processMaterialExtraction(
  job: Job<unknown>,
  signal = AbortSignal.timeout(7_200_000)
) {
  const captured = await sottoTransaction(prisma, (database) => readExtraction(database, job), {
    signal,
  });
  if (captured.complete) return;
  const bound = bindDurableQueueJob(job, captured.input, captured);
  await withSottoJobExecution({
    database: prisma,
    parentId: captured.operationId,
    fingerprint: captured.fingerprint,
    signal,
    isCleanupFailure: (error) =>
      isDurableQueueCleanupFailure(error) || isMediaCleanupFailure(error),
    validate: async (database) => {
      const current = await readExtraction(database, job);
      if (current.complete) return false;
      if (
        current.run.runKey !== captured.run.runKey ||
        current.material.originalUrl !== captured.material.originalUrl ||
        !isDeepStrictEqual(current.source, captured.source)
      )
        throw new Error('Material extraction inputs changed.');
      return true;
    },
    run: async ({ directory, markCleanupUnconfirmed }) => {
      bindDurableQueueCleanup(bound, markCleanupUnconfirmed);
      const recognition = materialRecognitionPolicySchema.safeParse(captured.run.recognitionPolicy);
      if (!recognition.success)
        materialEmbeddedOnlyPolicySchema.parse(captured.run.recognitionPolicy);
      if (['COMPLETE', 'PARTIAL'].includes(captured.run.status)) {
        await sottoTransaction(
          prisma,
          async (database) => {
            await requireMaterialRun(database, captured.identity);
            await completeDurableQueueJob(database, bound);
          },
          { signal }
        );
        return;
      }
      if (['FAILED', 'RECOVERY_REQUIRED'].includes(captured.run.status))
        throw new Error('This material extraction revision needs explicit recovery.');
      const textSource = isTextMaterial(captured.material.name, captured.material.mimeType);
      if (
        !textSource &&
        captured.material.mimeType !== 'application/pdf' &&
        !/\.pdf$/i.test(captured.material.name)
      )
        throw new Error(
          'This original format is not supported by complete PDF or text extraction.'
        );
      const disk = await statfs(directory);
      if (
        disk.bavail * disk.bsize <
        captured.material.byteSize + materialPdfDefaultLimits.maxArtifactBytes + 64 * 1024 * 1024
      )
        throw new Error('Insufficient free disk for the declared complete PDF processing budget.');
      const originalPath = join(directory, 'original.pdf');
      try {
        const backend = await restoreStorageBackend(captured.source.backend.descriptor);
        await backend.downloadToFile(captured.source.input.key, originalPath, signal);
      } catch (error) {
        if (error instanceof StorageReadCleanupError) markCleanupUnconfirmed();
        throw error;
      }
      if (textSource) {
        const prepared = await extractMaterialText(
          originalPath,
          captured.input.inputSha256,
          signal
        );
        await sottoTransaction(
          prisma,
          async (database) => {
            await validateStorageInputs(database, [captured.source.input]);
            await initializeMaterialPages(database, captured.identity, 1);
            await publishMaterialPageText(
              database,
              captured.identity,
              prepared.manifest,
              prepared.chunks
            );
            await database.materialPage.updateMany({
              where: { runId: captured.run.id },
              data: {
                visualCoverage: {
                  state: 'TEXT_SOURCE',
                  originalSha256: captured.input.inputSha256,
                  diagnostic:
                    'The complete original UTF-8 source is retained without a visual layer.',
                },
              },
            });
            await finishMaterialExtraction(database, captured.identity);
            await completeDurableQueueJob(database, bound);
          },
          { signal, timeoutMs: 60000 }
        );
        return;
      }
      const extracted = await extractMaterialPdf({
        pdfPath: originalPath,
        executionDirectory: directory,
        expectedSha256: captured.input.inputSha256,
        signal,
        ...(recognition.success ? { limits: { renderScale: recognition.data.renderScale } } : {}),
      });
      await sottoTransaction(
        prisma,
        async (database) => {
          await validateStorageInputs(database, [captured.source.input]);
          await initializeMaterialPages(database, captured.identity, extracted.result.pageCount);
        },
        { signal }
      );
      for (const artifact of extracted.result.pages) {
        signal.throwIfAborted();
        const bytes = await readMaterialArtifact(extracted.directory, artifact, 32768);
        const page = materialPdfPageSchema.parse(JSON.parse(bytes.toString('utf8')));
        if (page.pageNumber !== artifact.pageNumber)
          throw new Error('Material page identity changed.');
        await sottoTransaction(
          prisma,
          async (database) => {
            await requireMaterialRun(database, captured.identity);
            const prior = await database.materialPage.findUniqueOrThrow({
              where: { runId_pageNumber: { runId: captured.run.id, pageNumber: page.pageNumber } },
            });
            const renderIdentity = {
              originalSha256: captured.input.inputSha256,
              rendererVersion: captured.run.rendererVersion,
              page,
            };
            if (prior.renderIdentity && !isDeepStrictEqual(prior.renderIdentity, renderIdentity))
              throw new Error('A material page cannot change its retained render identity.');
            if (page.text.manifest && page.text.chunksArtifact)
              await publishMaterialPageText(
                database,
                captured.identity,
                page.text.manifest,
                readMaterialChunkArtifact(extracted.directory, page.text.chunksArtifact, signal)
              );
            else if (page.text.state === 'EXTRACTED')
              throw new Error('An extracted page is missing its complete text artifact.');
            await database.materialPage.update({
              where: { id: prior.id },
              data: {
                width: page.width,
                height: page.height,
                rotation: page.rotation,
                pageImageSha256: page.image?.sha256 ?? null,
                renderIdentity,
                embeddedText:
                  page.text.state === 'EXTRACTED'
                    ? { state: 'EXTRACTED' }
                    : {
                        state: 'FAILED',
                        diagnostic:
                          'The complete embedded text could not be extracted from this page.',
                      },
                visualCoverage: prior.renderIdentity
                  ? materialVisualCoverageSchema.parse(prior.visualCoverage)
                  : {
                      state: 'UNAVAILABLE',
                      diagnostic: page.image
                        ? 'Full-page recognition requires an explicitly configured supported provider.'
                        : 'The original page could not be rendered within the declared processing limits.',
                    },
              },
            });
          },
          { signal, timeoutMs: 60000 }
        );
        if (recognition.success)
          await recognizeMaterialPage({
            run: captured.identity,
            policy: recognition.data,
            page,
            directory: extracted.directory,
            execution: durableJobProviderExecution(bound, captured.input.userId, signal),
            unresolved: markCleanupUnconfirmed,
          });
        await job.updateProgress(Math.floor((95 * page.pageNumber) / extracted.result.pageCount));
      }
      if (extracted.result.unprocessed) {
        await sottoTransaction(
          prisma,
          async (database) => {
            await requireMaterialRun(database, captured.identity);
            await database.materialPage.updateMany({
              where: {
                runId: captured.run.id,
                pageNumber: { gte: extracted.result.unprocessed!.firstPage },
              },
              data: {
                embeddedText: {
                  state: 'FAILED',
                  diagnostic: 'This page exceeds the declared PDF page processing limit.',
                },
                visualCoverage: {
                  state: 'UNAVAILABLE',
                  diagnostic: 'This page exceeds the declared PDF page processing limit.',
                },
              },
            });
          },
          { signal }
        );
      }
      await sottoTransaction(
        prisma,
        async (database) => {
          await validateStorageInputs(database, [captured.source.input]);
          await finishMaterialExtraction(database, captured.identity);
          await completeDurableQueueJob(database, bound);
        },
        { signal }
      );
    },
  });
}
