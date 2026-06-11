import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { getExamForUser } from '@/lib/mock-exam-service';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ examId: string }> };

/**
 * GET /api/exams/[examId] — the exam with its sections, questions, and prompts.
 * Answer keys (correctIndex/explanation) are stripped until the exam is SCORED.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);
  const { examId } = await params;

  const exam = await getExamForUser(examId, authed.userId);
  if (!exam) return errorResponse('Exam not found', 404);
  return NextResponse.json(exam);
}
