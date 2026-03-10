import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';

interface Params {
  params: Promise<{ projectId: string }>;
}

/** GET /api/admin/demo/[projectId]/scenes — List scenes */
export async function GET(_request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId } = await params;

  const scenes = await prisma.demoScene.findMany({
    where: { projectId },
    orderBy: { order: 'asc' },
  });

  return NextResponse.json(scenes);
}
