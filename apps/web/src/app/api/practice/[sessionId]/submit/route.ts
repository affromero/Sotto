import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { submitPractice, PracticeSessionNotFoundError } from '@/lib/practice-service';

type RouteParams = { params: Promise<{ sessionId: string }> };

const submitSchema = z.object({
  answers: z.array(z.object({ itemId: z.string().min(1), selectedIndex: z.number().int().min(0) })),
});

/** POST /api/practice/[sessionId]/submit — grade a practice session, update SRS. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { sessionId } = await params;

    const parsed = submitSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse('Invalid answers', 400);

    const result = await submitPractice(sessionId, authed.userId, parsed.data.answers);
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof PracticeSessionNotFoundError) return errorResponse('Practice session not found', 404);
    const message = error instanceof Error ? error.message : 'Failed to submit practice';
    logger.error('Failed to submit practice', { error: message });
    return errorResponse(message, 500);
  }
}
