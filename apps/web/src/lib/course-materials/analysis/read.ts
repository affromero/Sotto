import {
  materialMergedSourceFocusSchema,
  materialFocusAnalysisCoverageSchema,
  type CefrLevel,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { materialAnalysisStatusIdentity } from './admission';
import { readOwnedMaterialAnalysis } from './persistence';
import {
  MaterialAnalysisConflict,
  materialAnalysisBytesHash,
  readMaterialAnalysisChunk,
} from './inventory';
import { prepareMaterialFocusChunk, validateMaterialFocusCitation } from './protocol';
import { captureMaterialAnalysisJobAuthority } from '../jobs/analysis-authority';

export async function readMaterialAnalysisStatus(
  database: Prisma.TransactionClient,
  input: {
    analysisId: string;
    userId: string;
    afterOrder?: number;
  }
) {
  const row = await database.materialAnalysis.findFirst({
    where: { id: input.analysisId, userId: input.userId },
    include: {
      sources: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          sourceId: true,
          kind: true,
          name: true,
          materialId: true,
          processingRevision: true,
          material: { select: { processingStatus: true, processingRevision: true } },
        },
      },
    },
  });
  if (!row) throw new MaterialAnalysisConflict('Analysis not found.', 404);
  let stale = false;
  try {
    await readOwnedMaterialAnalysis(database, input);
  } catch (error) {
    if (!(error instanceof MaterialAnalysisConflict)) throw error;
    stale = true;
  }
  const focuses = await database.materialSourceFocus.findMany({
    where: { analysisId: row.id, order: { gt: input.afterOrder ?? -1 } },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    take: 51,
    select: {
      id: true,
      order: true,
      title: true,
      kind: true,
      level: true,
      objectiveIds: true,
      detailsSha256: true,
    },
  });
  const units = await database.materialAnalysisUnit.groupBy({
    by: ['status'],
    where: { analysisId: row.id },
    _count: true,
  });
  const policy =
    row.policy && typeof row.policy === 'object' && !Array.isArray(row.policy) ? row.policy : null;
  const selection =
    policy?.selection && typeof policy.selection === 'object' && !Array.isArray(policy.selection)
      ? policy.selection
      : null;
  return {
    ...materialAnalysisStatusIdentity(row),
    retryOfAnalysisId: row.retryOfAnalysisId,
    counts: row.retryCounts,
    stale,
    coverage: row.coverage,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    courseId: row.attachedCourseId ?? row.intendedCourseId,
    native: row.nativeLang,
    target: row.targetLang,
    provider: typeof selection?.provider === 'string' ? selection.provider : null,
    model: typeof selection?.model === 'string' ? selection.model : null,
    sources: row.sources.map((source) => ({
      sourceId: source.materialId ?? source.sourceId,
      kind: source.kind,
      name: source.name,
      materialId: source.materialId,
      processingRevision: source.processingRevision,
      processingStatus: source.material?.processingStatus ?? null,
      currentProcessingRevision: source.material?.processingRevision ?? source.processingRevision,
      fileUrl: source.materialId ? `/api/v1/materials/${source.materialId}/file` : null,
    })),
    units: units.map((unit) => ({ status: unit.status, count: unit._count })),
    focuses: focuses.slice(0, 50).map((focus) => ({
      ...focus,
      focusDigest: focus.detailsSha256,
      detailUrl: `/api/v1/material-analyses/${row.id}/focuses/${focus.id}`,
    })),
    nextCursor: focuses.length > 50 ? String(focuses[49]!.order) : null,
  };
}

/** This trusted read revalidates exact source generations and returns original private receipt bytes. */
export async function readOwnedMaterialSourceFocus(
  database: Prisma.TransactionClient,
  input: {
    id: string;
    userId: string;
    courseId: string;
    targetLang: string;
    level: CefrLevel;
  }
) {
  return readVerifiedMaterialSourceFocus(database, input);
}

export async function readOwnedMaterialFocusDetail(
  database: Prisma.TransactionClient,
  input: { id: string; userId: string; analysisId: string }
) {
  const result = await readVerifiedMaterialSourceFocus(database, input);
  return {
    analysisId: result.analysisId,
    analysisRevision: result.analysisRevision,
    resultDigest: result.resultDigest,
    focusDigest: result.focusDigest,
    focus: result.details,
    coverage: result.coverage,
  };
}

async function readVerifiedMaterialSourceFocus(
  database: Prisma.TransactionClient,
  input: {
    id: string;
    userId: string;
    analysisId?: string;
    courseId?: string;
    targetLang?: string;
    level?: CefrLevel;
  }
) {
  const focus = await database.materialSourceFocus.findFirst({
    where: {
      id: input.id,
      ...(input.analysisId ? { analysisId: input.analysisId } : {}),
      analysis: {
        userId: input.userId,
        ...(input.courseId ? { attachedCourseId: input.courseId } : {}),
        ...(input.targetLang ? { targetLang: input.targetLang } : {}),
        status: { in: ['COMPLETE', 'PARTIAL'] },
      },
    },
  });
  if (!focus) throw new MaterialAnalysisConflict('Source focus not found for this course.', 404);
  const saved = await readOwnedMaterialAnalysis(database, {
    analysisId: focus.analysisId,
    userId: input.userId,
  });
  if (!saved.prepared || !saved.row.resultDigest || !saved.row.coverage)
    throw new MaterialAnalysisConflict('The source focus has no published analysis identity.');
  if (
    !saved.row.resultBytes ||
    materialAnalysisBytesHash(saved.row.resultBytes) !== saved.row.resultDigest
  )
    throw new MaterialAnalysisConflict('The analysis result receipt checksum changed.');
  if (materialAnalysisBytesHash(focus.detailsBytes) !== focus.detailsSha256)
    throw new MaterialAnalysisConflict('The source focus receipt checksum changed.');
  const details = materialMergedSourceFocusSchema.parse(
    JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(focus.detailsBytes)
    )
  );
  if (details.id !== focus.localKey || details.title !== focus.title || details.kind !== focus.kind)
    throw new MaterialAnalysisConflict('The source focus projection changed.');
  const selected =
    saved.catalog?.nodes.filter(
      (node) =>
        node.kind === 'OBJECTIVE' &&
        node.level === input.level &&
        details.objectiveCandidates.some(
          (candidate) =>
            candidate.objectiveId === node.id &&
            candidate.criterionVersion === node.criterionVersion
        )
    ) ?? [];
  const pieces: string[] = [];
  let points = 0;
  let includedCitationCount = 0;
  const cache = new Map<string, string>();
  for (const citation of details.citations) {
    const unit = saved.prepared.units.find((value) => value.id === citation.unitId);
    if (!unit)
      throw new MaterialAnalysisConflict(
        'The focus citation is outside its sealed source inventory.'
      );
    const chunks = [];
    for (const id of [unit.previousId, unit.id, unit.nextId]) {
      if (!id) continue;
      const windowUnit = saved.prepared.units.find((value) => value.id === id);
      if (!windowUnit) throw new MaterialAnalysisConflict('The focus source window changed.');
      let text = cache.get(id);
      if (text === undefined) {
        text = await readMaterialAnalysisChunk(database, saved.row, windowUnit);
        cache.set(id, text);
      }
      chunks.push({ unitId: id, text });
    }
    const prepared = prepareMaterialFocusChunk({
      analysis: saved.prepared,
      unitId: unit.id,
      chunks,
    });
    validateMaterialFocusCitation(prepared, citation);
    while (cache.size > 32) cache.delete(cache.keys().next().value!);
    const quote = citation.quote.replaceAll('\u0000', '\\u0000');
    const piece = `[Source ${citation.sourceId}, page ${citation.pageNumber}, ${citation.origin}${details.uncertainSource ? ', uncertain transcription' : ''}]\n${quote}`;
    if (points + [...piece].length + 2 <= 12000) {
      points += [...piece].length + 2;
      pieces.push(piece);
      includedCitationCount += 1;
    }
  }
  if (!pieces.length)
    throw new MaterialAnalysisConflict('This source focus has no readable checked citation.');
  return {
    id: focus.id,
    analysisId: saved.row.id,
    analysisRevision: saved.row.revision,
    resultDigest: saved.row.resultDigest,
    focusDigest: focus.detailsSha256,
    detailsBase64: Buffer.from(focus.detailsBytes).toString('base64'),
    details,
    objectiveIds: selected.map((node) => node.id),
    sourceContext: pieces.join('\n\n'),
    includedCitationCount,
    contextTruncated: includedCitationCount < details.citations.length,
    sourceScopes: (
      await captureMaterialAnalysisJobAuthority(database, {
        userId: input.userId,
        analysisId: saved.row.id,
      })
    ).scopes,
    coverage: materialFocusAnalysisCoverageSchema.parse(saved.row.coverage),
  };
}
