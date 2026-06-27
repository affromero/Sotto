import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { createNextClass, CourseNotFoundError } from '@/lib/class-service';
import { ClassSourceError } from '@/lib/class-source';
import { sourcedClassSchema } from '@/lib/validations';

type RouteParams = { params: Promise<{ courseId: string }> };

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/courses/[courseId]/next-class — generate the next gated class.
 * Optional body `{ sourceUrl?, topic? }` builds the class from a real link/paper
 * or an interest topic (sourced class); empty body = a normal curriculum class.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId } = await params;

    const body = await request.json().catch(() => ({}));
    const parsed = sourcedClassSchema.safeParse(body ?? {});
    if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);

    const result = await createNextClass(courseId, authed.userId, parsed.data);
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
    // The source link couldn't be read/leveled — actionable 422, no class created.
    if (error instanceof ClassSourceError) return errorResponse(error.message, 422);
    const message = error instanceof Error ? error.message : 'Failed to create class';
    logger.error('Failed to create next class', { error: message });
    return errorResponse(message, 500);
  }
}
