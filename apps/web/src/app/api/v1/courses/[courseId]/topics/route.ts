import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { suggestClassTopics } from '@/lib/class-topics';

type RouteParams = { params: Promise<{ courseId: string }> };

/**
 * GET /api/courses/[courseId]/topics — suggested topics for a sourced class,
 * drawn from the learner's interests. Feed a chosen topic to
 * POST /api/courses/[courseId]/next-class as `{ topic }`.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);
  const { courseId } = await params;

  const course = await prisma.course.findFirst({
    where: { id: courseId, userId: authed.userId },
    select: { id: true },
  });
  if (!course) return errorResponse('Course not found', 404);

  const { topics } = await suggestClassTopics(authed.userId);
  return NextResponse.json({ topics });
}
