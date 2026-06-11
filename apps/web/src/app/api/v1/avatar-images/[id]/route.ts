import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(
  _request: Request,
  { params }: RouteParams,
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    const { id } = await params;

    const image = await prisma.avatarImage.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!image) {
      return errorResponse('Avatar image not found', 404);
    }

    // R2 assets kept — no deletion
    await prisma.avatarImage.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    logger.error('Failed to delete avatar image', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to delete avatar image', 500);
  }
}
