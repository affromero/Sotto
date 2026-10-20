import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { authenticateRequest, type AuthenticatedRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered } from '@/lib/prisma';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { MaterialRecognitionRequestError } from '@/lib/course-materials/recognition/errors';
import { captureMaterialRecognitionPolicy } from '@/lib/course-materials/recognition/policy';
import {
  materialRecognitionRequestSchema,
  requestMaterialRecognition,
  materialRecognitionOptions,
} from '@/lib/course-materials/recognition/requests';

function operation(
  request: NextRequest,
  work: (admission: AuthenticatedRequest) => Promise<NextResponse>
) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    const admission = await authenticateRequest(request);
    if (!admission) return errorResponse('Unauthorized', 401);
    try {
      return await work(admission);
    } catch (error) {
      if (error instanceof MaterialRecognitionRequestError)
        return errorResponse(error.message, error.status);
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return errorResponse('Invalid material recognition request.', 400);
      if (error instanceof RequestBodyTooLargeError)
        return errorResponse('Recognition request exceeds its byte limit.', 413);
      throw error;
    }
  });
}

export function GET(request: NextRequest, { params }: { params: Promise<{ materialId: string }> }) {
  return operation(request, async (admission) => {
    const { materialId } = await params;
    if (!z.uuid().safeParse(materialId).success) return errorResponse('Material not found', 404);
    const material = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await requireOriginalSottoAdmission(database, request, admission);
        return database.courseMaterial.findFirst({
          where: {
            id: materialId,
            userId: admission.userId,
            originalUrl: { not: null },
            originalSha256: { not: null },
          },
          include: {
            extractionRuns: {
              orderBy: { processingRevision: 'desc' },
              take: 1,
              select: { pageCount: true },
            },
          },
        });
      },
      { signal: request.signal }
    );
    if (!material) return errorResponse('Material not found', 404);
    if (material.mimeType !== 'application/pdf' && !/\.pdf$/i.test(material.name))
      return errorResponse('Page recognition requires a PDF original.', 400);
    const captured = await captureMaterialRecognitionPolicy(
      sottoRequestExecution(request, admission)
    );
    return NextResponse.json({
      ...materialRecognitionOptions(captured.policy),
      expectedProcessingRevision: material.processingRevision,
      maximumPageRequests: material.extractionRuns[0]?.pageCount ?? null,
    });
  });
}

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ materialId: string }> }
) {
  return operation(request, async (admission) => {
    const { materialId } = await params;
    if (!z.uuid().safeParse(materialId).success) return errorResponse('Material not found', 404);
    const bytes = await readRequestBytes(request, 32768);
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return errorResponse('Recognition requests must contain valid UTF-8.', 400);
    }
    const input = materialRecognitionRequestSchema.parse(JSON.parse(decoded));
    const receipt = await requestMaterialRecognition(request, admission, materialId, input);
    return NextResponse.json(receipt, {
      status: ['COMPLETE', 'PARTIAL'].includes(receipt.status) ? 200 : 202,
    });
  });
}
