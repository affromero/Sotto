import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { examStartSchema } from '@/lib/validations';
import { createMockExam, ExamCourseNotFoundError } from '@/lib/mock-exam-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Generation runs synchronously (like a class); give it room.
export const maxDuration = 300;

/**
 * POST /api/exams — start a full-length mock exam for a course. Ungated (no
 * active-class gate). Generation is synchronous, like createNextClass. Never
 * advances the course level.
 */
export async function POST(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);

  const parsed = examStartSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);

  try {
    const examId = await createMockExam(parsed.data.courseId, authed.userId, parsed.data.level);
    return NextResponse.json({ examId }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof ExamCourseNotFoundError) return errorResponse('Course not found', 404);
    logger.error('Failed to create mock exam', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to create the exam', 500);
  }
}
