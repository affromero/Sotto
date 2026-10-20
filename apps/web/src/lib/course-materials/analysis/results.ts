import {
  learningLevels,
  materialFocusAnalysisCoverageSchema,
  materialMergedSourceFocusSchema,
  type MaterialMergedSourceFocus,
  type MaterialFocusChunkReceipt,
  type CefrLevel,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { mergeMaterialSourceFocuses } from './merge';
import {
  decodeMaterialAnalysisUnitOutput,
  requireMaterialAnalysis,
  readMaterialAnalysisEffectiveUnits,
  type MaterialAnalysisAuthority,
} from './persistence';
import { materialFocusAnalysisHash } from './protocol';
import { materialAnalysisBytesHash, MaterialAnalysisConflict } from './inventory';

/** A source-level suggestion describes the materials. It creates no proficiency evidence. */
export function inferMaterialPlacement(
  focuses: readonly MaterialMergedSourceFocus[],
  coverageInput: unknown
) {
  const coverage = materialFocusAnalysisCoverageSchema.parse(coverageInput);
  const counts = new Map<CefrLevel, number>();
  for (const focus of focuses) {
    if (focus.uncertainSource) continue;
    const levels = [...new Set(focus.objectiveCandidates.map((candidate) => candidate.level))]
      .filter((level): level is CefrLevel => learningLevels.includes(level as CefrLevel))
      .sort((left, right) => learningLevels.indexOf(left) - learningLevels.indexOf(right));
    if (!levels.length) continue;
    const level = levels[Math.floor((levels.length - 1) / 2)]!;
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  const supported = learningLevels.flatMap((level) =>
    Array<CefrLevel>(counts.get(level) ?? 0).fill(level)
  );
  if (!supported.length) return null;
  const level = supported[Math.floor((supported.length - 1) / 2)]!;
  const first = supported[0]!,
    last = supported[supported.length - 1]!;
  const complete = coverage.originalContentComplete;
  return {
    level,
    confidence: Math.min(
      complete ? 0.75 : 0.45,
      (0.35 + (0.4 * (counts.get(level) ?? 0)) / supported.length) *
        (coverage.expectedChunks ? coverage.analyzedChunks / coverage.expectedChunks : 0)
    ),
    rationale: `The source focuses suggest ${level}. ${supported.length} source class occurrences have mapped level candidates, spanning ${first} to ${last}. This estimates the materials' difficulty. Your objectives remain unassessed.`,
    levelRange: { from: first, to: last },
    source: 'MATERIAL_FOCUS_INFERENCE' as const,
    originalContentComplete: complete,
  };
}

/** Publish complete source occurrence history and exposure atomically, without mastery writes. */
export async function publishMaterialAnalysis(
  database: Prisma.TransactionClient,
  context: MaterialAnalysisAuthority
) {
  const saved = await requireMaterialAnalysis(database, context);
  if (!saved.prepared)
    throw new MaterialAnalysisConflict('The analysis source inventory is not sealed.');
  if (!['RUNNING', 'WAITING_SOURCE'].includes(saved.row.status)) return saved.row;
  const units = await readMaterialAnalysisEffectiveUnits(database, context);
  const receipts: MaterialFocusChunkReceipt[] = units.map((unit) => ({
    unitId: unit.unitKey,
    inputDigest: unit.inputDigest,
    status:
      unit.status === 'ANALYZED'
        ? 'ANALYZED'
        : ['UNKNOWN', 'DISPATCHING'].includes(unit.status)
          ? 'UNKNOWN'
          : ['FAILED', 'OUTPUT_INVALID'].includes(unit.status)
            ? 'FAILED'
            : 'PENDING',
    resultSha256:
      unit.status === 'ANALYZED'
        ? materialFocusAnalysisHash(decodeMaterialAnalysisUnitOutput(unit))
        : null,
    diagnostic:
      unit.status === 'ANALYZED' ? null : `Source analysis unit ${unit.status.toLowerCase()}.`,
  }));
  const merged = mergeMaterialSourceFocuses({
    analysis: saved.prepared,
    catalog: saved.catalog,
    results: units
      .filter((unit) => unit.status === 'ANALYZED')
      .map(decodeMaterialAnalysisUnitOutput),
    receipts,
  });
  if (merged.coverage.pendingUnitIds.length)
    throw new MaterialAnalysisConflict('Analyze every retained chunk before final publication.');
  const focuses = merged.focuses.map((focus) => materialMergedSourceFocusSchema.parse(focus));
  const inference = inferMaterialPlacement(focuses, merged.coverage);
  const result = { ...merged, inference };
  const bytes = Buffer.from(JSON.stringify(result), 'utf8');
  if (bytes.length > 32 * 1024 * 1024 || focuses.length > 20000)
    throw new MaterialAnalysisConflict(
      'The complete focus result exceeds the declared publication budget. Saved chunks and originals remain retained.',
      422
    );
  for (const focus of focuses) {
    const details = Buffer.from(JSON.stringify(focus), 'utf8');
    if (details.length > 1024 * 1024)
      throw new MaterialAnalysisConflict(
        'An original source class exceeds the per-focus detail budget.',
        422
      );
    const levels = [...new Set(focus.objectiveCandidates.map((candidate) => candidate.level))];
    await database.materialSourceFocus.create({
      data: {
        id: materialFocusAnalysisHash({ analysisId: saved.row.id, semanticFocusId: focus.id }),
        analysisId: saved.row.id,
        localKey: focus.id,
        order: focus.order,
        title: focus.title,
        kind: focus.kind,
        level: levels.length === 1 ? levels[0] : null,
        objectiveIds: [
          ...new Set(focus.objectiveCandidates.map((candidate) => candidate.objectiveId)),
        ],
        detailsBytes: Uint8Array.from(details),
        detailsSha256: materialAnalysisBytesHash(details),
      },
    });
  }
  const status =
    merged.coverage.status === 'INSUFFICIENT_SOURCE'
      ? 'INSUFFICIENT_SOURCE'
      : merged.coverage.originalContentComplete
        ? 'COMPLETE'
        : 'PARTIAL';
  return database.materialAnalysis.update({
    where: { id: saved.row.id },
    data: {
      status,
      completedAt: new Date(),
      resultBytes: Uint8Array.from(bytes),
      resultDigest: materialAnalysisBytesHash(bytes),
      coverage: merged.coverage,
      summary: { focusCount: focuses.length, inference, exposureOnly: true },
      failureReason: null,
    },
  });
}
