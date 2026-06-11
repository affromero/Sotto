import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { examSubmitSchema } from '@/lib/validations';
import { scoreExam, ExamNotFoundError } from '@/lib/mock-exam-scoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ examId: string }> };

/**
 * POST /api/exams/[examId]/submit — score a completed mock exam. MC scored inline,
 * writing already graded at upload, speaking read from the latest SCORED recording
 * per prompt. Produces a weighted overall + a mock band + feedback. NEVER changes
 * the course level.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);
  const { examId } = await params;

  const parsed = examSubmitSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);

  try {
    const result = await scoreExam(examId, authed.userId, parsed.data.answers);
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof ExamNotFoundError) return errorResponse('Exam not found', 404);
    logger.error('Failed to score exam', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to score the exam', 500);
  }
}
