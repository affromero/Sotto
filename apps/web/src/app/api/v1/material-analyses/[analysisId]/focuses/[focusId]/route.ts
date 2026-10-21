import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { readOwnedMaterialFocusDetail } from '@/lib/course-materials/analysis/read';
import {
  materialAnalysisOperation,
  materialAnalysisResponse,
} from '@/lib/course-materials/jobs/analysis-http';

export const runtime = 'nodejs';
export function GET(
  request: NextRequest,
  { params }: { params: Promise<{ analysisId: string; focusId: string }> }
) {
  return materialAnalysisOperation(request, false, async (admission) => {
    const values = await params;
    const analysisId = z.uuid().parse(values.analysisId);
    const id = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(values.focusId);
    const result = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await requireOriginalSottoAdmission(database, request, admission);
        return readOwnedMaterialFocusDetail(database, { analysisId, id, userId: admission.userId });
      },
      { signal: request.signal }
    );
    return materialAnalysisResponse(result);
  });
}
