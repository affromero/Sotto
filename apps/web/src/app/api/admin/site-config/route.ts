import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { getSiteConfig, setSiteConfig } from '@/lib/site-config';
import { z } from 'zod';
import { errorResponse } from '@/lib/api-response';

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const config = await getSiteConfig();
  return NextResponse.json(config);
}

const updateSchema = z.object({
  openSignup: z.boolean().optional(),
});

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  await setSiteConfig(parsed.data, adminId);
  const updated = await getSiteConfig();
  return NextResponse.json(updated);
}
