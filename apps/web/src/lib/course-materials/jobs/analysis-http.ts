import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { authenticateRequest, type AuthenticatedRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { MaterialAnalysisConflict } from '../analysis/inventory';

export function materialAnalysisOperation(
  request: Request,
  mutation: boolean,
  operation: (admission: AuthenticatedRequest) => Promise<NextResponse>
) {
  return accessOperation(request, mutation && !request.headers.has('authorization'), async () => {
    const admission = await authenticateRequest(request);
    if (!admission) return errorResponse('Unauthorized', 401);
    try {
      return await operation(admission);
    } catch (error) {
      if (error instanceof MaterialAnalysisConflict)
        return errorResponse(error.message, error.status);
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return errorResponse('Invalid material analysis request.', 400);
      if (error instanceof RequestBodyTooLargeError)
        return errorResponse('The analysis request exceeds its byte limit.', 413);
      throw error;
    }
  });
}
export async function readMaterialAnalysisJson(request: Request): Promise<unknown> {
  const bytes = await readRequestBytes(request, 128 * 1024);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new MaterialAnalysisConflict('Analysis requests must contain valid UTF-8.', 400);
  }
  return JSON.parse(text);
}
export function materialAnalysisResponse(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
