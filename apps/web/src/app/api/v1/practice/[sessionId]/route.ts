import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
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
