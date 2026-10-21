import { createHash } from 'node:crypto';
import {
  MATERIAL_FOCUS_ANALYSIS_LIMITS,
  materialPageTextManifestSchema,
  materialFocusMaterialSnapshotSchema,
  materialFocusSourceSnapshotSchema,
  type MaterialFocusChunkDescriptor,
  type MaterialFocusSourceSnapshot,
} from '@sotto/shared';
import type { Prisma, MaterialAnalysis, MaterialAnalysisSource } from '@/generated/prisma/client';
import { createMaterialTextChunkValidator } from '../extraction/chunks';
import { decodeMaterialTextChunk } from '../extraction/readers';
import {
  prepareMaterialFocusTextSnapshot,
  materialFocusAnalysisHash,
  type PreparedMaterialFocusAnalysis,
  type MaterialFocusAnalysisUnit,
} from './protocol';

export class MaterialAnalysisConflict extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422 | 429 = 409
  ) {
    super(message);
    this.name = 'MaterialAnalysisConflict';
  }
}
export const materialAnalysisBytesHash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

/** Verify each canonical byte stream once before sealing its complete descriptor inventory. */
async function captureStream(
  database: Prisma.TransactionClient,
  stream: { id: string; manifest: unknown }
) {
  const manifest = materialPageTextManifestSchema.parse(stream.manifest);
  const validator = createMaterialTextChunkValidator(manifest);
  const chunks: MaterialFocusChunkDescriptor[] = [];
  let after = -1;
  while (true) {
    const page = await database.materialTextChunk.findMany({
      where: { streamId: stream.id, index: { gt: after } },
      orderBy: { index: 'asc' },
      take: 100,
    });
    for (const chunk of page) {
      validator.accept({
        schemaVersion: 1,
        pageNumber: manifest.pageNumber,
        origin: manifest.source.origin,
        pageTextSha256: manifest.textSha256,
        index: chunk.index,
        codePointStart: chunk.codePointStart,
        codePointEnd: chunk.codePointEnd,
        utf8ByteStart: chunk.utf8ByteStart,
        utf8ByteEnd: chunk.utf8ByteEnd,
        sha256: chunk.sha256,
        text: decodeMaterialTextChunk(chunk),
      });
      chunks.push({
        chunkIndex: chunk.index,
        chunkSha256: chunk.sha256,
        codePointStart: chunk.codePointStart,
        codePointEnd: chunk.codePointEnd,
        utf8ByteStart: chunk.utf8ByteStart,
        utf8ByteEnd: chunk.utf8ByteEnd,
      });
      if (chunks.length > MATERIAL_FOCUS_ANALYSIS_LIMITS.chunks)
        throw new MaterialAnalysisConflict(
          'The source exceeds the declared analysis chunk budget.',
          422
        );
    }
    if (page.length < 100) break;
    after = page[page.length - 1]!.index;
  }
  validator.finish();
  return { streamId: stream.id, manifest, chunks };
}

/** All retained text origins remain visible, including uncertain recognition. */
export async function captureMaterialAnalysisSource(
  database: Prisma.TransactionClient,
  analysis: MaterialAnalysis,
  source: MaterialAnalysisSource
): Promise<MaterialFocusSourceSnapshot | null> {
  if (source.analysisId !== analysis.id)
    throw new MaterialAnalysisConflict('The analysis source changed.');
  if (source.kind !== 'MATERIAL') {
    if (
      !source.snapshotBytes ||
      !source.snapshotSha256 ||
      materialAnalysisBytesHash(source.snapshotBytes) !== source.snapshotSha256
    )
      throw new MaterialAnalysisConflict('The owned text snapshot checksum changed.');
    if (source.kind !== 'PASTE' && source.kind !== 'COURSE_NOTE')
      throw new MaterialAnalysisConflict('Unsupported source kind.');
    if (source.kind === 'COURSE_NOTE') {
      const note = await database.courseNote.findFirst({
        where: { id: source.noteId ?? '', courseId: analysis.intendedCourseId ?? '' },
      });
      if (!note || BigInt(note.updatedAt.getTime()) !== source.noteGeneration)
        throw new MaterialAnalysisConflict(
          'The course note changed. Analyze its current revision.'
        );
    }
    return prepareMaterialFocusTextSnapshot({
      sourceKind: source.kind,
      sourceId: source.sourceId,
      userId: analysis.userId,
      revision: source.revision,
      name: source.name,
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source.snapshotBytes),
      note:
        source.kind === 'COURSE_NOTE'
          ? { id: source.noteId!, revision: String(source.noteGeneration) }
          : null,
    }).snapshot;
  }
  const material = await database.courseMaterial.findFirst({
    where: { id: source.materialId ?? '', userId: analysis.userId },
  });
  if (
    !material ||
    !material.originalUrl ||
    material.originalSha256 !== source.originalSha256 ||
    BigInt(material.createdAt.getTime()) !== source.materialGeneration ||
    material.processingRevision !== source.processingRevision ||
    (material.courseId !== null &&
      material.courseId !== (analysis.attachedCourseId ?? analysis.intendedCourseId))
  )
    throw new MaterialAnalysisConflict('A selected material changed or belongs to another course.');
  const run = await database.materialExtractionRun.findFirst({
    where: {
      id: source.runId ?? '',
      materialId: material.id,
      processingRevision: material.processingRevision,
      originalSha256: source.originalSha256!,
    },
    include: {
      pages: {
        orderBy: { pageNumber: 'asc' },
        include: { textStreams: { orderBy: { origin: 'asc' } } },
      },
    },
  });
  if (!run) throw new MaterialAnalysisConflict('The selected extraction run is unavailable.');
  if (['PENDING', 'EXTRACTING'].includes(run.status)) return null;
  if (!['COMPLETE', 'PARTIAL'].includes(run.status) || !run.pageCount)
    throw new MaterialAnalysisConflict('Recover the selected material extraction before analysis.');
  const pages = [];
  for (const page of run.pages) {
    const streams = [];
    for (const stream of page.textStreams) streams.push(await captureStream(database, stream));
    pages.push({
      pageNumber: page.pageNumber,
      embeddedText: page.embeddedText,
      visual: page.visualCoverage,
      streams,
    });
  }
  return materialFocusMaterialSnapshotSchema.parse({
    sourceKind: 'MATERIAL',
    materialId: material.id,
    userId: analysis.userId,
    runId: run.id,
    processingRevision: run.processingRevision,
    materialGeneration: material.createdAt.getTime(),
    originalSha256: run.originalSha256,
    name: material.name,
    extractorVersion: run.extractorVersion,
    rendererVersion: run.rendererVersion,
    pageCount: run.pageCount,
    pages,
  });
}

/** Cheap source fencing precedes every paid call and publication; sealed bytes are checked when read. */
export async function validateMaterialAnalysisSources(
  database: Prisma.TransactionClient,
  analysis: MaterialAnalysis
) {
  const user = await database.user.findUnique({
    where: { id: analysis.userId },
    select: { createdAt: true },
  });
  if (!user || BigInt(user.createdAt.getTime()) !== analysis.userGeneration)
    throw new MaterialAnalysisConflict('The analysis owner generation changed.');
  const courseId = analysis.attachedCourseId ?? analysis.intendedCourseId;
  if (
    courseId &&
    !(await database.course.findFirst({
      where: {
        id: courseId,
        userId: analysis.userId,
        nativeLang: analysis.nativeLang,
        targetLang: analysis.targetLang,
      },
    }))
  )
    throw new MaterialAnalysisConflict('The analysis course changed.');
  const sources = await database.materialAnalysisSource.findMany({
    where: { analysisId: analysis.id },
    orderBy: { order: 'asc' },
  });
  if (!sources.length || sources.length > MATERIAL_FOCUS_ANALYSIS_LIMITS.sources)
    throw new MaterialAnalysisConflict('The analysis source set is unavailable.');
  for (const source of sources) {
    if (source.kind === 'MATERIAL') {
      const material = await database.courseMaterial.findFirst({
        where: { id: source.materialId ?? '', userId: analysis.userId },
      });
      if (
        !material?.originalUrl ||
        material.originalSha256 !== source.originalSha256 ||
        BigInt(material.createdAt.getTime()) !== source.materialGeneration ||
        material.processingRevision !== source.processingRevision ||
        (material.courseId !== null && material.courseId !== courseId)
      )
        throw new MaterialAnalysisConflict('A selected material changed after analysis admission.');
      const run = await database.materialExtractionRun.findFirst({
        where: {
          id: source.runId ?? '',
          materialId: material.id,
          processingRevision: source.processingRevision!,
          originalSha256: source.originalSha256!,
        },
      });
      if (!run) throw new MaterialAnalysisConflict('The selected extraction run changed.');
    } else if (source.kind === 'COURSE_NOTE') {
      const note = await database.courseNote.findFirst({
        where: { id: source.noteId ?? '', courseId: analysis.intendedCourseId ?? '' },
      });
      if (!note || BigInt(note.updatedAt.getTime()) !== source.noteGeneration)
        throw new MaterialAnalysisConflict('The analyzed course note was edited.');
    }
    if (source.inventory && materialFocusAnalysisHash(source.inventory) !== source.inventoryDigest)
      throw new MaterialAnalysisConflict('The sealed analysis source inventory changed.');
  }
  return sources;
}

export async function readMaterialAnalysisChunk(
  database: Prisma.TransactionClient,
  analysis: MaterialAnalysis,
  unit: MaterialFocusAnalysisUnit
) {
  const source = unit.source;
  if (source.sourceKind === 'MATERIAL') {
    const chunk = await database.materialTextChunk.findFirst({
      where: {
        streamId: source.streamId,
        index: source.chunkIndex,
        stream: {
          page: {
            runId: source.runId!,
            pageNumber: source.pageNumber,
            run: { material: { userId: analysis.userId } },
          },
        },
      },
    });
    if (
      !chunk ||
      chunk.sha256 !== source.chunkSha256 ||
      chunk.codePointStart !== source.codePointStart ||
      chunk.codePointEnd !== source.codePointEnd ||
      chunk.utf8ByteStart !== source.utf8ByteStart ||
      chunk.utf8ByteEnd !== source.utf8ByteEnd
    )
      throw new MaterialAnalysisConflict('The exact source chunk changed.');
    return decodeMaterialTextChunk(chunk);
  }
  const snapshot = await database.materialAnalysisSource.findFirst({
    where: { sourceId: source.sourceId, analysisId: analysis.id },
  });
  if (
    !snapshot?.snapshotBytes ||
    materialAnalysisBytesHash(snapshot.snapshotBytes) !== source.sourceSha256
  )
    throw new MaterialAnalysisConflict('The exact text snapshot changed.');
  const bytes = snapshot.snapshotBytes.subarray(source.utf8ByteStart, source.utf8ByteEnd);
  if (materialAnalysisBytesHash(bytes) !== source.chunkSha256)
    throw new MaterialAnalysisConflict('The text snapshot chunk changed.');
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

export async function readMaterialAnalysisWindow(
  database: Prisma.TransactionClient,
  analysis: MaterialAnalysis,
  prepared: PreparedMaterialFocusAnalysis,
  unit: MaterialFocusAnalysisUnit
) {
  const chunks = [];
  for (const id of [unit.previousId, unit.id, unit.nextId]) {
    if (!id) continue;
    const selected = prepared.units.find((item) => item.id === id);
    if (!selected) throw new MaterialAnalysisConflict('The source window inventory changed.');
    chunks.push({
      unitId: id,
      text: await readMaterialAnalysisChunk(database, analysis, selected),
    });
  }
  return chunks;
}

export function readMaterialAnalysisSourceInventory(source: MaterialAnalysisSource) {
  const inventory = materialFocusSourceSnapshotSchema.parse(source.inventory);
  if (materialFocusAnalysisHash(inventory) !== source.inventoryDigest)
    throw new MaterialAnalysisConflict('The source inventory checksum changed.');
  return inventory;
}
