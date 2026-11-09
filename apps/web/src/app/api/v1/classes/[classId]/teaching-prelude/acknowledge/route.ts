import { NextRequest, NextResponse } from 'next/server';
import { isAccessError } from 'thesidedoor-core/access';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import {
  classPreludeAcknowledgmentSchema,
  classPreludeAcknowledgmentResponseSchema,
} from '@sotto/shared';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  acknowledgeClassTeachingPrelude,
  InitialA1ProvenanceConflict,
} from '@/lib/classes/lesson/initial-a1-provenance';
import { PrerequisiteFenceConflict } from '@/lib/classes/help/lifecycle/prerequisite-fence';
import { PrerequisiteSourceConflict } from '@/lib/classes/help/content/prerequisite-source';

type Params = { params: Promise<{ classId: string }> };

export function POST(request: NextRequest, params: Params) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const body = classPreludeAcknowledgmentSchema.parse(
        JSON.parse(Buffer.from(await readRequestBytes(request, 4096)).toString('utf8'))
      );
      const { classId } = await params.params;
      const value = await acknowledgeClassTeachingPrelude(
        prisma,
        { ...body, classId },
        sottoRequestExecution(request, identity)
      );
      return NextResponse.json(classPreludeAcknowledgmentResponseSchema.parse(value), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    } catch (error) {
      if (isAccessError(error)) throw error;
      const status =
        error instanceof InitialA1ProvenanceConflict ||
        error instanceof PrerequisiteFenceConflict ||
        error instanceof PrerequisiteSourceConflict
          ? 409
          : error instanceof RequestBodyTooLargeError
            ? 413
            : error instanceof SyntaxError || error instanceof z.ZodError
              ? 400
              : 500;
      const response = errorResponse(
        status === 409
          ? 'The class or explanation changed. Reopen the class.'
          : status === 413
            ? 'Acknowledgment is too large.'
            : status === 400
              ? 'Invalid acknowledgment.'
              : 'Prerequisite teaching is unavailable.',
        status
      );
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
  });
}
