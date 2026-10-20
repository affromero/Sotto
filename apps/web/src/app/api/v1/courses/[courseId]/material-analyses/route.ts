import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  requestMaterialAnalysis,
  materialAnalysisRequestSchema,
} from '@/lib/course-materials/analysis/admission';
import {
  materialAnalysisOperation,
  materialAnalysisResponse,
  readMaterialAnalysisJson,
} from '@/lib/course-materials/jobs/analysis-http';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

export const runtime = 'nodejs';
export function POST(request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  return materialAnalysisOperation(request, true, async (admission) => {
    const { courseId } = await params;
    z.string().min(1).max(200).parse(courseId);
    const input = materialAnalysisRequestSchema.parse(await readMaterialAnalysisJson(request));
    const result = await requestMaterialAnalysis(
      sottoRequestExecution(request, admission),
      input,
      courseId
    );
    return materialAnalysisResponse(
      result,
      ['COMPLETE', 'PARTIAL', 'INSUFFICIENT_SOURCE'].includes(result.status) ? 200 : 202
    );
  });
}
