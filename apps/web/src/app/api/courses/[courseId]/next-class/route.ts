import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { createNextClass, CourseNotFoundError } from '@/lib/class-service';

type RouteParams = { params: Promise<{ courseId: string }> };

/** POST /api/courses/[courseId]/next-class — generate the next gated class. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId } = await params;

    const result = await createNextClass(courseId, authed.userId);
    if (result.kind === 'gated') {
      return errorResponse('Finish the current class before starting a new one.', 409, {
        activeClassId: result.activeClassId,
        status: result.status,
      });
    }
    if (result.kind === 'done') {
      return NextResponse.json({ done: true });
    }
    return NextResponse.json({ classId: result.classId }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof CourseNotFoundError) return errorResponse('Course not found', 404);
    const message = error instanceof Error ? error.message : 'Failed to create class';
    logger.error('Failed to create next class', { error: message });
    return errorResponse(message, 500);
  }
}
