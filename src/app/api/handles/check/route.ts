import { NextRequest, NextResponse } from 'next/server';
import { isHandleAvailable } from '@/lib/handles';

export async function GET(request: NextRequest) {
  const handle = request.nextUrl.searchParams.get('handle');

  if (!handle) {
    return NextResponse.json({ error: 'handle parameter is required' }, { status: 400 });
  }

  const result = await isHandleAvailable(handle);
  return NextResponse.json(result);
}
