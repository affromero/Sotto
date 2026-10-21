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
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { learningMapOperation } from '@/lib/learning-map/http';
import { ownedLearningCourse } from '@/lib/learning-map/read';
import { readCourseAnalyses } from '@/lib/learning-map/library';

export const runtime = 'nodejs';
export function GET(request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  return learningMapOperation(request, false, async (execution) => {
    const { courseId } = await params;
    const result = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        const actor = await execution.authorize(database);
        const course = await ownedLearningCourse(database, courseId, actor.userId);
        return readCourseAnalyses(
          database,
          course,
          request.nextUrl.searchParams.get('after') ?? undefined
        );
      },
      { signal: request.signal }
    );
    return materialAnalysisResponse(result, 200);
  });
}
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
