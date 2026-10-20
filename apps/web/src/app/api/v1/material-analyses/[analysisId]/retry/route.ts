import { NextRequest } from 'next/server';
import { z } from 'zod';
import { retryMaterialAnalysis } from '@/lib/course-materials/analysis/recovery/retry';
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
    const { analysisId } = await params;
    const id = z.uuid().parse(analysisId);
    const result = await retryMaterialAnalysis(
      sottoRequestExecution(request, admission),
      id,
      await readMaterialAnalysisJson(request)
    );
    return materialAnalysisResponse(
      result,
      ['RUNNING', 'WAITING_SOURCE'].includes(result.status) ? 202 : 200
    );
  });
}
