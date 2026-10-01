import { NextResponse, type NextRequest } from 'next/server';
import { authenticateRequest } from '../api-keys';
import { errorResponse } from '../api-response';
import { learningProgressSchema, LearningProgressConflict, saveLearningProgress } from './progress';

export async function patchLearningProgress(
  request: NextRequest,
  kind: 'CLASS' | 'PRACTICE',
  id: string
) {
  const admission = await authenticateRequest(request);
  if (!admission) return errorResponse('Unauthorized', 401);
  const input = learningProgressSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return errorResponse('Invalid saved progress', 400);
  try {
    const found = await saveLearningProgress(kind, id, admission.userId, input.data);
    return found
      ? NextResponse.json({ saved: true, progressRevision: found })
      : errorResponse('Learning session not found', 404);
  } catch (error) {
    if (error instanceof LearningProgressConflict) return errorResponse(error.message, 409);
    throw error;
  }
}
