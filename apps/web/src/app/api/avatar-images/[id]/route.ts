import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';
import { updateAvatarImageSchema } from '@/lib/validations';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    const { id } = await params;

    const body = await request.json();
    const parsed = updateAvatarImageSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request', 400);
    }

    const image = await prisma.avatarImage.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!image) {
      return errorResponse('Avatar image not found', 404);
    }

    const updated = await prisma.avatarImage.update({
      where: { id },
      data: { shareable: parsed.data.shareable },
    });

    return NextResponse.json({ id: updated.id, shareable: updated.shareable });
  } catch (error: unknown) {
    logger.error('Failed to update avatar image', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to update avatar image', 500);
  }
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
