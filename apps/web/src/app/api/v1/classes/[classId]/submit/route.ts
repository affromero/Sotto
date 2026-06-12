import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { submitClass } from '@/lib/class-service';

type RouteParams = { params: Promise<{ classId: string }> };

const submitSchema = z.object({
  answers: z
    .array(z.object({ questionId: z.string(), selectedIndex: z.number().int().min(0).max(3) }))
    .min(1),
});

/** POST /api/classes/[classId]/submit — grade MC answers, transition status, release the gate on pass. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { classId } = await params;

    const parsed = submitSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse(parsed.error.issues[0].message, 400);

    const result = await submitClass(classId, authed.userId, parsed.data.answers);
    if (!result) return errorResponse('Class not found', 404);
    return NextResponse.json(result);
  } catch (error: unknown) {
    logger.error('Failed to submit class', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to submit class', 500);
  }
}
