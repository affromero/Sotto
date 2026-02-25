import { NextRequest, NextResponse } from 'next/server';
import { isHandleAvailable } from '@/lib/handles';

import { errorResponse } from '@/lib/api-response';
export async function GET(request: NextRequest) {
  const handle = request.nextUrl.searchParams.get('handle');

  if (!handle) {
    return errorResponse('handle parameter is required', 400);
  }

  const result = await isHandleAvailable(handle);
  return NextResponse.json(result);
}
