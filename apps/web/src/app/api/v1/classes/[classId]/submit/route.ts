import { NextRequest, NextResponse } from 'next/server';
import { submitClassRequestSchema } from '@sotto/shared';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { submitClass, ClassIncompleteError } from '@/lib/class-service';
import { InitialA1PracticeBlocked } from '@/lib/classes/lesson/initial-a1-provenance';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { isAccessError } from 'thesidedoor-core/access';
import { accessErrorStatus } from 'thesidedoor-core/access/http';

type RouteParams = { params: Promise<{ classId: string }> };

/** POST /api/classes/[classId]/submit — grade MC answers, transition status, release the gate on pass. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { classId } = await params;

    const parsed = submitClassRequestSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse(parsed.error.issues[0].message, 400);

    const result = await submitClass(
      classId,
      authed.userId,
      parsed.data.answers,
      sottoRequestExecution(request, authed)
    );
    if (!result) return errorResponse('Class not found', 404);
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof ClassIncompleteError) return errorResponse(error.message, 409);
    if (error instanceof InitialA1PracticeBlocked)
      return errorResponse(error.message, 409, { code: 'PREREQUISITE_ACK_REQUIRED' });
    if (isAccessError(error)) return errorResponse(error.code, accessErrorStatus(error));
    logger.error('Failed to submit class', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to submit class', 500);
  }
}
