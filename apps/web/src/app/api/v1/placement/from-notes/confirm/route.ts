import { NextRequest } from 'next/server';
import { confirmSourcePlacement } from '@/lib/placement/confirmation';
import {
  materialAnalysisOperation,
  materialAnalysisResponse,
  readMaterialAnalysisJson,
} from '@/lib/course-materials/jobs/analysis-http';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

export const runtime = 'nodejs';
export function POST(request: NextRequest) {
  return materialAnalysisOperation(request, true, async (admission) =>
    materialAnalysisResponse(
      await confirmSourcePlacement(
        sottoRequestExecution(request, admission),
        await readMaterialAnalysisJson(request)
      ),
      201
    )
  );
}
