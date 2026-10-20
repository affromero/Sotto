import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { authenticateRequest } from '../api-keys';
import { errorResponse } from '../api-response';
import { accessOperation } from '../sidedoor/access/core/http';
import {
  sottoRequestExecution,
  type SottoProviderExecution,
} from '../sidedoor/credentials/runtime/provider-execution';
import { LearningCatalogUnavailable } from './catalogs';
import { LearningMapError } from './read';
import { MaterialAnalysisConflict } from '../course-materials/analysis/inventory';

export function learningMapOperation(
  request: NextRequest,
  write: boolean,
  work: (execution: SottoProviderExecution) => Promise<NextResponse>
) {
  return accessOperation(request, write && !request.headers.has('authorization'), async () => {
    const admission = await authenticateRequest(request);
    if (!admission) return errorResponse('Unauthorized', 401);
    try {
      return await work(sottoRequestExecution(request, admission));
    } catch (error) {
      if (error instanceof LearningMapError) return errorResponse(error.message, error.status);
      if (error instanceof MaterialAnalysisConflict)
        return errorResponse(error.message, error.status);
      if (error instanceof LearningCatalogUnavailable)
        return errorResponse(error.message, 422, {
          status: 'UNAVAILABLE',
          targetLang: error.targetLang,
        });
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return errorResponse('Invalid learning map request.', 400);
      if (error instanceof RequestBodyTooLargeError)
        return errorResponse('Learning map request exceeds its byte limit.', 413);
      throw error;
    }
  });
}

export async function learningMapJson(request: Request): Promise<unknown> {
  const bytes = await readRequestBytes(request, 32768);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new SyntaxError('Invalid learning map JSON.');
  }
}
