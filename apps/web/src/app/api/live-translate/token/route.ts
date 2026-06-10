import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { liveTranslateTokenSchema } from '@/lib/validations';
import {
  mintLiveToken,
  LiveTranslateKeyError,
  LiveTranslateCourseError,
  LiveTranslateAccessError,
} from '@/lib/live-translate';

// Needs Node (the @google/genai server client mints the ephemeral token).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/live-translate/token — mint a short-lived ephemeral Gemini Live token
 * for the signed-in learner's course. The browser opens the Live WebSocket with
 * this token; the BYOK Google key never leaves the server.
 */
export async function POST(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);

  const parsed = liveTranslateTokenSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);

  try {
    const result = await mintLiveToken(authed.userId, parsed.data.courseId, parsed.data.direction);
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof LiveTranslateCourseError) return errorResponse('Course not found', 404);
    // Missing key or no Live access: actionable 422, never a silent degrade.
    if (error instanceof LiveTranslateKeyError) return errorResponse(error.message, 422);
    if (error instanceof LiveTranslateAccessError) return errorResponse(error.message, 422);
    logger.error('Failed to mint live-translate token', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to start a live session', 500);
  }
}
