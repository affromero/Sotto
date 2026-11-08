import { NextRequest, NextResponse } from 'next/server';
import { speakingRecoveryRequestSchema } from '@sotto/shared';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { acknowledgeUnresolvedSpeaking } from '@/lib/learning/speaking/recovery';
import { InitialA1PracticeBlocked } from '@/lib/classes/lesson/initial-a1-provenance';
import { isAccessError } from 'thesidedoor-core/access';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';

type Params = { params: Promise<{ classId: string; promptId: string }> };

export function POST(request: NextRequest, params: Params) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    const identity = await authenticateRequest(request);
    if (!identity) return errorResponse('Unauthorized', 401);
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(await readRequestBytes(request, 4096)).toString('utf8'));
    } catch (error) {
      return errorResponse(
        error instanceof RequestBodyTooLargeError
          ? 'Acknowledgment is too large.'
          : 'Invalid acknowledgment.',
        error instanceof RequestBodyTooLargeError ? 413 : 400
      );
    }
    const body = speakingRecoveryRequestSchema.safeParse(parsed);
    if (!body.success) return errorResponse('Acknowledge possible prior charges to continue.', 400);
    const { classId, promptId } = await params.params;
    try {
      const result = await acknowledgeUnresolvedSpeaking({
        classId,
        promptId,
        recordingId: body.data.recordingId,
        execution: sottoRequestExecution(request, identity),
      });
      return result ? NextResponse.json(result) : errorResponse('Recording not found', 404);
    } catch (error) {
      if (error instanceof InitialA1PracticeBlocked) return errorResponse(error.message, 409);
      if (isAccessError(error) && error.code === 'conflict')
        return errorResponse(
          'Recovery is not ready. Review the teaching and ask your server administrator to confirm cleanup.',
          409
        );
      throw error;
    }
  });
}
