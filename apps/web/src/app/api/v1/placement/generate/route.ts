import { NextRequest } from 'next/server';
import { placementGenerateRequestSchema } from '@sotto/shared';
import {
  materialAnalysisOperation,
  materialAnalysisResponse,
  readMaterialAnalysisJson,
} from '@/lib/course-materials/jobs/analysis-http';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { requestPlacementSession } from '@/lib/placement/sessions';
import { placementAdmissionRateLimit } from '@/lib/placement/http';

export const runtime = 'nodejs';
export function POST(request: NextRequest) {
  return materialAnalysisOperation(request, true, async (admission) => {
    const input = placementGenerateRequestSchema.parse(await readMaterialAnalysisJson(request));
    const execution = sottoRequestExecution(request, admission);
    const limited = await placementAdmissionRateLimit(execution, 'QUIZ', input.requestId);
    if (limited) return limited;
    const result = await requestPlacementSession(execution, input);
    return materialAnalysisResponse(
      result,
      ['QUEUED', 'GENERATING', 'DISPATCHING', 'SUCCEEDED'].includes(result.status) ? 202 : 200
    );
  });
}
