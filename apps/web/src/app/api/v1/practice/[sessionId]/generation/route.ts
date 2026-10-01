import { NextRequest, NextResponse } from 'next/server';
import { practiceGenerationActionSchema } from '@sotto/shared';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { cancelPracticePreparation, practicePreparationProgress } from '@/lib/practice/preparation';
import { PreparationConflictError } from '@/lib/classes/preparation-state';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const identity = await authenticateRequest(request);
  if (!identity) return errorResponse('Unauthorized', 401);
  const input = practiceGenerationActionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return errorResponse('Invalid generation action', 400);
  if (input.data.action === 'recover' && input.data.acknowledgeUnknownOutcome !== true)
    return errorResponse('Acknowledge the interrupted provider outcome before recovery.', 400);
  try {
    const operation = await cancelPracticePreparation(
      (await params).sessionId,
      sottoRequestExecution(request, identity),
      input.data.action === 'recover' && input.data.acknowledgeUnknownOutcome === true
    );
    return NextResponse.json(practicePreparationProgress(operation));
  } catch (error) {
    if (error instanceof PreparationConflictError) return errorResponse(error.message, 409);
    return errorResponse('Practice generation cleanup could not be confirmed.', 500);
  }
}
