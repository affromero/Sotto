import { NextRequest } from 'next/server';
import { errorResponse } from '@/lib/api-response';
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
/** Original files are retained first through the resumable uploader; this entry admits their exact source IDs. */
export function POST(request: NextRequest) {
  return materialAnalysisOperation(request, true, async (admission) => {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
      return errorResponse(
        'Retain files through the resumable material uploader, then submit their material IDs as JSON.',
        415
      );
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
