import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  requestMaterialAnalysis,
  materialAnalysisRequestSchema,
} from '@/lib/course-materials/analysis/admission';

/** Placement and course imports share the complete retained-source analysis operation. */
export function requestNotesPlacement(execution: SottoProviderExecution, input: unknown) {
  return requestMaterialAnalysis(execution, materialAnalysisRequestSchema.parse(input));
}
