import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { getCourseNote, setCourseNote } from '@/lib/course-notes';

type RouteParams = { params: Promise<{ courseId: string }> };

const noteSchema = z.object({ body: z.string().max(4000) });

async function assertOwnership(courseId: string, userId: string): Promise<boolean> {
  const course = await prisma.course.findFirst({ where: { id: courseId, userId }, select: { id: true } });
  return Boolean(course);
}

/** GET /api/courses/[courseId]/notes — the learner's free-text context note. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId } = await params;
    if (!(await assertOwnership(courseId, authed.userId))) return errorResponse('Course not found', 404);

    const body = await getCourseNote(courseId);
    return NextResponse.json({ body });
  } catch (error: unknown) {
    logger.error('Failed to load course note', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to load course note', 500);
  }
}

/** PUT /api/courses/[courseId]/notes — replace the note (empty body clears it). */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId } = await params;
    if (!(await assertOwnership(courseId, authed.userId))) return errorResponse('Course not found', 404);

    const parsed = noteSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse('Invalid note body', 400);

    await setCourseNote(courseId, parsed.data.body);
    return NextResponse.json({ body: await getCourseNote(courseId) });
  } catch (error: unknown) {
    logger.error('Failed to save course note', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to save course note', 500);
  }
}
