import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requestMaterialAnalysisCancellation } from '@/lib/course-materials/analysis/recovery/cancellation';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  materialAnalysisOperation,
  materialAnalysisResponse,
  readMaterialAnalysisJson,
} from '@/lib/course-materials/jobs/analysis-http';

export const runtime = 'nodejs';
export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ analysisId: string }> }
) {
  return materialAnalysisOperation(request, true, async (admission) => {
    const id = z.uuid().parse((await params).analysisId);
    const result = await requestMaterialAnalysisCancellation(
      sottoRequestExecution(request, admission),
      id,
      await readMaterialAnalysisJson(request)
    );
    return materialAnalysisResponse(result, result.cancellation.state === 'PENDING' ? 202 : 200);
  });
}
