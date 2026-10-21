import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { RequestBodyTooLargeError, readRequestBytes } from 'thesidedoor-core/runtime/request';
import { authenticateRequest, type AuthenticatedRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered } from '@/lib/prisma';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  readMaterialRecognitionCapabilities,
  requireMaterialRecognitionCapabilityOwner,
  reviewMaterialRecognitionCapability,
  reviewMaterialRecognitionCapabilitySchema,
  revokeMaterialRecognitionCapability,
  revokeMaterialRecognitionCapabilitySchema,
} from '@/lib/course-materials/recognition/capabilities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function reviewJson(request: Request): Promise<unknown> {
  const bytes = await readRequestBytes(request, 32 * 1024);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new SyntaxError('Invalid recognition capability JSON.');
  }
}

function ownerOperation(
  request: NextRequest,
  write: boolean,
  operation: (admission: AuthenticatedRequest) => Promise<unknown>
) {
  return accessOperation(request, write && !request.headers.has('authorization'), async () => {
    const admission = await authenticateRequest(request);
    if (!admission) return errorResponse('Unauthorized', 401);
    if (!admission.isOwner) return errorResponse('Forbidden', 403);
    try {
      return NextResponse.json(await operation(admission));
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError)
        return errorResponse('Capability review request exceeds its byte limit.', 413);
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return errorResponse(
          'Provide a valid review and explicitly confirm image input and handwriting support.',
          400
        );
      throw error;
    }
  });
}

export function GET(request: NextRequest) {
  return ownerOperation(request, false, (admission) =>
    sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await requireMaterialRecognitionCapabilityOwner(database, {
          request,
          admission,
        });
        return readMaterialRecognitionCapabilities(database);
      },
      { signal: request.signal }
    )
  );
}

export function POST(request: NextRequest) {
  return ownerOperation(request, true, async (admission) => {
    const input = reviewMaterialRecognitionCapabilitySchema.parse(await reviewJson(request));
    return sottoTransaction(
      prismaUnfiltered,
      (database) => reviewMaterialRecognitionCapability(database, { request, admission }, input),
      { signal: request.signal }
    );
  });
}

export function PATCH(request: NextRequest) {
  return ownerOperation(request, true, async (admission) => {
    const input = revokeMaterialRecognitionCapabilitySchema.parse(await reviewJson(request));
    return sottoTransaction(
      prismaUnfiltered,
      (database) => revokeMaterialRecognitionCapability(database, { request, admission }, input),
      { signal: request.signal }
    );
  });
}
