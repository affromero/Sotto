import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { coursePedagogySchema } from '@/lib/validations';

type RouteParams = { params: Promise<{ courseId: string }> };

async function ownsCourse(courseId: string, userId: string): Promise<boolean> {
  const course = await prisma.course.findFirst({ where: { id: courseId, userId }, select: { id: true } });
  return Boolean(course);
}

/** GET /api/courses/[courseId]/pedagogy — the course's current teaching approach. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);
  const { courseId } = await params;

  const course = await prisma.course.findFirst({
    where: { id: courseId, userId: authed.userId },
    select: { pedagogy: true },
  });
  if (!course) return errorResponse('Course not found', 404);
  return NextResponse.json({ pedagogy: course.pedagogy });
}

/**
 * PATCH /api/courses/[courseId]/pedagogy — switch the teaching approach. Takes
 * effect on the next generated class, practice session, or exam (it shapes
 * generation; existing content is unchanged).
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);
  const { courseId } = await params;

  const parsed = coursePedagogySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse('Invalid pedagogy', 400);

  if (!(await ownsCourse(courseId, authed.userId))) return errorResponse('Course not found', 404);

  try {
    await prisma.course.update({ where: { id: courseId }, data: { pedagogy: parsed.data.pedagogy } });
    return NextResponse.json({ pedagogy: parsed.data.pedagogy });
  } catch (error: unknown) {
    logger.error('Failed to update course pedagogy', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to update pedagogy', 500);
  }
}
