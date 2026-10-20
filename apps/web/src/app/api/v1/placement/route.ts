import { NextRequest } from 'next/server';
import { z } from 'zod';
import { placementGenerateRequestSchema } from '@sotto/shared';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  materialAnalysisOperation,
  materialAnalysisResponse,
  readMaterialAnalysisJson,
} from '@/lib/course-materials/jobs/analysis-http';
import { requestPlacementSession, readPlacementSessionStatus } from '@/lib/placement/sessions';
import { submitPlacementSession } from '@/lib/placement/confirmation';
import { placementAdmissionRateLimit } from '@/lib/placement/http';

export const runtime = 'nodejs';
export function GET(request: NextRequest) {
  const placementSessionId = request.nextUrl.searchParams.get('placementSessionId');
  return materialAnalysisOperation(request, !placementSessionId, async (admission) => {
    const execution = sottoRequestExecution(request, admission);
    if (placementSessionId) {
      z.uuid().parse(placementSessionId);
      const result = await sottoTransaction(
        prismaUnfiltered,
        async (database) => {
          await execution.authorize(database);
          return readPlacementSessionStatus(database, {
            userId: admission.userId,
            placementSessionId,
          });
        },
        { signal: request.signal }
      );
      return materialAnalysisResponse(
        result,
        ['QUEUED', 'GENERATING', 'DISPATCHING', 'SUCCEEDED'].includes(result.status) ? 202 : 200
      );
    }
    const query = request.nextUrl.searchParams;
    const input = placementGenerateRequestSchema.parse({
      schemaVersion: 1,
      requestId: query.get('requestId'),
      native: query.get('native'),
      target: query.get('target'),
      analysisId: query.get('analysisId'),
      analysisRevision: query.has('analysisRevision')
        ? Number(query.get('analysisRevision'))
        : null,
      resultDigest: query.get('resultDigest'),
      acceptPartial: query.get('acceptPartial') === 'true',
    });
    const limited = await placementAdmissionRateLimit(execution, 'QUIZ', input.requestId);
    if (limited) return limited;
    const result = await requestPlacementSession(execution, input);
    return materialAnalysisResponse(
      result,
      ['QUEUED', 'GENERATING', 'DISPATCHING', 'SUCCEEDED'].includes(result.status) ? 202 : 200
    );
  });
}
export function POST(request: NextRequest) {
  return materialAnalysisOperation(request, true, async (admission) =>
    materialAnalysisResponse(
      await submitPlacementSession(
        sottoRequestExecution(request, admission),
        await readMaterialAnalysisJson(request)
      )
    )
  );
}
