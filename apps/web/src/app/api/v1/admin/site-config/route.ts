import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { getSiteConfig, resetSiteConfig, setSiteConfig } from '@/lib/site-config';
import { siteConfigUpdateSchema } from '@/lib/validations';
import { invalidateServerInfra } from '@/lib/server-config';
import { errorResponse } from '@/lib/api-response';

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const config = await getSiteConfig();
  return NextResponse.json(config);
}

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = siteConfigUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  await setSiteConfig(parsed.data, adminId);
  invalidateServerInfra();
  const updated = await getSiteConfig();
  return NextResponse.json(updated);
}

export async function DELETE() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  await resetSiteConfig(adminId);
  invalidateServerInfra();
  const updated = await getSiteConfig();
  return NextResponse.json(updated);
}
