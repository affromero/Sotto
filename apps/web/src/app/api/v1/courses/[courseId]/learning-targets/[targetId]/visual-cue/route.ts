import { NextRequest, NextResponse } from 'next/server';
import { isAccessError } from 'thesidedoor-core/access';
import { accessErrorStatus } from 'thesidedoor-core/access/http';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import {
  addVisualCue,
  LearningTargetCourseNotFoundError,
  LearningTargetNotFoundError,
  LearningTargetUnavailableError,
} from '@/lib/learning-targets';
import { logger } from '@/lib/logger';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

type RouteParams = { params: Promise<{ courseId: string; targetId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId, targetId } = await params;
    const target = await addVisualCue(
      courseId,
      authed.userId,
      targetId,
      sottoRequestExecution(request, authed)
    );
    return NextResponse.json(target);
  } catch (error: unknown) {
    if (isAccessError(error)) return errorResponse(error.code, accessErrorStatus(error));
    if (
      error instanceof LearningTargetCourseNotFoundError ||
      error instanceof LearningTargetNotFoundError
    ) {
      return errorResponse('Learning target not found', 404);
    }
    if (error instanceof LearningTargetUnavailableError) {
      return errorResponse(error.message, 422);
    }
    logger.error('Failed to add learning-target visual cue', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to add visual cue', 500);
  }
}
