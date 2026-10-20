import {
  materialFocusMergedResultSchema,
  placementInferenceSchema,
  type PlacementAnalysisReference,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { readOwnedMaterialAnalysis } from '@/lib/course-materials/analysis/persistence';
import {
  MaterialAnalysisConflict,
  materialAnalysisBytesHash,
} from '@/lib/course-materials/analysis/inventory';

const resultSchema = materialFocusMergedResultSchema.extend({
  inference: placementInferenceSchema.nullable(),
});
/** A source suggestion is read from its checksummed immutable receipt, never a pair cache or mutable summary. */
export async function readPlacementAnalysis(
  database: Prisma.TransactionClient,
  input: {
    userId: string;
    native: string;
    target: string;
    reference: PlacementAnalysisReference;
    acceptPartial: boolean;
  }
) {
  const saved = await readOwnedMaterialAnalysis(database, {
    userId: input.userId,
    analysisId: input.reference.analysisId,
  });
  const row = saved.row;
  if (
    row.nativeLang !== input.native ||
    row.targetLang !== input.target ||
    row.revision !== input.reference.analysisRevision ||
    row.resultDigest !== input.reference.resultDigest ||
    !row.resultBytes ||
    materialAnalysisBytesHash(row.resultBytes) !== row.resultDigest
  )
    throw new MaterialAnalysisConflict('The source analysis receipt changed.');
  if (!['COMPLETE', 'PARTIAL'].includes(row.status))
    throw new MaterialAnalysisConflict(
      'Complete source analysis before choosing a starting level.'
    );
  if (row.status === 'PARTIAL' && !input.acceptPartial)
    throw new MaterialAnalysisConflict(
      'This analysis has unresolved source coverage. Explicitly accept partial coverage to continue.'
    );
  const result = resultSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(row.resultBytes))
  );
  if (
    result.analysisIdentityDigest !== row.identityDigest ||
    result.coverage.originalContentComplete !== (row.status === 'COMPLETE')
  )
    throw new MaterialAnalysisConflict('The source analysis coverage changed.');
  return { ...saved, result };
}
