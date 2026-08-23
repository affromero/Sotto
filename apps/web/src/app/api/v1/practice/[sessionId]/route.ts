import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { PracticeSessionNotFoundError } from '@/lib/practice-service';
import { resumePractice } from '@/lib/practice/resume';

type RouteParams = { params: Promise<{ sessionId: string }> };

/** GET /api/v1/practice/[sessionId] — re-enter a practice session still in progress. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { sessionId } = await params;

    return NextResponse.json(await resumePractice(sessionId, authed.userId));
  } catch (error: unknown) {
    if (error instanceof PracticeSessionNotFoundError) {
      return errorResponse('Practice session not found', 404);
    }
    const message = error instanceof Error ? error.message : 'Failed to load practice';
    logger.error('Failed to resume practice', { error: message });
    return errorResponse(message, 500);
  }
}

/**
 * DELETE /api/v1/practice/[sessionId] — discard a practice session.
 *
 * Its prompts, recordings, and written responses cascade with it. A listening
 * session's episode does not: the relation is SetNull by design, and the audio
 * it points at stays in storage.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { sessionId } = await params;

    // Scoped through the course, so one learner cannot delete another's
    // session by guessing an id.
    const deleted = await prisma.practiceSession.deleteMany({
      where: { id: sessionId, course: { userId: authed.userId } },
    });

    if (deleted.count === 0) {
      return errorResponse('Practice session not found', 404);
    }

    return NextResponse.json({ deleted: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete practice';
    logger.error('Failed to delete practice session', { error: message });
    return errorResponse(message, 500);
  }
}
