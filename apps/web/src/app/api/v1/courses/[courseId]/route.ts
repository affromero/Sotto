import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { cache } from '@/lib/redis';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { deleteCourseCompletely } from '@/lib/course-deletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ courseId: string }> };

// Server-side confirmation: the client type-to-confirm is a UX guard, not a
// trust boundary, so the body must echo the course's target language.
const schema = z.object({ confirm: z.string().trim().toLowerCase() });

/**
 * DELETE /api/v1/courses/[courseId] — permanently delete a course and EVERYTHING
 * tied to it: the vocabulary/grammar memory graph, classes, exams, practice,
 * notes, generated listening episodes, and stored audio/files. Irreversible.
 * Backs both "reset & restart" (delete then re-place) and "remove language".
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId } = await params;

    const course = await prisma.course.findFirst({
      where: { id: courseId, userId: authed.userId },
      select: { id: true, nativeLang: true, targetLang: true },
    });
    if (!course) return errorResponse('Course not found', 404);

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return errorResponse('Confirmation required', 400);
    if (parsed.data.confirm !== course.targetLang.toLowerCase()) {
      return errorResponse('Confirmation does not match the course language', 400);
    }

    const result = await deleteCourseCompletely(course.id);

    // Pair-scoped placement caches survive course deletion; clear them so a fresh
    // placement for the same pair does not read a stale question batch / deduction.
    await Promise.all([
      cache.delete(`placement:${authed.userId}:${course.nativeLang}_${course.targetLang}`).catch(() => {}),
      cache
        .delete(`placement-notes:${authed.userId}:${course.nativeLang}_${course.targetLang}`)
        .catch(() => {}),
    ]);

    return NextResponse.json({ deleted: true, ...result });
  } catch (error: unknown) {
    logger.error('Course deletion failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to delete course', 500);
  }
}
