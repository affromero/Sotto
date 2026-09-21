import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { getAgentUsageStatus } from '@/lib/agent-usage';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

export async function GET(request: NextRequest) {
  return accessOperation(request, false, async () => {
    const authResult = await authenticateRequest(request);
    if (!authResult) return errorResponse('Unauthorized', 401);
    request.signal.throwIfAborted();
    const usage = await getAgentUsageStatus(sottoRequestExecution(request, authResult));
    request.signal.throwIfAborted();
    return NextResponse.json(usage);
  });
}
