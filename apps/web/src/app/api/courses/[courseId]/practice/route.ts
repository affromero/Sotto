import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { startPractice, PracticeCourseNotFoundError } from '@/lib/practice-service';

type RouteParams = { params: Promise<{ courseId: string }> };

const startSchema = z.object({
  kind: z.enum(['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'VOCAB']),
});

/** POST /api/courses/[courseId]/practice — start an ungated practice session. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId } = await params;

    const parsed = startSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse('Invalid practice kind', 400);

    const result = await startPractice(courseId, authed.userId, parsed.data.kind);
    if (result.status === 'unavailable') {
      return NextResponse.json(result, { status: 200 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof PracticeCourseNotFoundError) return errorResponse('Course not found', 404);
    const message = error instanceof Error ? error.message : 'Failed to start practice';
    logger.error('Failed to start practice', { error: message });
    return errorResponse(message, 500);
  }
}

/** GET /api/courses/[courseId]/practice — due counts per skill + recent sessions. */
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

    const now = new Date();
    const dueOrWeak = { OR: [{ dueAt: { lte: now } }, { mastery: { lt: 0.5 } }] };
    const [vocabDue, grammarDue, totalVocab, recent] = await Promise.all([
      prisma.learnerVocab.count({ where: { courseId, ...dueOrWeak } }),
      prisma.learnerGrammar.count({ where: { courseId, ...dueOrWeak } }),
      prisma.learnerVocab.count({ where: { courseId } }),
      prisma.practiceSession.findMany({
        where: { courseId },
        orderBy: { startedAt: 'desc' },
        take: 10,
        select: { id: true, kind: true, status: true, score: true, startedAt: true, completedAt: true },
      }),
    ]);

    return NextResponse.json({
      due: { vocab: vocabDue, grammar: grammarDue },
      totalVocab,
      recent,
    });
  } catch (error: unknown) {
    logger.error('Failed to load practice overview', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to load practice overview', 500);
  }
}
