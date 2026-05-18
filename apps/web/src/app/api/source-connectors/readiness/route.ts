import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { getPrivateSourceReadiness } from '@/lib/source-connectors';

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const connectors = await getPrivateSourceReadiness();

  return NextResponse.json({
    connectors,
    readyCount: connectors.filter((connector) => connector.status === 'ready').length,
    totalCount: connectors.length,
  });
}
