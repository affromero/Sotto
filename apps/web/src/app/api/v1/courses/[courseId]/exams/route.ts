import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { listCourseExams } from '@/lib/mock-exam-service';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ courseId: string }> };

/**
 * GET /api/courses/[courseId]/exams — the flagship exam available for the course
 * (institution + level resolved from the target language) plus past attempts.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);
  const { courseId } = await params;

  const view = await listCourseExams(courseId, authed.userId);
  if (!view) return errorResponse('Course not found', 404);
  return NextResponse.json(view);
}
