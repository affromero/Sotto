import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { readMaterialProcessing } from '@/lib/course-materials/extraction/status';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ materialId: string }> }
) {
  const admission = await authenticateRequest(request);
  if (!admission) return errorResponse('Unauthorized', 401);
  const { materialId } = await params;
  const afterPage = z.coerce
    .number()
    .int()
    .nonnegative()
    .max(10000)
    .safeParse(request.nextUrl.searchParams.get('afterPage') ?? 0);
  if (!z.uuid().safeParse(materialId).success || !afterPage.success)
    return errorResponse('Invalid material processing request.', 400);
  const status = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      await requireOriginalSottoAdmission(database, request, admission);
      return readMaterialProcessing(database, admission.userId, materialId, afterPage.data);
    },
    { signal: request.signal }
  );
  return status
    ? NextResponse.json(status, { headers: { 'Cache-Control': 'private, no-store' } })
    : errorResponse('Material not found', 404);
}
