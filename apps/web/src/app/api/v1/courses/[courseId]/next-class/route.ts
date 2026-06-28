import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  createNextClass,
  ClassGenerationCancelledError,
  CourseNotFoundError,
} from '@/lib/class-service';
import { ClassSourceError } from '@/lib/class-source';
import { sourcedClassSchema } from '@/lib/validations';

type RouteParams = { params: Promise<{ courseId: string }> };

export const runtime = 'nodejs';
export const maxDuration = 300;

function wantsBackgroundGeneration(request: NextRequest): boolean {
  return (
    request.nextUrl.searchParams.get('background') === '1' ||
    request.headers.get('prefer')?.toLowerCase().includes('respond-async') === true
  );
}

function logBackgroundGenerationFailure(error: unknown, courseId: string): void {
  const message = error instanceof Error ? error.message : 'Failed to create class';
  logger.error('Background class generation failed', { courseId, error: message });
}

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

    if (wantsBackgroundGeneration(request)) {
      const course = await prisma.course.findFirst({
        where: { id: courseId, userId: authed.userId },
        select: { id: true },
      });
      if (!course) return errorResponse('Course not found', 404);

      void createNextClass(courseId, authed.userId, parsed.data).catch((error: unknown) => {
        logBackgroundGenerationFailure(error, courseId);
      });

      return NextResponse.json({ started: true }, { status: 202 });
    }

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
    if (error instanceof ClassGenerationCancelledError) {
      return errorResponse('Class generation was cancelled.', 409, { cancelled: true });
    }
    // The source link couldn't be read/leveled — actionable 422, no class created.
    if (error instanceof ClassSourceError) return errorResponse(error.message, 422);
    const message = error instanceof Error ? error.message : 'Failed to create class';
    logger.error('Failed to create next class', { error: message });
    return errorResponse(message, 500);
  }
}
