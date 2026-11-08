import { NextRequest, NextResponse } from 'next/server';
import { isAccessError } from 'thesidedoor-core/access';
import { classPreludeResponseSchema } from '@sotto/shared';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  InitialA1ProvenanceConflict,
  readClassTeachingPrelude,
} from '@/lib/classes/lesson/initial-a1-provenance';

type Params = { params: Promise<{ classId: string }> };

export function GET(request: NextRequest, params: Params) {
  return accessOperation(request, false, async () => {
    try {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      const { classId } = await params.params;
      const value = await readClassTeachingPrelude(
        prisma,
        classId,
        sottoRequestExecution(request, identity)
      );
      return NextResponse.json(classPreludeResponseSchema.parse(value), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    } catch (error) {
      if (isAccessError(error)) throw error;
      const response = errorResponse(
        error instanceof InitialA1ProvenanceConflict
          ? 'Class not found.'
          : 'Prerequisite teaching is unavailable.',
        error instanceof InitialA1ProvenanceConflict ? 404 : 500
      );
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
  });
}
