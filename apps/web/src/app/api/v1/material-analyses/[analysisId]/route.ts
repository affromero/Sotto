import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { readMaterialAnalysisStatus } from '@/lib/course-materials/analysis/read';
import {
  materialAnalysisOperation,
  materialAnalysisResponse,
} from '@/lib/course-materials/jobs/analysis-http';

export const runtime = 'nodejs';
export function GET(request: NextRequest, { params }: { params: Promise<{ analysisId: string }> }) {
  return materialAnalysisOperation(request, false, async (admission) => {
    const { analysisId } = await params;
    const id = z.uuid().parse(analysisId);
    const after = request.nextUrl.searchParams.get('afterOrder');
    const afterOrder =
      after === null ? undefined : z.coerce.number().int().nonnegative().safe().parse(after);
    const result = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await requireOriginalSottoAdmission(database, request, admission);
        return readMaterialAnalysisStatus(database, {
          analysisId: id,
          userId: admission.userId,
          afterOrder,
        });
      },
      { signal: request.signal }
    );
    return materialAnalysisResponse(result);
  });
}
