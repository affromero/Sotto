import { NextRequest, NextResponse } from 'next/server';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { materialAnalysisOperation } from '@/lib/course-materials/jobs/analysis-http';
import {
  legacyMaterialTextQuerySchema,
  readLegacyMaterialText,
} from '@/lib/course-materials/read/legacy';

export function GET(request: NextRequest, { params }: { params: Promise<{ materialId: string }> }) {
  return materialAnalysisOperation(request, false, async (admission) => {
    const input = legacyMaterialTextQuerySchema.parse({
      ...(await params),
      offset: request.nextUrl.searchParams.get('offset') ?? 0,
      limit: request.nextUrl.searchParams.get('limit') ?? 8192,
    });
    const result = await sottoTransaction(
      prismaUnfiltered,
      (database) =>
        readLegacyMaterialText(database, sottoRequestExecution(request, admission), input),
      { signal: request.signal }
    );
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  });
}
