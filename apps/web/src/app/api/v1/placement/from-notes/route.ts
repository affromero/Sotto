import { NextRequest } from 'next/server';
import { requestNotesPlacement } from '@/lib/placement-notes';
import {
  materialAnalysisOperation,
  materialAnalysisResponse,
  readMaterialAnalysisJson,
} from '@/lib/course-materials/jobs/analysis-http';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { materialAnalysisRequestSchema } from '@/lib/course-materials/analysis/admission';
import { placementAdmissionRateLimit } from '@/lib/placement/http';

export const runtime = 'nodejs';
export function POST(request: NextRequest) {
  return materialAnalysisOperation(request, true, async (admission) => {
    const execution = sottoRequestExecution(request, admission),
      input = materialAnalysisRequestSchema.parse(await readMaterialAnalysisJson(request));
    const limited = await placementAdmissionRateLimit(execution, 'SOURCE', input.requestId);
    if (limited) return limited;
    const result = await requestNotesPlacement(execution, input);
    return materialAnalysisResponse(
      result,
      ['COMPLETE', 'PARTIAL', 'INSUFFICIENT_SOURCE'].includes(result.status) ? 200 : 202
    );
  });
}
