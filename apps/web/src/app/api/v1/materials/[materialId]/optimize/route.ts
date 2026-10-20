import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered } from '@/lib/prisma';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { enqueueMaterialOptimization } from '@/lib/course-materials/optimization/admission';

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ materialId: string }> }
) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    const admission = await authenticateRequest(request);
    if (!admission) return errorResponse('Unauthorized', 401);
    const { materialId } = await params;
    if (!z.uuid().safeParse(materialId).success) return errorResponse('Material not found', 404);
    const receipt = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await requireOriginalSottoAdmission(database, request, admission);
        return enqueueMaterialOptimization(database, admission.userId, materialId);
      },
      { signal: request.signal }
    );
    return receipt
      ? NextResponse.json(receipt, {
          status: receipt.status === 'QUEUED' ? 202 : 200,
          headers: { 'Cache-Control': 'private, no-store' },
        })
      : errorResponse('Material not found', 404);
  });
}
