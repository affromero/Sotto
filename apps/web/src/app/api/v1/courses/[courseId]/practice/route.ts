import { NextRequest, NextResponse } from 'next/server';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { startPracticeRequestSchema } from '@sotto/shared';
import { LearningMapError } from '@/lib/learning-map/read';
import { MaterialAnalysisConflict } from '@/lib/course-materials/analysis/inventory';
import { learningMapJson } from '@/lib/learning-map/http';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { PracticeCourseNotFoundError } from '@/lib/practice-service';
import {
  requestPracticePreparation,
  practicePreparationProgress,
} from '@/lib/practice/preparation';
import { resumePractice } from '@/lib/practice/resume';
import { PreparationConflictError } from '@/lib/classes/preparation-state';
import {
  ProviderCreditsExhaustedError,
  speechCreditsMessage,
} from '@/lib/providers/shared/speech-availability';

type RouteParams = { params: Promise<{ courseId: string }> };

/** POST /api/courses/[courseId]/practice — start an ungated practice session. */
export function POST(request: NextRequest, context: RouteParams) {
  return accessOperation(request, !request.headers.has('authorization'), () =>
    start(request, context)
  );
}
async function start(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId } = await params;

    const parsed = startPracticeRequestSchema.safeParse(await learningMapJson(request));
    if (!parsed.success) return errorResponse('Invalid practice kind', 400);

    const operation = await requestPracticePreparation(
      courseId,
      parsed.data.kind,
      sottoRequestExecution(request, authed),
      {
        focusTargetId: parsed.data.focusTargetId,
        requestId: parsed.data.requestId,
        learningSelection: parsed.data.learningSelection,
      }
    );
    if (operation.status === 'COMPLETED')
      return NextResponse.json(await resumePractice(operation.sessionId, authed.userId));
    return NextResponse.json(practicePreparationProgress(operation), { status: 202 });
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return errorResponse('Invalid practice request.', 400);
    if (error instanceof RequestBodyTooLargeError)
      return errorResponse('Practice request exceeds its byte limit.', 413);
    if (error instanceof LearningMapError) return errorResponse(error.message, error.status);
    if (error instanceof MaterialAnalysisConflict)
      return errorResponse(error.message, error.status);
    if (error instanceof ProviderCreditsExhaustedError)
      return errorResponse(speechCreditsMessage(error), 402, { code: error.code });
    if (error instanceof PreparationConflictError) return errorResponse(error.message, 409);
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
        select: {
          id: true,
          kind: true,
          practiceLevel: true,
          status: true,
          score: true,
          startedAt: true,
          completedAt: true,
        },
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
