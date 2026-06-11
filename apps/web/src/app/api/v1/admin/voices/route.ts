import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const params = request.nextUrl.searchParams;
  const page = parseInt(params.get('page') || '1', 10);

  return NextResponse.json({ voices: [], total: 0, page, hasMore: false });
}

export async function PATCH() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  return errorResponse('Voice moderation has been removed', 410);
}
