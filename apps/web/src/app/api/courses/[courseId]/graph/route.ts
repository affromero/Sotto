import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { getMemoryGraph } from '@/lib/knowledge-graph';

type RouteParams = { params: Promise<{ courseId: string }> };

/** GET /api/courses/[courseId]/graph — the learner's vocabulary/grammar memory graph. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId } = await params;

    const course = await prisma.course.findFirst({
      where: { id: courseId, userId: authed.userId },
      select: { id: true },
    });
    if (!course) return errorResponse('Course not found', 404);

    const graph = await getMemoryGraph(courseId);
    return NextResponse.json(graph);
  } catch (error: unknown) {
    logger.error('Failed to load memory graph', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to load memory graph', 500);
  }
}
