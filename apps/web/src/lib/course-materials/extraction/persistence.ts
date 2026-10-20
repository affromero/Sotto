import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  materialPageTextManifestSchema,
  materialVisualCoverageSchema,
  materialExtractionLedgerSchema,
  type MaterialPageTextManifest,
  type MaterialTextChunk,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { createMaterialTextChunkValidator } from './chunks';
import { materialExtractionCoverage } from './coverage';
import { materialPdfPageSchema } from './pdf-protocol';
import { enqueueMaterialVocabularyIndex } from '@/lib/vocabulary/index-admission';

const renderIdentitySchema = z
  .object({
    originalSha256: z.string().regex(/^[a-f0-9]{64}$/),
    rendererVersion: z.string().min(1),
    page: materialPdfPageSchema,
  })
  .strict();
const terminalStatuses = new Set(['COMPLETE', 'PARTIAL', 'FAILED', 'RECOVERY_REQUIRED']);

export interface MaterialRunIdentity {
  userId: string;
  materialId: string;
  runId: string;
  processingRevision: number;
  originalSha256: string;
}

/** All publication callers already hold their durable job/provider authority. */
export async function requireMaterialRun(
  database: Prisma.TransactionClient,
  input: MaterialRunIdentity
) {
  await database.$queryRaw`SELECT id FROM "CourseMaterial" WHERE id = ${input.materialId} FOR UPDATE`;
  const run = await database.materialExtractionRun.findFirst({
    where: {
      id: input.runId,
      materialId: input.materialId,
      originalSha256: input.originalSha256,
      processingRevision: input.processingRevision,
      material: {
        userId: input.userId,
        processingRevision: input.processingRevision,
        originalSha256: input.originalSha256,
        originalUrl: { not: null },
      },
    },
  });
  if (!run) throw new Error('Material extraction identity or ownership changed.');
  return run;
}

export async function initializeMaterialPages(
  database: Prisma.TransactionClient,
  input: MaterialRunIdentity,
  pageCount: number
) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 10000)
    throw new Error('The material page inventory exceeds its declared processing limit.');
  const run = await requireMaterialRun(database, input);
  if (run.pageCount !== null && run.pageCount !== pageCount)
    throw new Error('A material extraction cannot change its original page count.');
  if (terminalStatuses.has(run.status)) {
    if (
      run.pageCount !== pageCount ||
      (await database.materialPage.count({ where: { runId: run.id } })) !== pageCount
    )
      throw new Error('A completed extraction has an inconsistent page inventory.');
    return;
  }
  await database.materialExtractionRun.update({
    where: { id: run.id },
    data: { pageCount, status: 'EXTRACTING' },
  });
  await database.courseMaterial.update({
    where: { id: input.materialId },
    data: {
      processingStatus: 'EXTRACTING',
      processingError: null,
    },
  });
  for (let first = 1; first <= pageCount; first += 100)
    await database.materialPage.createMany({
      data: Array.from({ length: Math.min(100, pageCount - first + 1) }, (_, offset) => ({
        runId: run.id,
        pageNumber: first + offset,
        embeddedText: { state: 'PENDING' },
        visualCoverage: { state: 'UNASSESSED' },
      })),
      skipDuplicates: true,
    });
}

/** A manifest and all of its exact Unicode chunks are one immutable publication. */
export async function publishMaterialPageText(
  database: Prisma.TransactionClient,
  input: MaterialRunIdentity,
  manifestInput: MaterialPageTextManifest,
  chunks: Iterable<MaterialTextChunk> | AsyncIterable<MaterialTextChunk>
) {
  const manifest = materialPageTextManifestSchema.parse(manifestInput);
  if (manifest.utf8ByteLength > 64 * 1024 * 1024 || manifest.chunkCount > 8192)
    throw new Error(
      'This page exceeds the explicit text processing budget. The complete original remains retained.'
    );
  const run = await requireMaterialRun(database, input);
  const page = await database.materialPage.findUnique({
    where: { runId_pageNumber: { runId: run.id, pageNumber: manifest.pageNumber } },
  });
  if (!page || run.pageCount === null || page.pageNumber > run.pageCount)
    throw new Error('Inventory each original page before publishing its extracted text.');
  const prior = await database.materialPageText.findUnique({
    where: { pageId_origin: { pageId: page.id, origin: manifest.source.origin } },
  });
  const validator = createMaterialTextChunkValidator(manifest);
  if (prior) {
    if (!isDeepStrictEqual(prior.manifest, manifest))
      throw new Error('A published text origin cannot be overwritten by a different extraction.');
    if (
      (await database.materialTextChunk.count({ where: { streamId: prior.id } })) !==
      manifest.chunkCount
    )
      throw new Error('A saved material text stream has incomplete chunk coverage.');
    for await (const chunk of chunks) validator.accept(chunk);
    validator.finish();
    return prior;
  }
  if (terminalStatuses.has(run.status))
    throw new Error('Publish a new extraction revision before changing completed page content.');
  const stream = await database.materialPageText.create({
    data: { pageId: page.id, origin: manifest.source.origin, manifest },
  });
  let pending: Prisma.MaterialTextChunkCreateManyInput[] = [];
  for await (const chunk of chunks) {
    validator.accept(chunk);
    pending.push({
      streamId: stream.id,
      index: chunk.index,
      codePointStart: chunk.codePointStart,
      codePointEnd: chunk.codePointEnd,
      utf8ByteStart: chunk.utf8ByteStart,
      utf8ByteEnd: chunk.utf8ByteEnd,
      sha256: chunk.sha256,
      textBytes: Buffer.from(chunk.text, 'utf8'),
    });
    if (pending.length === 50) {
      await database.materialTextChunk.createMany({ data: pending });
      pending = [];
    }
  }
  if (pending.length) await database.materialTextChunk.createMany({ data: pending });
  validator.finish();
  if (manifest.source.origin === 'EMBEDDED_TEXT')
    await database.materialPage.update({
      where: { id: page.id },
      data: { embeddedText: { state: 'EXTRACTED' } },
    });
  return stream;
}

async function enqueueAttachedVocabulary(
  database: Prisma.TransactionClient,
  input: MaterialRunIdentity
) {
  const material = await database.courseMaterial.findUniqueOrThrow({
    where: { id: input.materialId },
    select: { courseId: true },
  });
  if (material.courseId)
    await enqueueMaterialVocabularyIndex(database, input.materialId, input.userId);
}

/** Completeness comes from every page's saved coverage, independently of readable previews. */
export async function finishMaterialExtraction(
  database: Prisma.TransactionClient,
  input: MaterialRunIdentity
) {
  const run = await requireMaterialRun(database, input);
  const pages = await database.materialPage.findMany({
    where: { runId: run.id },
    orderBy: { pageNumber: 'asc' },
    include: { textStreams: { select: { manifest: true } } },
  });
  const ledger = materialExtractionLedgerSchema.parse({
    schemaVersion: 1,
    materialSha256: input.originalSha256,
    extractor: { method: 'sotto-complete-source-extraction', version: run.extractorVersion },
    pageCount: run.pageCount,
    pages: pages.map((page) => {
      const visual = materialVisualCoverageSchema.parse(page.visualCoverage);
      if (['TEXT_COVERED', 'RECOGNIZED', 'BLANK'].includes(visual.state)) {
        const render = renderIdentitySchema.parse(page.renderIdentity);
        if (
          !('pageImageSha256' in visual) ||
          !page.pageImageSha256 ||
          visual.pageImageSha256 !== page.pageImageSha256 ||
          render.originalSha256 !== run.originalSha256 ||
          render.rendererVersion !== run.rendererVersion ||
          render.page.pageNumber !== page.pageNumber ||
          render.page.image?.sha256 !== page.pageImageSha256
        )
          throw new Error('Visual coverage is not bound to this original page render.');
      }
      return {
        pageNumber: page.pageNumber,
        embeddedText: page.embeddedText,
        visual,
        textStreams: page.textStreams.map((stream) =>
          materialPageTextManifestSchema.parse(stream.manifest)
        ),
      };
    }),
  });
  const coverage = materialExtractionCoverage(ledger);
  if (terminalStatuses.has(run.status)) {
    if (!['COMPLETE', 'PARTIAL'].includes(run.status) || !isDeepStrictEqual(run.coverage, coverage))
      throw new Error('A completed extraction coverage receipt changed.');
    await enqueueAttachedVocabulary(database, input);
    return coverage;
  }
  await database.materialExtractionRun.update({
    where: { id: run.id },
    data: {
      status: coverage.coverageComplete ? 'COMPLETE' : 'PARTIAL',
      coverage,
      completedAt: new Date(),
      failureReason: coverage.coverageComplete
        ? null
        : 'Some original page content remains unresolved.',
    },
  });
  await database.courseMaterial.update({
    where: { id: input.materialId },
    data: {
      processingStatus: coverage.coverageComplete ? 'READY' : 'PARTIAL',
      processingError: coverage.coverageComplete
        ? null
        : 'Some original page content remains unresolved.',
    },
  });
  await enqueueAttachedVocabulary(database, input);
  return coverage;
}
