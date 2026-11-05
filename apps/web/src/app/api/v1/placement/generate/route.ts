import { NextRequest } from 'next/server';
import { placementGenerateRequestSchema } from '@sotto/shared';
import {
  materialAnalysisOperation,
  materialAnalysisResponse,
  readMaterialAnalysisJson,
} from '@/lib/course-materials/jobs/analysis-http';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { PlacementSessionResumeRequired, requestPlacementSession } from '@/lib/placement/sessions';
import { placementAdmissionRateLimit } from '@/lib/placement/http';

export const runtime = 'nodejs';
export function POST(request: NextRequest) {
  return materialAnalysisOperation(request, true, async (admission) => {
    const input = placementGenerateRequestSchema.parse(await readMaterialAnalysisJson(request));
    const execution = sottoRequestExecution(request, admission);
    const limited = await placementAdmissionRateLimit(execution, 'QUIZ', input.requestId);
    if (limited) return limited;
    let result: Awaited<ReturnType<typeof requestPlacementSession>>;
    try {
      result = await requestPlacementSession(execution, input);
    } catch (error) {
      if (error instanceof PlacementSessionResumeRequired)
        return materialAnalysisResponse(
          { error: error.message, placementSessionId: error.placementSessionId },
          409
        );
      throw error;
    }
    return materialAnalysisResponse(
      result,
      ['QUEUED', 'GENERATING', 'DISPATCHING', 'SUCCEEDED'].includes(result.status) ? 202 : 200
    );
  });
}
