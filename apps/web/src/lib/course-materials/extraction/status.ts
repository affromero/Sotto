import type { Prisma } from '@/generated/prisma/client';
import {
  materialPageTextManifestSchema,
  materialEmbeddedTextStateSchema,
  materialVisualCoverageSchema,
} from '@sotto/shared';

/** Read projections expose processing gaps and source positions without private workspace paths. */
export async function readMaterialProcessing(
  database: Prisma.TransactionClient,
  userId: string,
  materialId: string,
  afterPage = 0
) {
  const material = await database.courseMaterial.findFirst({
    where: { id: materialId, userId, originalUrl: { not: null } },
  });
  if (!material) return null;
  const run = await database.materialExtractionRun.findUnique({
    where: {
      materialId_processingRevision: {
        materialId,
        processingRevision: material.processingRevision,
      },
    },
    include: {
      pages: {
        where: { pageNumber: { gt: afterPage } },
        orderBy: { pageNumber: 'asc' },
        take: 101,
        include: {
          textStreams: { select: { id: true, manifest: true } },
          recognitions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, mode: true, status: true, admittedAt: true, settledAt: true },
          },
        },
      },
    },
  });
  const pages =
    run?.pages.slice(0, 100).map((page) => ({
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      rotation: page.rotation,
      embeddedText: materialEmbeddedTextStateSchema.parse(page.embeddedText),
      visual: materialVisualCoverageSchema.parse(page.visualCoverage),
      recognition: page.recognitions[0] ?? null,
      textStreams: page.textStreams.map((stream) => ({
        id: stream.id,
        ...materialPageTextManifestSchema.parse(stream.manifest),
      })),
    })) ?? [];
  return {
    materialId,
    processingRevision: material.processingRevision,
    originalSha256: material.originalSha256,
    status: material.processingStatus,
    diagnostic: material.processingError,
    optimization: material.optimizationReceipt,
    run: run
      ? {
          id: run.id,
          status: run.status,
          pageCount: run.pageCount,
          coverage: run.coverage,
          extractorVersion: run.extractorVersion,
          rendererVersion: run.rendererVersion,
        }
      : null,
    pages,
    nextPage: run && run.pages.length > 100 ? pages.at(-1)!.pageNumber : null,
  };
}
