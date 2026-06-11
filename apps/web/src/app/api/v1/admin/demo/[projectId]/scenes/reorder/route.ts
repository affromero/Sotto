import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';

interface Params {
  params: Promise<{ projectId: string }>;
}

const reorderSchema = z.object({
  sceneIds: z.array(z.string()).min(1),
});

/** PUT /api/admin/demo/[projectId]/scenes/reorder — Reorder scenes */
export async function PUT(request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId } = await params;
  const body = await request.json();
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0].message, 400);
  }

  const { sceneIds } = parsed.data;

  // Use a transaction to reassign orders atomically.
  // First set all orders to negative values to avoid unique constraint conflicts,
  // then set to final values.
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < sceneIds.length; i++) {
      await tx.demoScene.update({
        where: { id: sceneIds[i], projectId },
        data: { order: -(i + 1) },
      });
    }
    for (let i = 0; i < sceneIds.length; i++) {
      await tx.demoScene.update({
        where: { id: sceneIds[i], projectId },
        data: { order: i },
      });
    }
  });

  return NextResponse.json({ reordered: true });
}
