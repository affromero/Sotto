import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { getTwitterConfig, setTwitterConfig } from '@/lib/twitter-config';
import { twitterConfigUpdateSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const config = await getTwitterConfig();
  return NextResponse.json(config);
}

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = twitterConfigUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  await setTwitterConfig(parsed.data, adminId);
  const updated = await getTwitterConfig();
  return NextResponse.json(updated);
}
