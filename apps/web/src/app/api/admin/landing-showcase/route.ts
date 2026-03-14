import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { getLandingShowcaseConfig, setLandingShowcaseConfig } from '@/lib/landing-showcase';
import { landingShowcaseUpdateSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const config = await getLandingShowcaseConfig();
  return NextResponse.json({ config });
}

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = landingShowcaseUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  await setLandingShowcaseConfig(parsed.data, adminId);
  const updated = await getLandingShowcaseConfig();
  return NextResponse.json({ config: updated });
}

export async function DELETE() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  await prisma.landingShowcase.deleteMany({ where: { id: 'singleton' } });
  return NextResponse.json({ config: null });
}
