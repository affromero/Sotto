import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import {
  submitLearningWriting,
  LearningWritingError,
} from '@/lib/learning/writing/writing-submission';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

type RouteParams = { params: Promise<{ sessionId: string; promptId: string }> };

const submitSchema = z.object({ text: z.string().trim().min(1).max(4000) });

/**
 * POST /api/practice/[sessionId]/writing/[promptId]
 * Submit a practice writing response; graded synchronously by the LLM.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { sessionId, promptId } = await params;
    const userId = authed.userId;

    const parsed = submitSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse('Invalid writing response', 400);
    const grade = await submitLearningWriting({
      kind: 'PRACTICE',
      parentId: sessionId,
      promptId,
      userId,
      text: parsed.data.text,
      execution: sottoRequestExecution(request, authed),
    });

    return NextResponse.json(grade);
  } catch (error: unknown) {
    if (error instanceof LearningWritingError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : 'Failed to grade writing';
    logger.error('Failed to grade practice writing', { error: message });
    return errorResponse(message, 500);
  }
}
