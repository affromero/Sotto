import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAccessError } from 'thesidedoor-core/access';
import { RequestBodyTooLargeError, readRequestBytes } from 'thesidedoor-core/runtime/request';
import { authenticateRequest, type AuthenticatedRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { logger } from '@/lib/logger';
import { MaterialUploadProtocolError } from './protocol';
import { MaterialUploadStreamError } from './stream';

/** Preserve validation errors wrapped by stream destruction without hiding other failures. */
function uploadInputFailure(error: unknown): Error | null {
  if (
    error instanceof MaterialUploadStreamError ||
    error instanceof MaterialUploadProtocolError ||
    error instanceof RequestBodyTooLargeError ||
    error instanceof z.ZodError ||
    error instanceof SyntaxError
  )
    return error;
  if (error instanceof AggregateError) {
    const causes = error.errors.map(uploadInputFailure);
    const first = causes[0];
    return first &&
      causes.every((cause) => cause?.name === first.name && cause.message === first.message)
      ? first
      : null;
  }
  return error instanceof Error && error.cause !== undefined
    ? uploadInputFailure(error.cause)
    : null;
}

export async function materialUploadOperation(
  request: NextRequest,
  operation: (admission: AuthenticatedRequest) => Promise<NextResponse>
) {
  const write = !['GET', 'HEAD'].includes(request.method.toUpperCase());
  return accessOperation(request, write && !request.headers.has('authorization'), async () => {
    const admission = await authenticateRequest(request);
    if (!admission) return errorResponse('Unauthorized', 401);
    try {
      return await operation(admission);
    } catch (error) {
      if (isAccessError(error)) throw error;
      const inputFailure = uploadInputFailure(error);
      if (inputFailure instanceof z.ZodError || inputFailure instanceof SyntaxError)
        return errorResponse('Invalid material upload request.', 400);
      if (inputFailure instanceof RequestBodyTooLargeError)
        return errorResponse('Upload part exceeds its byte limit.', 413);
      if (inputFailure instanceof MaterialUploadProtocolError)
        return errorResponse(inputFailure.message, 409);
      if (inputFailure instanceof MaterialUploadStreamError)
        return errorResponse(
          inputFailure.message,
          inputFailure.code === 'checksum_mismatch' ? 422 : 400
        );
      logger.error('Material upload operation failed', {
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      return errorResponse(
        'The material upload could not finish. Check its saved receipts before retrying.',
        503
      );
    }
  });
}

export async function readUploadJson(request: Request): Promise<unknown> {
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(await readRequestBytes(request, 32768))
  );
}
